// ─────────────────────────────────────────────────────────────────────────────
//  CZ Agent Eval Runs — Express router + file-backed storage.
//
//  Endpoints:
//    GET    /api/eval-score/latest              — most recent completed run
//    GET    /api/eval-score/trend?days=30       — rolling trend (for the chart)
//    GET    /api/eval-score/runs                — list of recent runs (id+czScore)
//    GET    /api/eval-score/runs/:id            — full report for one run
//    POST   /api/eval-score/run                 — kick off a run, returns { runId }
//    GET    /api/eval-score/run/:id/stream      — SSE stream of progress
//    DELETE /api/eval-score/runs/:id            — delete a stored run
//
//  Storage layout:
//    data/eval-runs/
//      index.json             — [{id, czScore, status, runAt, …}]
//      <runId>.json           — full CZ score report
//
//  Run lifecycle:
//    user hits POST /run → we allocate runId, push an in-memory job, return.
//    dashboard connects to GET /run/:id/stream and receives progress events:
//       { type: 'scenario-start',    scenarioId, idx, total }
//       { type: 'scenario-done',     scenarioResult }
//       { type: 'progress',          done, total }
//       { type: 'complete',          report }
//       { type: 'error',             message }
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs       = require('fs').promises;
const path     = require('path');
const express  = require('express');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');

const { getScenarios, getMeta } = require('./eval-evidence');
const { toScoringScenario, runScenarioOnce, getLlmVerdict } = require('./evidence-runner');
const { judgeReply } = require('./judge');
const { scoreScenario, computeCzScore } = require('./score');
const { THRESHOLDS } = require('./rubric');

// Lazy lookup — the EvalRun model is registered in app.js. Look it up only
// when we need it so this module stays decoupled from the schema file.
function getEvalRunModel() {
  try { return mongoose.model('EvalRun'); } catch { return null; }
}
function mongoReady() {
  return mongoose.connection?.readyState === 1;
}

/**
 * Persist a completed run's summary + full report to Mongo, so the eval
 * history can be queried / exported independently of the disk files.
 * Non-blocking: if Mongo is down or errors out, we log and continue.
 */
async function persistRunToMongo(runId, header, report) {
  const EvalRun = getEvalRunModel();
  if (!EvalRun || !mongoReady()) return;
  try {
    await EvalRun.updateOne(
      { runId },
      {
        $set: {
          runId,
          czScore:         header.czScore,
          confidence:      header.confidence,
          status:          header.status,
          statusTone:      header.statusTone,
          deltaVsBaseline: header.deltaVsBaseline,
          scope:           header.scope,
          n:               header.n,
          passed:          header.passed,
          failed:          header.failed,
          flaky:           header.flaky,
          totalScenarios:  report?.stats?.totalScenarios || (header.passed + header.failed),
          mustPassFailed:  report?.stats?.mustPassFailed || 0,
          configHash:      header.configHash,
          useLlm:          !!report?.meta?.useLlm,
          tags:            Array.isArray(report?.meta?.tags) ? report.meta.tags : [],
          agents:          Array.isArray(report?.meta?.agents) ? report.meta.agents : [],
          runAt:           header.runAt,
          computedAt:      report?.meta?.computedAt,
          nodeVersion:     report?.meta?.nodeVersion,
          error:           header.error || null,
          report,
        },
      },
      { upsert: true },
    );
  } catch (err) {
    console.warn(`[eval] Mongo persistence failed for run ${runId.slice(0, 8)}: ${err.message}`);
  }
}

const DATA_DIR  = path.resolve(__dirname, '..', 'data', 'eval-runs');
const INDEX_FILE = path.join(DATA_DIR, 'index.json');

// In-memory registry of active jobs — keyed by runId.
// Each entry: { events: [], subscribers: Set<res>, done: bool, report?, error? }
const JOBS = new Map();

async function ensureDir() {
  await fs.mkdir(DATA_DIR, { recursive: true });
}

