#!/usr/bin/env node
/**
 * Sync Eval Evidence from the CZ AI agent repo.
 *
 * Reads the TypeScript eval datasets authored alongside the agent code
 * (tests/evals/datasets/*.ts) and snapshots them into a single JSON file
 * consumed by the self-eval app:
 *
 *     ../CZ-Chargezone-AI-agent-develop/tests/evals/datasets/*.ts
 *         │
 *         │  (ts.transpileModule → strip imports → vm sandbox)
 *         ▼
 *     self-eval/data/eval-evidence.json
 *
 * Why a snapshot, not a live read:
 *   - The self-eval Express server is plain Node (no TS loader). A one-shot
 *     build keeps the runtime path dependency-free.
 *   - Evidence rarely changes relative to how often it is read — run this
 *     script after pulling agent updates, commit the JSON, done.
 *   - The JSON file is git-diffable → PR reviewers can see dataset drift.
 *
 * Usage:
 *     node scripts/sync-eval-evidence.js
 *     node scripts/sync-eval-evidence.js --agent-repo ../path/to/repo
 *     node scripts/sync-eval-evidence.js --dry-run
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const vm   = require('vm');

/**
 * TypeScript is a dev-dep of the dashboard, so we borrow it rather than
 * adding another node_modules tree to the server.
 */
const TS_PATH = path.resolve(__dirname, '..', 'dashboard', 'node_modules', 'typescript');
let ts;
try {
  ts = require(TS_PATH);
} catch (err) {
  console.error('❌  Could not load typescript from', TS_PATH);
  console.error('    Run `npm install` in ./dashboard first.');
  process.exit(1);
}

// ─── CLI args ───────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);
function argOf(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def;
}
const DRY_RUN   = argv.includes('--dry-run');
const AGENT_REPO = path.resolve(
  __dirname, '..',
  argOf('--agent-repo', '../CZ-Chargezone-AI-agent-develop')
);
// Datasets were relocated from tests/evals/datasets → tests/evals/eval-evidence
// so all agent evidence lives in the same folder as the generated snapshot.
const DATASETS_DIR = path.join(AGENT_REPO, 'tests', 'evals', 'eval-evidence');
const OUT_FILE = path.resolve(__dirname, '..', 'data', 'eval-evidence.json');
const DASHBOARD_OUT_FILE = path.resolve(
  __dirname,
  '..',
  'dashboard',
  'src',
  'data',
  'agentEvalEvidence.json',
);

// ─── Dataset manifest ───────────────────────────────────────────────────────
// Each entry says: which file, which exported symbols to harvest, and how to
// slot them into the canonical evidence shape.

const MANIFEST = [
  {
    agent: 'discovery',
    file: 'discovery-agent.dataset.ts',
    // Pick up both individual consts (DISC_EVAL_*) and the aggregate array,
    // then dedupe by id.
    harvest: 'all-tasks-and-array',
    aggregate: 'DISCOVERY_EVAL_DATASET',
    kind: 'single',
  },
  {
    agent: 'payment',
    file: 'payment-agent.dataset.ts',
    harvest: 'all-tasks-and-array',
    aggregate: 'PAYMENT_EVAL_DATASET',
    kind: 'single',
  },
  {
    agent: 'session',
    file: 'session-agent.dataset.ts',
    harvest: 'aggregate-only',
    aggregate: 'SESSION_EVAL_DATASET',
    kind: 'single',
  },
  {
    agent: 'support',
    file: 'support-agent.dataset.ts',
    harvest: 'aggregate-only',
    aggregate: 'SUPPORT_EVAL_DATASET',
    kind: 'single',
  },
  {
    agent: 'session-flows',
    file: 'session-flows.dataset.ts',
    harvest: 'aggregate-only',
    aggregate: 'SESSION_EVAL_FLOWS',
    kind: 'flow',
  },
  {
    agent: 'new-user',
    file: 'new-user.dataset.ts',
    harvest: 'new-user-pair',
    aggregates: { single: 'NEW_USER_SINGLE_TASKS', flow: 'NEW_USER_FLOWS' },
  },
];

// ─── Agent enum stub ────────────────────────────────────────────────────────
// Datasets reference AgentType.DISCOVERY / .SESSION / etc. We shim a plain
// object so the sandboxed module evaluates to the lowercased string used
// everywhere else in self-eval.

const AGENT_ENUM = {
  DISCOVERY: 'discovery',
  SESSION:   'session',
  PAYMENT:   'payment',
  SUPPORT:   'support',
  FAQ:       'faq',
  LOYALTY:   'loyalty',
  GREETING:  'greeting',
  UNKNOWN:   'unknown',
};

// ─── Core: load one dataset file via vm ─────────────────────────────────────

