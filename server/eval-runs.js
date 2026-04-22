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

const fs      = require('fs').promises;
const path    = require('path');
const express = require('express');
const { randomUUID } = require('crypto');

const { getScenarios, getMeta } = require('./eval-evidence');
const { toScoringScenario, runScenarioOnce } = require('./evidence-runner');
const { judgeReply } = require('./judge');
const { scoreScenario, computeCzScore } = require('./score');
const { THRESHOLDS } = require('./rubric');

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
    const scenarioResults = [];
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

      // Flows are deterministic and expensive — 1 repeat. Single-turn uses N.
      const repeats = scenario.evidence.kind === 'flow' ? 1 : n;
      const runs = [];
      for (let i = 0; i < repeats; i++) {
        const r = await runScenarioOnce(scenario, { agentUrl });

        // Judge the reply (single-turn text; for flows this is the final turn)
        let judge = null;
        if (!r.error) {
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
        }

        const instr = instrumentRun(
          { responseText: r.responseText, agentType: r.agentType },
          scenario
        );

        runs.push({
          pass: r.pass,
          score: r.score,
          reason: r.reason,
          responseText: r.responseText,
          agentType: r.agentType,
          responseTimeMs: r.responseTimeMs,
          turnResults: r.turnResults || null,   // flow detail for the dashboard
          judge,
          ...instr,
        });
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
      idxList.unshift({
        id: runId, czScore: 0, status: 'Error', statusTone: 'red',
        deltaVsBaseline: null, scope: opts.scope || 'mustPass', n: opts.n || 3,
        passed: 0, failed: 0, flaky: 0, runAt: new Date().toISOString(),
        error: err.message,
      });
      await saveIndex(idxList.slice(0, 200));
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

  // GET /runs — list
  router.get('/runs', async (_req, res) => {
    try {
      const idx = await loadIndex();
      res.json({ count: idx.length, runs: idx.slice(0, 50) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // GET /runs/:id — full report
  router.get('/runs/:id', async (req, res) => {
    try {
      const report = await loadReport(req.params.id);
      res.json(report);
    } catch (err) {
      if (err.code === 'ENOENT') return res.status(404).json({ error: 'not found' });
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
      const opts = {
        n:         Math.max(1, Math.min(10, parseInt(b.n, 10) || 3)),
        scope:     ['all', 'tag', 'agent', 'mustPass'].includes(b.scope) ? b.scope : 'mustPass',
        tags:      Array.isArray(b.tags)      ? b.tags      : null,
        agents:    Array.isArray(b.agents)    ? b.agents    : null,
        caseTypes: Array.isArray(b.caseTypes) ? b.caseTypes : null,
        evalTypes: Array.isArray(b.evalTypes) ? b.evalTypes : null,
        kinds:     Array.isArray(b.kinds)     ? b.kinds     : null,
        limit:     typeof b.limit === 'number' && b.limit > 0 ? Math.floor(b.limit) : null,
        useLlm:    !!b.useLlm,
        agentUrl:  b.agentUrl,
      };
      JOBS.set(runId, { events: [], subscribers: new Set(), done: false });
      // Fire-and-forget — progress is surfaced through SSE
      executeRun(runId, opts).catch(() => {});
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

    job.subscribers.add(res);
    req.on('close', () => { job.subscribers.delete(res); });
  });

  return router;
}

module.exports = { createEvalRunsRouter };