async function loadIndex() {
  await ensureDir();
  try {
    const raw = await fs.readFile(INDEX_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    if (err.code === 'ENOENT') return [];
    throw err;
  }
}

async function saveIndex(idx) {
  await ensureDir();
  await fs.writeFile(INDEX_FILE, JSON.stringify(idx, null, 2));
}

async function saveReport(runId, report) {
  await ensureDir();
  await fs.writeFile(
    path.join(DATA_DIR, `${runId}.json`),
    JSON.stringify(report, null, 2)
  );
}

async function loadReport(runId) {
  const p = path.join(DATA_DIR, `${runId}.json`);
  const raw = await fs.readFile(p, 'utf-8');
  return JSON.parse(raw);
}

// ─── Detect hallucination + routing correctness for a run ──────────────────
function instrumentRun(run, scenario) {
  const text = (run.responseText || '').toLowerCase();
  const fabricationSignals = [
    /\bbooked\b/, /\bconfirmed\b/, /\breserved\b/,
    /your (?:session|booking) (?:has|is) (?:started|activated)/,
    /\bi have (?:booked|reserved|confirmed)\b/,
  ];
  let hallucination = false;
  if (!scenario.expectsBookingConfirmation) {
    for (const re of fabricationSignals) {
      if (re.test(text)) { hallucination = true; break; }
    }
  }
  const routingCorrect = !scenario.expectedSubAgent
    ? null
    : (run.agentType === scenario.expectedSubAgent);
  return { hallucination, routingCorrect };
}

// ─── Emit an event to all subscribers of a run ─────────────────────────────
function emit(runId, evt) {
  const job = JOBS.get(runId);
  if (!job) return;
  job.events.push(evt);
  for (const res of job.subscribers) {
    try {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    } catch { /* subscriber closed */ }
  }
}

// ─── Main runner — executes full pipeline for one run ──────────────────────
async function executeRun(runId, opts) {
  const {
    n = 3,
    scope = 'mustPass',      // 'mustPass' | 'all' | 'tag' | 'agent'
    tags = null,
    agents = null,           // string[] of agent names to include ('discovery', 'payment', …)
    caseTypes = null,
    evalTypes = null,
    kinds = null,            // 'single' | 'flow'
    limit = null,            // optional cap (handy for quick smoke tests)
    useLlm = false,
    agentUrl,
  } = opts;

  try {
    // 1. Load scenarios from Eval Evidence + adapt into scoring shape
    const meta = getMeta();
    if (meta.error) throw new Error(`Eval Evidence not ready: ${meta.error}`);

    let evidence = getScenarios();

    // Scope filters
    if (scope === 'mustPass') {
      evidence = evidence.filter(e => e.evalType === 'regression'
        || (e.tags || []).some(t => ['safety', 'guardrail'].includes(String(t).toLowerCase())));
    } else if (scope === 'tag' && Array.isArray(tags) && tags.length) {
      const set = new Set(tags.map(t => String(t).toLowerCase()));
      evidence = evidence.filter(e =>
        (e.tags || []).some(t => set.has(String(t).toLowerCase()))
      );
    } else if (scope === 'agent' && Array.isArray(agents) && agents.length) {
      const set = new Set(agents);
      evidence = evidence.filter(e => set.has(e.agent));
    }
    // Additional orthogonal filters (can compose with any scope)
    if (Array.isArray(agents) && agents.length && scope !== 'agent') {
      const set = new Set(agents);
      evidence = evidence.filter(e => set.has(e.agent));
    }
    if (Array.isArray(caseTypes) && caseTypes.length) {
      const set = new Set(caseTypes);
      evidence = evidence.filter(e => set.has(e.caseType));
    }
    if (Array.isArray(evalTypes) && evalTypes.length) {
      const set = new Set(evalTypes);
      evidence = evidence.filter(e => set.has(e.evalType));
    }
    if (Array.isArray(kinds) && kinds.length) {
      const set = new Set(kinds);
      evidence = evidence.filter(e => set.has(e.kind));
    }
    if (typeof limit === 'number' && limit > 0) {
      evidence = evidence.slice(0, limit);
    }

    if (!evidence.length) {
      throw new Error('No Eval Evidence scenarios matched the current filters.');
    }

    const scenarios = evidence.map(toScoringScenario);
    emit(runId, { type: 'start', total: scenarios.length, n, scope, evidenceMeta: meta });

    // 2. For each scenario, run N times (single-turn) or once (flow), judge, score
    //
    // Reliability guarantees:
    //   * Each scenario has a wall-clock cap (CZ_SCENARIO_TIMEOUT_MS, default 3 min).
    //     A misbehaving scenario can't block the queue.
    //   * A heartbeat `progress` event fires every 10s while a scenario is
    //     working, so the UI's "no progress for 60s" stuck indicator never
    //     trips during normal long calls.
    //   * If three scenarios in a row fail to reach the agent, the whole run
    //     aborts with a clear actionable error (see later in this loop).
    const PER_SCENARIO_TIMEOUT_MS = Math.max(
      30_000,
      parseInt(process.env.CZ_SCENARIO_TIMEOUT_MS, 10) || 180_000,
    );

    const scenarioResults = [];
    let consecutiveReachErrors = 0;
    let lastReachError = '';
    let idx = 0;
    for (const scenario of scenarios) {
      idx++;
      emit(runId, {
        type: 'scenario-start',
        scenarioId: scenario.id,
        title: scenario.title,
        agent: scenario.category,
        kind: scenario.evidence.kind,
        idx,
        total: scenarios.length,
      });

      // Heartbeat keeps the UI's stall timer happy during slow scenarios.
      const heartbeatTimer = setInterval(() => {
        emit(runId, { type: 'progress', done: idx - 1, total: scenarios.length });
      }, 10_000);

      // Flows are deterministic and expensive — 1 repeat. Single-turn uses N.
      const repeats = scenario.evidence.kind === 'flow' ? 1 : n;
      const runs = [];

      const scenarioWork = (async () => {
        for (let i = 0; i < repeats; i++) {
          const r = await runScenarioOnce(scenario, { agentUrl });

          if (r.error && /Could not reach agent at|timed out after|^Agent at .* returned 5/.test(r.error)) {
            consecutiveReachErrors++;
            lastReachError = r.error;
          } else {
            consecutiveReachErrors = 0;
          }

          let judge = null;
          let llmVerdict = null;
          if (!r.error) {
            // 1. Rubric judge (3-persona ensemble, 5-dim scores)
            try {
              judge = await judgeReply({
                text: r.responseText,
                scenario,
                observedSubAgent: r.agentType,
                useLlm,
              });
            } catch (err) {
              judge = { overall: 5, agreement: 1, perDim: {}, judges: [], error: err.message };
            }

            // 2. Structured AI verdict (pass/fail + reasoning + issues).
            //    Runs whenever useLlm is on — this is what the user sees on
            //    each scenario card as "AI says: pass / partial / fail".
            if (useLlm) {
              try {
                llmVerdict = await getLlmVerdict({
                  scenario,
                  agentReply: r.responseText,
                  observedSubAgent: r.agentType,
                  codeGraded: { pass: r.pass, score: r.score, reason: r.reason },
                });
              } catch (err) {
                llmVerdict = { available: false, backendError: err.message };
              }
            }
          }

          const instr = instrumentRun(
            { responseText: r.responseText, agentType: r.agentType },
            scenario,
          );

          // Authoritative pass/fail policy:
          //   - If AI verdict is available AND confident (>= 0.6), it takes
          //     precedence over the regex check. The regex still runs and is
          //     recorded for transparency, but the AI gets the final call —
          //     which fixes the common case where responseMustContainOneOf
          //     is empty and the regex check was a coin flip.
          //   - If AI verdict is unavailable or low-confidence, fall back to
          //     the original regex-based pass.
          let finalPass = r.pass;
          let finalReason = r.reason;
          if (llmVerdict?.available && llmVerdict.confidence >= 0.6) {
            finalPass = llmVerdict.pass;
            finalReason = `AI verdict (${llmVerdict.verdict}, conf ${llmVerdict.confidence.toFixed(2)}): ${llmVerdict.reasoning}`;
          }

          runs.push({
            pass:           finalPass,
            score:          r.score,
            reason:         finalReason,
            codeGradedPass: r.pass,                  // regex result kept for transparency
            codeGradedReason: r.reason,
            responseText:   r.responseText,
            agentType:      r.agentType,
            responseTimeMs: r.responseTimeMs,
            turnResults:    r.turnResults || null,
            judge,
            llmVerdict,                              // full AI verdict blob: pass, confidence, reasoning, issues
            ...instr,
          });
        }
      })();

      try {
        await Promise.race([
          scenarioWork,
          new Promise((_, rej) =>
            setTimeout(
              () => rej(new Error(`Scenario exceeded ${(PER_SCENARIO_TIMEOUT_MS / 1000).toFixed(0)}s — abandoning`)),
              PER_SCENARIO_TIMEOUT_MS,
            ),
          ),
        ]);
      } catch (err) {
        console.error(`[eval] scenario ${scenario.id}: ${err.message}`);
        if (runs.length === 0) {
          runs.push({
            pass: false,
            score: 0,
            reason: err.message,
            responseText: '',
            agentType: null,
            responseTimeMs: PER_SCENARIO_TIMEOUT_MS,
            turnResults: null,
            judge: null,
            error: err.message,
            hallucination: false,
            routingCorrect: null,
          });
        }
      } finally {
        clearInterval(heartbeatTimer);
      }

      // Early-exit: 3 back-to-back unreachable-agent errors means the URL is
      // wrong or the service is down — no point grinding through 100+ more
      // doomed requests.
      if (consecutiveReachErrors >= 3) {
        throw new Error(
          `Aborted after 3 consecutive agent-unreachable errors.\n` +
            `Last error: ${lastReachError}\n` +
            `Fix CZ_AGENT_URL in self-eval/.env and run again.`,
        );
      }

      const scenarioScore = scoreScenario({ scenario, runs });
      // Attach flow turn detail at the scenario level (not per-run) so the
      // EvalScoreView can render the multi-turn trace on click.
      if (scenario.evidence.kind === 'flow' && runs[0]?.turnResults) {
        scenarioScore.flowTurns = runs[0].turnResults;
      }
      scenarioScore.agent = scenario.category;
      scenarioScore.kind  = scenario.evidence.kind;
      scenarioResults.push(scenarioScore);

      emit(runId, { type: 'scenario-done', scenarioResult: scenarioScore, idx, total: scenarios.length });
      emit(runId, { type: 'progress', done: idx, total: scenarios.length });
    }

    // 3. Compute baseline from recent runs
    const idxList = await loadIndex();
    const recent = idxList
      .filter(r => r.status !== 'error')
      .slice(0, THRESHOLDS.baselineWindow);
    const baselineScore = recent.length
      ? (() => {
          const s = [...recent].map(r => r.czScore).sort((a, b) => a - b);
          return s[Math.floor(s.length / 2)];
        })()
      : null;

    // 4. Compose the report
    const report = computeCzScore({
      scenarioResults,
      meta: {
        runId,
        agentUrl: agentUrl || process.env.CZ_AGENT_URL || 'default',
        n,
        scope,
        tags,
        useLlm,
        startedAt: new Date().toISOString(),
        nodeVersion: process.version,
      },
      baselineScore,
    });

    // 5. Persist
    await saveReport(runId, report);
    const header = {
      id:        runId,
      czScore:   report.czScore,
      confidence: report.confidence,
      status:    report.status.label,
      statusTone: report.status.tone,
      deltaVsBaseline: report.deltaVsBaseline,
      scope,
      n,
      passed:    report.stats.passed,
      failed:    report.stats.failed,
      flaky:     report.stats.flaky,
      runAt:     new Date().toISOString(),
      configHash: report.meta.configHash,
    };
    idxList.unshift(header);
    await saveIndex(idxList.slice(0, 200));   // keep last 200

    // 5b. Also mirror to MongoDB so the history is queryable from anywhere
    //     (Compass, other apps, bulk exports). Non-blocking — disk stays the
    //     source of truth.
    await persistRunToMongo(runId, { ...header, configHash: report.meta.configHash }, report);

    // 6. Mark job done and broadcast
    const job = JOBS.get(runId);
    if (job) {
      job.done = true;
      job.report = report;
    }
    emit(runId, { type: 'complete', report });

    // cleanup subscribers after a short grace period
    setTimeout(() => {
      const j = JOBS.get(runId);
      if (!j) return;
      for (const res of j.subscribers) { try { res.end(); } catch {} }
      JOBS.delete(runId);
    }, 10_000);
  } catch (err) {
    const job = JOBS.get(runId);
    if (job) { job.done = true; job.error = err.message; }
    emit(runId, { type: 'error', message: err.message });
    // also stamp an error entry in the index so it shows up
    try {
      const idxList = await loadIndex();
      const errorHeader = {
        id: runId, czScore: 0, status: 'Error', statusTone: 'red',
        deltaVsBaseline: null, scope: opts.scope || 'mustPass', n: opts.n || 3,
        passed: 0, failed: 0, flaky: 0, runAt: new Date().toISOString(),
        error: err.message,
      };
      idxList.unshift(errorHeader);
      await saveIndex(idxList.slice(0, 200));
      // Mirror the error too so Mongo has a complete audit trail
      await persistRunToMongo(runId, errorHeader, {
        empty: true,
        czScore: 0,
        stats: { totalScenarios: 0, passed: 0, failed: 0, flaky: 0, mustPassFailed: 0 },
        meta: {
          runId,
          scope: opts.scope,
          n: opts.n,
          useLlm: !!opts.useLlm,
          agents: opts.agents || [],
          startedAt: new Date().toISOString(),
          computedAt: new Date().toISOString(),
          nodeVersion: process.version,
          error: err.message,
        },
      });
    } catch {}
  }
}

// ─── Express router ────────────────────────────────────────────────────────
function createEvalRunsRouter() {
  const router = express.Router();

  // GET /latest
  router.get('/latest', async (_req, res) => {
    try {
      const idx = await loadIndex();
      const latest = idx.find(r => r.status !== 'Error');
      if (!latest) return res.json({ empty: true });
      const report = await loadReport(latest.id);
      res.json(report);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /trend?days=30
  router.get('/trend', async (req, res) => {
    try {
      const days = Math.max(1, Math.min(180, parseInt(req.query.days, 10) || 30));
      const cutoff = Date.now() - days * 86_400_000;
      const idx = await loadIndex();
      const series = idx
        .filter(r => new Date(r.runAt).getTime() >= cutoff)
        .sort((a, b) => new Date(a.runAt) - new Date(b.runAt))
        .map(r => ({
          id: r.id,
          runAt: r.runAt,
          czScore: r.czScore,
          confidence: r.confidence,
          status: r.status,
          statusTone: r.statusTone,
          passed: r.passed,
          failed: r.failed,
          flaky: r.flaky,
        }));
      res.json({ days, count: series.length, series });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /runs — list. Prefer Mongo when connected (richer query later);
  // fall back to the disk index so the feature still works offline.
  router.get('/runs', async (_req, res) => {
    try {
      const EvalRun = getEvalRunModel();
      if (EvalRun && mongoReady()) {
        const docs = await EvalRun
          .find({}, { report: 0, _id: 0, __v: 0, createdAt: 0, updatedAt: 0 })
          .sort({ runAt: -1 })
          .limit(50)
          .lean();
        const runs = docs.map((d) => ({
          id: d.runId,
          czScore:   d.czScore,
          confidence: d.confidence,
          status:    d.status,
          statusTone: d.statusTone,
          deltaVsBaseline: d.deltaVsBaseline,
          scope:     d.scope,
          n:         d.n,
          passed:    d.passed,
          failed:    d.failed,
          flaky:     d.flaky,
          runAt:     d.runAt,
          configHash: d.configHash,
          error:     d.error,
        }));
        return res.json({ count: runs.length, source: 'mongodb', runs });
      }
      const idx = await loadIndex();
      res.json({ count: idx.length, source: 'disk', runs: idx.slice(0, 50) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /runs/:id — full report (tries Mongo first, falls back to disk)
  router.get('/runs/:id', async (req, res) => {
    try {
      const EvalRun = getEvalRunModel();
      if (EvalRun && mongoReady()) {
        const doc = await EvalRun.findOne({ runId: req.params.id }).lean();
        if (doc?.report) return res.json(doc.report);
      }
      const report = await loadReport(req.params.id);
      res.json(report);
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
      res.status(500).json({ error: err.message });
    }
  });

  // GET /runs/:id/download — force-download a single report as JSON
  router.get('/runs/:id/download', async (req, res) => {
    try {
      const id = req.params.id;
      let report;
      const EvalRun = getEvalRunModel();
      if (EvalRun && mongoReady()) {
        const doc = await EvalRun.findOne({ runId: id }).lean();
        report = doc?.report;
      }
      if (!report) report = await loadReport(id);
      if (!report) return res.status(404).json({ error: 'not found' });
      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="eval-run-${id.slice(0, 8)}.json"`,
      );
      res.send(JSON.stringify(report, null, 2));
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
      res.status(500).json({ error: err.message });
    }
  });

  // GET /export/all — bulk dump of EVERY stored run (headers + full reports).
  // Optional ?since=<iso> to filter. Streams from Mongo when available for
  // scale; otherwise walks disk.
  router.get('/export/all', async (req, res) => {
    try {
      const since = req.query.since ? new Date(req.query.since) : null;
      const EvalRun = getEvalRunModel();
      let runs = [];

      if (EvalRun && mongoReady()) {
        const q = since ? { runAt: { $gte: since.toISOString() } } : {};
        runs = await EvalRun.find(q, { _id: 0 }).sort({ runAt: -1 }).lean();
      } else {
        // Disk fallback
        const idx = await loadIndex();
        const filtered = since ? idx.filter(r => new Date(r.runAt) >= since) : idx;
        for (const hdr of filtered) {
          try {
            const full = await loadReport(hdr.id);
            runs.push({ runId: hdr.id, ...hdr, report: full });
          } catch { /* orphaned index entry — skip */ }
        }
      }

      res.setHeader('Content-Type', 'application/json');
      res.setHeader(
        'Content-Disposition',
        `attachment; filename="eval-runs-export-${Date.now()}.json"`,
      );
      res.send(
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            count:      runs.length,
            source:     (EvalRun && mongoReady()) ? 'mongodb' : 'disk',
            runs,
          },
          null,
          2,
        ),
      );
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /import — upload a previously-exported file to restore / merge.
  // Useful for moving an eval history between environments.
  router.post('/import', async (req, res) => {
    try {
      const body = req.body || {};
      const list = Array.isArray(body.runs) ? body.runs : [];
      if (!list.length) return res.status(400).json({ error: 'runs: [] required' });

      let addedDisk = 0, addedMongo = 0;
      const idxList = await loadIndex();
      const seenOnDisk = new Set(idxList.map((r) => r.id));
      const EvalRun = getEvalRunModel();

      for (const entry of list) {
        const runId = entry.runId || entry.id;
        if (!runId || !entry.report) continue;
        // Disk write
        if (!seenOnDisk.has(runId)) {
          await saveReport(runId, entry.report);
          const hdr = {
            id: runId,
            czScore:    entry.czScore ?? entry.report?.czScore ?? 0,
            confidence: entry.confidence ?? entry.report?.confidence,
            status:     entry.status ?? entry.report?.status?.label ?? 'Unknown',
            statusTone: entry.statusTone ?? entry.report?.status?.tone ?? 'gray',
            deltaVsBaseline: entry.deltaVsBaseline ?? entry.report?.deltaVsBaseline ?? null,
            scope:      entry.scope ?? entry.report?.meta?.scope ?? 'all',
            n:          entry.n ?? entry.report?.meta?.n ?? 1,
            passed:     entry.passed ?? entry.report?.stats?.passed ?? 0,
            failed:     entry.failed ?? entry.report?.stats?.failed ?? 0,
            flaky:      entry.flaky ?? entry.report?.stats?.flaky ?? 0,
            runAt:      entry.runAt ?? entry.report?.meta?.computedAt ?? new Date().toISOString(),
            configHash: entry.configHash ?? entry.report?.meta?.configHash,
          };
          idxList.unshift(hdr);
          addedDisk++;
          if (EvalRun && mongoReady()) {
            await persistRunToMongo(runId, hdr, entry.report);
            addedMongo++;
          }
        }
      }
      await saveIndex(idxList.slice(0, 500));
      res.json({ ok: true, addedDisk, addedMongo, total: list.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // DELETE /runs/:id
  router.delete('/runs/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const idx = await loadIndex();
      const next = idx.filter(r => r.id !== id);
      await saveIndex(next);
      try { await fs.unlink(path.join(DATA_DIR, `${id}.json`)); } catch {}
      // Also remove from Mongo if persisted there
      const EvalRun = getEvalRunModel();
      if (EvalRun && mongoReady()) {
        try { await EvalRun.deleteOne({ runId: id }); } catch { /* ignore */ }
      }
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // POST /run — kick off a run
  //   Body: {
  //     n:          1..10 (default 3)
  //     scope:      'mustPass' | 'all' | 'tag' | 'agent'
  //     tags:       string[]   (when scope='tag')
  //     agents:     string[]   ('discovery' | 'session' | …)  — filter or scope='agent'
  //     caseTypes:  string[]   ('positive' | 'negative' | …)
  //     evalTypes:  string[]   ('regression' | 'capability' | …)
  //     kinds:      string[]   ('single' | 'flow')
  //     limit:      number     optional cap (handy for quick smoke runs)
  //     useLlm:     boolean    LLM judge ensemble (requires ANTHROPIC_API_KEY)
  //     agentUrl:   string     override CZ agent URL
  //   }
  router.post('/run', async (req, res) => {
    try {
      const b = req.body || {};
      const runId = randomUUID();
      // LLM judge default: on whenever ANY provider key is present. The
      // client can still force it off by explicitly sending useLlm:false —
      // but "I set a key and it still uses heuristic" won't happen.
      const hasLlmKey =
        !!(process.env.ANTHROPIC_API_KEY ||
           process.env.OPENAI_API_KEY ||
           process.env.GEMINI_API_KEY);
      const opts = {
        n:         Math.max(1, Math.min(10, parseInt(b.n, 10) || 3)),
        scope:     ['all', 'tag', 'agent', 'mustPass'].includes(b.scope) ? b.scope : 'mustPass',
        tags:      Array.isArray(b.tags)      ? b.tags      : null,
        agents:    Array.isArray(b.agents)    ? b.agents    : null,
        caseTypes: Array.isArray(b.caseTypes) ? b.caseTypes : null,
        evalTypes: Array.isArray(b.evalTypes) ? b.evalTypes : null,
        kinds:     Array.isArray(b.kinds)     ? b.kinds     : null,
        limit:     typeof b.limit === 'number' && b.limit > 0 ? Math.floor(b.limit) : null,
        useLlm:    b.useLlm === false ? false : (b.useLlm === true || hasLlmKey),
        agentUrl:  b.agentUrl,
      };
      console.log(
        `[eval] run ${runId.slice(0, 8)} scope=${opts.scope} n=${opts.n} useLlm=${opts.useLlm}${opts.agents ? ` agents=${opts.agents.join(',')}` : ''}`,
      );
      JOBS.set(runId, { events: [], subscribers: new Set(), done: false });
      // Fire-and-forget — progress is surfaced through SSE. We also wrap the
      // whole run in a wall-clock timeout so it can never hang silently: if
      // nothing finishes the run within 20 minutes, we emit an error event
      // and cut the run so the user sees a clear failure.
      const HARD_TIMEOUT_MS = Math.max(
        60_000,
        Math.min(60 * 60_000, parseInt(process.env.CZ_EVAL_RUN_TIMEOUT_MS, 10) || 20 * 60_000),
      );
      const timeoutHandle = setTimeout(() => {
        const job = JOBS.get(runId);
        if (!job || job.done) return;
        const msg = `Run timed out after ${(HARD_TIMEOUT_MS / 60_000).toFixed(0)}m — aborting.`;
        console.error(`[eval] run ${runId.slice(0, 8)} ${msg}`);
        job.done = true;
        job.error = msg;
        try {
          for (const sub of job.subscribers) sub.write(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`);
        } catch { /* ignore */ }
      }, HARD_TIMEOUT_MS);

      executeRun(runId, opts)
        .catch((err) => {
          console.error(`[eval] run ${runId.slice(0, 8)} crashed:`, err?.message || err);
        })
        .finally(() => clearTimeout(timeoutHandle));

      res.json({ runId, streamUrl: `/api/eval-score/run/${runId}/stream` });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /run/:id/stream — SSE progress
  router.get('/run/:id/stream', (req, res) => {
    const runId = req.params.id;
    const job = JOBS.get(runId);
    res.writeHead(200, {
      'Content-Type':  'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection:      'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders?.();

    if (!job) {
      res.write(`data: ${JSON.stringify({ type: 'error', message: 'job not found' })}\n\n`);
      return res.end();
    }

    // Replay events emitted before the client subscribed
    for (const evt of job.events) {
      res.write(`data: ${JSON.stringify(evt)}\n\n`);
    }
    if (job.done) {
      if (job.error) {
        res.write(`data: ${JSON.stringify({ type: 'error', message: job.error })}\n\n`);
      } else if (job.report) {
        res.write(`data: ${JSON.stringify({ type: 'complete', report: job.report })}\n\n`);
      }
      return res.end();
    }

    // SSE heartbeat — comment lines every 15s. Prevents corporate proxies /
    // load balancers from closing the stream during slow scenarios, and
    // gives the browser's EventSource a reliable liveness signal.
    const heartbeat = setInterval(() => {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clearInterval(heartbeat);
      }
    }, 15_000);

    job.subscribers.add(res);
    req.on('close', () => {
      clearInterval(heartbeat);
      job.subscribers.delete(res);
    });
  });

  return router;
}

module.exports = { createEvalRunsRouter };