function loadDatasetFile(absPath) {
  const source = fs.readFileSync(absPath, 'utf8');

  // Strip *all* imports — we supply their values via the sandbox.
  const stripped = source
    .replace(/^import\s+type\s+[^;]+;\s*$/gm, '')
    .replace(/^import\s+[^;]+;\s*$/gm, '');

  // Transpile TS → JS (types erased, no module transform).
  const { outputText } = ts.transpileModule(stripped, {
    compilerOptions: {
      target:        ts.ScriptTarget.ES2020,
      module:        ts.ModuleKind.CommonJS,
      removeComments: false,
      esModuleInterop: true,
    },
    fileName: path.basename(absPath),
    reportDiagnostics: false,
  });

  // Evaluate in a sandbox that exposes AgentType + a module/exports pair.
  const moduleObj = { exports: {} };
  const sandbox = {
    AgentType: AGENT_ENUM,
    module: moduleObj,
    exports: moduleObj.exports,
    require: () => ({}),       // defensive — no datasets should require() at runtime
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(outputText, sandbox, {
    filename: path.basename(absPath),
    timeout: 10_000,
  });

  return moduleObj.exports;
}

// ─── Shape normalisation ────────────────────────────────────────────────────
// Canonical EvalEvidenceScenario:
//
//   id           string  (stable across syncs)
//   agent        'discovery' | 'session' | 'payment' | 'support' | 'new-user' | 'session-flows'
//   name         string
//   description  string
//   tags         string[]
//   caseType     string  ('positive' | 'negative' | support uses 'financial' | etc.)
//   evalType     string  ('regression' | 'capability' | 'routing')
//   kind         'single' | 'flow'
//   --- if single:
//   input        { userMessage, channel?, buttonReplyId?, hasLocation?, location?, contactInfo?, … }
//   codeGradedCriteria  { expectedAgentType, responseMustBeNonEmpty?, responseMustNotContain?, responseMustContainOneOf? }
//   modelGradedRubric?  { passingScore, criteria[] }
//   mockBehavior?       object  (pass-through, opaque to self-eval runner)
//   --- if flow:
//   turns        [{ label, message, buttonReplyId?, assertions }]
//   initialState? object

function normaliseSingle(raw, agent) {
  // Support-dataset already uses lowercased agent strings — don't rewrap.
  return {
    id:          raw.id,
    agent,
    name:        raw.name || raw.id,
    description: raw.description || '',
    tags:        Array.isArray(raw.tags) ? raw.tags.slice() : [],
    caseType:    raw.caseType || 'positive',
    evalType:    raw.evalType || 'regression',
    kind:        'single',
    input:              raw.input || {},
    codeGradedCriteria: raw.codeGradedCriteria || null,
    modelGradedRubric:  raw.modelGradedRubric || null,
    mockBehavior:       raw.mockBehavior || null,
  };
}

function normaliseFlow(raw, agent) {
  // Different datasets author the per-turn message field with different names:
  // session-flows uses `message`, new-user uses `userMessage`. Normalise to one.
  const turns = (Array.isArray(raw.turns) ? raw.turns : []).map((t, i) => ({
    label:         t.label || `Turn ${i + 1}`,
    userMessage:   t.userMessage != null ? t.userMessage : (t.message || ''),
    buttonReplyId: t.buttonReplyId || undefined,
    assertions:    t.assertions || null,
    mockBehavior:  t.mockBehavior || undefined,
  }));

  return {
    id:          raw.id,
    agent,
    name:        raw.name || raw.id,
    description: raw.description || '',
    tags:        Array.isArray(raw.tags) ? raw.tags.slice() : [],
    caseType:    raw.caseType || 'positive',
    evalType:    raw.evalType || 'regression',
    kind:        'flow',
    turns,
    initialState: raw.initialState || raw.seed || null,
    mockBehavior: raw.mockBehavior || null,
  };
}

// ─── Driver ─────────────────────────────────────────────────────────────────

function main() {
  if (!fs.existsSync(DATASETS_DIR)) {
    console.error('❌  Datasets directory not found:', DATASETS_DIR);
    console.error('    Pass --agent-repo <path> if the agent repo lives elsewhere.');
    process.exit(1);
  }

  console.log('🔄  Syncing Eval Evidence from', DATASETS_DIR);

  const scenarios = [];
  const sourceStats = {};

  for (const entry of MANIFEST) {
    const filePath = path.join(DATASETS_DIR, entry.file);
    if (!fs.existsSync(filePath)) {
      console.warn('⚠️   Skipping missing file:', entry.file);
      continue;
    }

    let exports;
    try {
      exports = loadDatasetFile(filePath);
    } catch (err) {
      console.error(`❌  Failed to evaluate ${entry.file}: ${err.message}`);
      continue;
    }

    const collected = [];
    const seen = new Set();

    if (entry.harvest === 'all-tasks-and-array') {
      // Preferred source: the aggregate array (maintains authoring order).
      const arr = exports[entry.aggregate];
      if (Array.isArray(arr)) {
        for (const t of arr) {
          if (!t || !t.id) continue;
          collected.push(normaliseSingle(t, entry.agent));
          seen.add(t.id);
        }
      }
      // Also pick up individual exports not in the aggregate (safety net).
      for (const [key, value] of Object.entries(exports)) {
        if (key === entry.aggregate) continue;
        if (value && typeof value === 'object' && !Array.isArray(value) && value.id && !seen.has(value.id)) {
          collected.push(normaliseSingle(value, entry.agent));
          seen.add(value.id);
        }
      }
    } else if (entry.harvest === 'aggregate-only') {
      const arr = exports[entry.aggregate];
      if (!Array.isArray(arr)) {
        console.warn(`⚠️   ${entry.file}: ${entry.aggregate} is not an array — got ${typeof arr}`);
      } else {
        const normalise = entry.kind === 'flow' ? normaliseFlow : normaliseSingle;
        for (const t of arr) {
          if (!t || !t.id) continue;
          collected.push(normalise(t, entry.agent));
        }
      }
    } else if (entry.harvest === 'new-user-pair') {
      const singles = exports[entry.aggregates.single];
      const flows   = exports[entry.aggregates.flow];
      if (Array.isArray(singles)) {
        for (const t of singles) {
          if (t && t.id) collected.push(normaliseSingle(t, entry.agent));
        }
      }
      if (Array.isArray(flows)) {
        for (const t of flows) {
          if (t && t.id) collected.push(normaliseFlow(t, entry.agent));
        }
      }
    }

    sourceStats[entry.agent] = collected.length;
    scenarios.push(...collected);
    console.log(`   ✓ ${entry.agent.padEnd(15)} ${collected.length.toString().padStart(3)} scenarios  (${entry.file})`);
  }

  // Dedupe (belt + suspenders).
  const byId = new Map();
  for (const s of scenarios) {
    if (!byId.has(s.id)) byId.set(s.id, s);
  }
  const unique = Array.from(byId.values());

  // Stable sort: agent → kind → id.
  unique.sort((a, b) => {
    if (a.agent !== b.agent) return a.agent.localeCompare(b.agent);
    if (a.kind  !== b.kind)  return a.kind.localeCompare(b.kind);
    return a.id.localeCompare(b.id);
  });

  const payload = {
    version: 1,
    generatedAt: new Date().toISOString(),
    source: {
      repoPath: path.relative(path.resolve(__dirname, '..'), AGENT_REPO),
      files:    MANIFEST.map(m => m.file),
    },
    stats: {
      total: unique.length,
      byAgent: sourceStats,
      byKind: unique.reduce((acc, s) => { acc[s.kind] = (acc[s.kind] || 0) + 1; return acc; }, {}),
      byCaseType: unique.reduce((acc, s) => { acc[s.caseType] = (acc[s.caseType] || 0) + 1; return acc; }, {}),
      byEvalType: unique.reduce((acc, s) => { acc[s.evalType] = (acc[s.evalType] || 0) + 1; return acc; }, {}),
    },
    scenarios: unique,
  };

  if (DRY_RUN) {
    console.log('\n— DRY RUN — not writing output.');
    console.log('Would write:', OUT_FILE);
    console.log('Total scenarios:', payload.stats.total);
    console.log('By agent:', payload.stats.byAgent);
    console.log('By kind:',  payload.stats.byKind);
    return;
  }

  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
  fs.writeFileSync(OUT_FILE, JSON.stringify(payload, null, 2) + '\n');

  console.log(`\n✅  Wrote ${payload.stats.total} scenarios → ${path.relative(process.cwd(), OUT_FILE)}`);
  console.log('   By agent:', payload.stats.byAgent);
  console.log('   By kind: ', payload.stats.byKind);

  // Also copy the agent-repo's pre-built eval-evidence.json (the snapshot
  // produced by `npm run eval:evidence` in the agent project) into the
  // dashboard bundle so the Eval Evidence view has up-to-date data without a
  // server round-trip.
  const PREBUILT = path.join(DATASETS_DIR, 'eval-evidence.json');
  if (fs.existsSync(PREBUILT)) {
    fs.mkdirSync(path.dirname(DASHBOARD_OUT_FILE), { recursive: true });
    fs.copyFileSync(PREBUILT, DASHBOARD_OUT_FILE);
    console.log(
      `✅  Copied dashboard snapshot → ${path.relative(process.cwd(), DASHBOARD_OUT_FILE)}`,
    );
  } else {
    console.warn(
      `⚠️   Pre-built snapshot not found at ${PREBUILT}.\n` +
        `    Run \`npm run eval:evidence\` in the agent repo first, then re-run this script.`,
    );
  }
}

main();
