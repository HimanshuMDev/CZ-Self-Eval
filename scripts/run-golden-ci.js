#!/usr/bin/env node
/**
 * run-golden-ci.js
 * ---------------------------------------------------------------------------
 * Standalone CLI runner for the CZ AI Agent "Golden Set" — the locked set of
 * baseline scenarios that MUST pass before any change ships to production.
 *
 * This script has ZERO dependency on MongoDB or the self-eval Express server.
 * It is designed to be called from GitHub Actions (or any CI) on every PR to
 * `main`, and will:
 *
 *   1. Read `data/golden.json` (the versioned, file-backed scenario store).
 *   2. Filter to scenarios marked `mustPass: true`.
 *   3. Run each scenario N times against the live CZ AI Agent endpoint.
 *   4. Compute median + stdev score and a pass/fail verdict per scenario.
 *   5. Emit a JSON report (`eval-report.json`) and a Markdown summary
 *      (`eval-report.md`) suitable for posting as a PR comment.
 *   6. Exit 0 if every must-pass scenario passes — otherwise exit 1, blocking
 *      the merge.
 *
 * Usage:
 *   node scripts/run-golden-ci.js [--n 3] [--all] [--tag foo,bar]
 *                                 [--out ./eval-report.json]
 *                                 [--md   ./eval-report.md]
 *
 * Env vars:
 *   CZ_AGENT_URL    Endpoint to POST `{ message }` to
 *                   (default: https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate)
 *   CZ_AGENT_TOKEN  Optional bearer token sent as `Authorization: Bearer …`
 *   CZ_USER_ID      Phone-style user id sent with each request
 *                   (default: whatsapp:+919999999999)
 *   CZ_TIMEOUT_MS   Per-call timeout in milliseconds (default: 60000)
 *
 * Exit codes:
 *   0  all must-pass scenarios passed
 *   1  at least one must-pass scenario failed — CI gate closed
 *   2  transport / configuration error (could not run suite at all)
 * ---------------------------------------------------------------------------
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// ───────────────────────────────────────────────────────────────────────────
// Reuse the core runner logic defined in server/golden.js so the CLI and the
// dashboard behave identically. This module is plain CommonJS with no Express
// or Mongo imports at require-time.
// ───────────────────────────────────────────────────────────────────────────
const {
  loadStore,
  runScenarioN,
} = require(path.join(__dirname, '..', 'server', 'golden.js'));

// ───────────────────────────────────────────────────────────────────────────
// Tiny arg parser — no external deps.
// ───────────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const out = {
    n: 3,
    all: false,
    tag: null,
    outJson: 'eval-report.json',
    outMd:   'eval-report.md',
    help: false,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--n' || a === '-n')             out.n       = parseInt(next(), 10) || 3;
    else if (a === '--all')                    out.all     = true;
    else if (a === '--tag')                    out.tag     = String(next() || '').split(',').map(s => s.trim()).filter(Boolean);
    else if (a === '--out' || a === '--out-json') out.outJson = next();
    else if (a === '--md'  || a === '--out-md')   out.outMd   = next();
    else if (a === '--help' || a === '-h')     out.help    = true;
  }
  return out;
}

function printHelp() {
  console.log(`
CZ AI Agent — Golden Set CI Runner

Usage:
  node scripts/run-golden-ci.js [options]

Options:
  --n <num>         Number of runs per scenario   (default: 3)
  --all             Run EVERY scenario, not just mustPass
  --tag a,b,c       Only run scenarios that match ANY of these tags
  --out <file>      Write JSON report here        (default: eval-report.json)
  --md  <file>      Write Markdown summary here   (default: eval-report.md)
  --help            Print this help

Env:
  CZ_AGENT_URL      (default: chargecloud dev)
  CZ_AGENT_TOKEN    optional bearer token
  CZ_USER_ID        default: whatsapp:+919999999999
  CZ_TIMEOUT_MS     default: 60000

Exit codes:
  0  all must-pass scenarios passed
  1  at least one must-pass scenario failed
  2  transport / configuration error
`);
}

// ───────────────────────────────────────────────────────────────────────────
// Pretty-print helpers (ANSI with graceful fallback on non-TTY).
// ───────────────────────────────────────────────────────────────────────────
const useColor = process.stdout.isTTY && !process.env.NO_COLOR;
const C = (code) => (s) => useColor ? `\x1b[${code}m${s}\x1b[0m` : String(s);
const bold    = C('1');
const dim     = C('2');
const green   = C('32');
const red     = C('31');
const yellow  = C('33');
const cyan    = C('36');
const magenta = C('35');

function fmtScore(s) {
  if (typeof s !== 'number' || Number.isNaN(s)) return '  —  ';
  return (s * 100).toFixed(0).padStart(3, ' ') + '%';
}
function fmtMs(ms) {
  if (typeof ms !== 'number' || Number.isNaN(ms)) return '    ';
  if (ms < 1000) return `${ms.toFixed(0)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

// ───────────────────────────────────────────────────────────────────────────
// Markdown report — rendered in GitHub Actions step summary / PR comments.
// ───────────────────────────────────────────────────────────────────────────
function renderMarkdown(report) {
  const { summary, results, meta } = report;
  const lines = [];

  const headerEmoji = summary.pass ? '✅' : '❌';
  const verdict     = summary.pass ? 'PASS' : 'FAIL';

  lines.push(`# ${headerEmoji} CZ AI Agent — Golden Set (${verdict})`);
  lines.push('');
  lines.push(`_Ran at **${meta.runAt}** · N=${meta.n} per scenario · endpoint \`${meta.agentUrl}\`_`);
  lines.push('');
  lines.push(`**${summary.passed}/${summary.total}** scenarios passed · ` +
             `**${summary.flaky}** flaky · ` +
             `median score **${(summary.medianOfMedians * 100).toFixed(1)}%**`);
  lines.push('');

  if (!summary.pass) {
    lines.push('> :rotating_light: **Merge blocked** — at least one must-pass scenario failed. See details below.');
    lines.push('');
  }

  lines.push('| Scenario | Must-pass | Median | σ | Pass/Runs | Flaky | Verdict |');
  lines.push('|---|:-:|---:|---:|:-:|:-:|:-:|');
  for (const r of results) {
    const med = (r.medianScore * 100).toFixed(0) + '%';
    const sd  = (r.stdevScore * 100).toFixed(1) + '%';
    const pct = `${r.passCount}/${r.n}`;
    const mp  = r.scenario.mustPass ? '🔒' : '—';
    const fl  = r.flaky ? '⚠️' : '—';
    const ok  = r.overallPass ? '✅' : '❌';
    lines.push(`| \`${r.scenario.id}\` — ${escapePipe(r.scenario.title)} | ${mp} | ${med} | ${sd} | ${pct} | ${fl} | ${ok} |`);
  }
  lines.push('');

  // Detail section for each failure
  const failures = results.filter(r => !r.overallPass);
  if (failures.length) {
    lines.push('## Failures');
    lines.push('');
    for (const r of failures) {
      lines.push(`### \`${r.scenario.id}\` — ${r.scenario.title}`);
      lines.push('');
      lines.push(`- **Expected:** ${escapeMd(r.scenario.expectedAnswer || '—')}`);
      lines.push(`- **Min score:** ${((r.scenario.minScore ?? 0.7) * 100).toFixed(0)}%`);
      lines.push(`- **Median score:** ${(r.medianScore * 100).toFixed(0)}%`);
      if (r.scenario.passKeywords?.length) lines.push(`- **Pass keywords:** ${r.scenario.passKeywords.map(k => '`' + k + '`').join(', ')}`);
      if (r.scenario.failKeywords?.length) lines.push(`- **Fail keywords:** ${r.scenario.failKeywords.map(k => '`' + k + '`').join(', ')}`);
      lines.push('');
      lines.push('**Sample runs:**');
      lines.push('');
      r.runs.slice(0, 3).forEach((run, idx) => {
        lines.push(`<details><summary>Run ${idx + 1} — score ${(run.score * 100).toFixed(0)}% · ${run.pass ? '✅' : '❌'}</summary>`);
        lines.push('');
        lines.push('```');
        lines.push((run.responseText || '').slice(0, 1200));
        lines.push('```');
        lines.push('</details>');
        lines.push('');
      });
    }
  }

  lines.push('---');
  lines.push(`_Generated by \`scripts/run-golden-ci.js\` · self-eval foundation_`);
  return lines.join('\n');
}

function escapePipe(s) { return String(s || '').replace(/\|/g, '\\|'); }
function escapeMd(s)   { return String(s || '').replace(/[*_`]/g, (m) => '\\' + m); }

// ───────────────────────────────────────────────────────────────────────────
// Main
// ───────────────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv);
  if (args.help) { printHelp(); process.exit(0); }

  const agentUrl = process.env.CZ_AGENT_URL
    || 'https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate';

  console.log('');
  console.log(bold(magenta('━━━ CZ AI Agent · Golden Set CI ━━━')));
  console.log('');
  console.log(dim('agent url : ') + cyan(agentUrl));
  console.log(dim('n runs    : ') + cyan(String(args.n)));
  console.log(dim('scope     : ') + cyan(args.all ? 'ALL scenarios' : 'must-pass only'));
  if (args.tag?.length) console.log(dim('tag filter: ') + cyan(args.tag.join(', ')));
  console.log('');

  // Load scenarios
  let store;
  try {
    store = loadStore();
  } catch (err) {
    console.error(red('✗ Could not load data/golden.json: ') + err.message);
    process.exit(2);
  }

  let scenarios = store.scenarios || [];
  if (!args.all) scenarios = scenarios.filter(s => s.mustPass);
  if (args.tag?.length) {
    scenarios = scenarios.filter(s =>
      Array.isArray(s.tags) && s.tags.some(t => args.tag.includes(t))
    );
  }

  if (!scenarios.length) {
    console.error(red('✗ No scenarios matched the current filters.'));
    process.exit(2);
  }

  console.log(dim(`found ${scenarios.length} scenario(s) to run · ${args.n} run(s) each = ${scenarios.length * args.n} total agent call(s)`));
  console.log('');

  // Run the suite sequentially — we deliberately avoid parallelism so we
  // don't stampede the dev CZ agent in CI.
  const results = [];
  let idx = 0;
  for (const scenario of scenarios) {
    idx++;
    const tag = dim(`[${String(idx).padStart(2, ' ')}/${scenarios.length}]`);
    process.stdout.write(`${tag} ${scenario.mustPass ? '🔒 ' : '   '}${bold(scenario.id)} — ${scenario.title} `);
    try {
      const agg = await runScenarioN(scenario, args.n, { agentUrl });
      results.push(agg);
      const latencies = agg.runs.map(r => r.latencyMs).filter(n => typeof n === 'number');
      const avgMs = latencies.length ? latencies.reduce((a, b) => a + b, 0) / latencies.length : NaN;
      const col = agg.overallPass ? green : red;
      const verdict = agg.overallPass ? 'PASS' : 'FAIL';
      const flakyTxt = agg.flaky ? yellow(' ⚠ flaky') : '';
      console.log(
        col(verdict) +
        dim('  median ') + bold(fmtScore(agg.medianScore)) +
        dim('  σ ') + fmtScore(agg.stdevScore) +
        dim('  ') + fmtMs(avgMs) +
        flakyTxt
      );
    } catch (err) {
      // Surface as a failed scenario so CI still produces a useful report
      console.log(red('ERROR ') + dim(err.message));
      results.push({
        scenarioId: scenario.id,
        scenario,
        n: args.n,
        runs: [],
        medianScore: 0,
        stdevScore: 0,
        passCount: 0,
        failCount: args.n,
        flaky: false,
        overallPass: false,
        regressionAlert: true,
        runAt: new Date().toISOString(),
        error: err.message,
      });
    }
  }

  // ─── Summary ─────────────────────────────────────────────────────────────
  const mustPass   = results.filter(r => r.scenario.mustPass);
  const passed     = results.filter(r => r.overallPass).length;
  const flaky      = results.filter(r => r.flaky).length;
  const total      = results.length;
  const medians    = results.map(r => r.medianScore).sort((a, b) => a - b);
  const medianOfMedians = medians.length
    ? medians[Math.floor(medians.length / 2)]
    : 0;
  const mustPassFailed = mustPass.filter(r => !r.overallPass).length;
  const gatePass       = mustPassFailed === 0;

  const report = {
    meta: {
      runAt: new Date().toISOString(),
      agentUrl,
      n: args.n,
      scope: args.all ? 'all' : 'mustPass',
      tagFilter: args.tag || null,
      nodeVersion: process.version,
    },
    summary: {
      total,
      passed,
      flaky,
      mustPassTotal: mustPass.length,
      mustPassFailed,
      medianOfMedians,
      pass: gatePass,
    },
    results: results.map(r => ({
      // scenario keeps only the fields we need in the report
      scenario: {
        id: r.scenario.id,
        title: r.scenario.title,
        language: r.scenario.language,
        expectedSubAgent: r.scenario.expectedSubAgent,
        expectedAnswer: r.scenario.expectedAnswer,
        passKeywords: r.scenario.passKeywords,
        failKeywords: r.scenario.failKeywords,
        mustPass: r.scenario.mustPass,
        minScore: r.scenario.minScore,
        tags: r.scenario.tags,
      },
      n: r.n,
      runs: r.runs,
      medianScore: r.medianScore,
      stdevScore:  r.stdevScore,
      passCount:   r.passCount,
      failCount:   r.failCount,
      flaky:       r.flaky,
      overallPass: r.overallPass,
      regressionAlert: r.regressionAlert,
      runAt:       r.runAt,
      error:       r.error || null,
    })),
  };

  // Write artefacts
  try {
    fs.writeFileSync(args.outJson, JSON.stringify(report, null, 2));
    fs.writeFileSync(args.outMd,   renderMarkdown(report));
  } catch (err) {
    console.error(red('✗ Could not write report: ') + err.message);
    process.exit(2);
  }

  // Final banner
  console.log('');
  console.log(bold(magenta('━━━ Results ━━━')));
  console.log(`  total      : ${bold(String(total))}`);
  console.log(`  passed     : ${green(String(passed))} / ${total}`);
  console.log(`  must-pass  : ${mustPassFailed === 0 ? green('all passed') : red(`${mustPassFailed} FAILED`)} (of ${mustPass.length})`);
  console.log(`  flaky      : ${flaky ? yellow(String(flaky)) : '0'}`);
  console.log(`  median²    : ${bold(fmtScore(medianOfMedians))}`);
  console.log('');
  console.log(`  json       : ${cyan(path.resolve(args.outJson))}`);
  console.log(`  markdown   : ${cyan(path.resolve(args.outMd))}`);
  console.log('');

  // GitHub Actions: append markdown to the step summary if available
  if (process.env.GITHUB_STEP_SUMMARY) {
    try {
      fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, renderMarkdown(report) + '\n');
    } catch { /* non-fatal */ }
  }

  if (gatePass) {
    console.log(green(bold('✓ Golden Set CI gate: PASS')));
    console.log('');
    process.exit(0);
  } else {
    console.log(red(bold('✗ Golden Set CI gate: FAIL — merge blocked')));
    console.log('');
    process.exit(1);
  }
}

// Entrypoint
main().catch(err => {
  console.error('');
  console.error(red('✗ Unhandled error in CI runner:'));
  console.error(err && err.stack ? err.stack : err);
  process.exit(2);
});
