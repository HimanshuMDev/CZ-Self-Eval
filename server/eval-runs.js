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

const { loadStore, callAgent, evaluateResponse } = require('./golden');
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
    scope = 'mustPass',      // 'mustPass' | 'all' | 'tag'
    tags = null,
    useLlm = false,
    agentUrl,
  } = opts;

  try {
    // 1. Load scenarios
    const store = await loadStore();
    let scenarios = store.scenarios || [];
    if (scope === 'mustPass') scenarios = scenarios.filter(s => s.mustPass);
    if (scope === 'tag' && Array.isArray(tags) && tags.length) {
      scenarios = scenarios.filter(s =>
        Array.isArray(s.tags) && s.tags.some(t => tags.includes(t))
      );
    }
    if (!scenarios.length) {
      throw new Error('No scenarios matched the current scope/tag filter.');
    }

    emit(runId, { type: 'start', total: scenarios.length, n, scope });

    // 2. For each scenario, run N times, judge each reply, score
    const scenarioResults = [];
    let idx = 0;
    for (const scenario of scenarios) {
      idx++;
      emit(runId, {
        type: 'scenario-start',
        scenarioId: scenario.id,
        title: scenario.title,
        idx,
        total: scenarios.length,
      });

      const runs = [];
      for (let i = 0; i < n; i++) {
        let agent;
        try {
          agent = await callAgent(scenario.initialMessage, { agentUrl });
        } catch (err) {
          runs.push({
            pass: false,
            score: 0,
            reason: `Agent call failed: ${err.message}`,
            responseText: '',
            agentType: null,
            responseTimeMs: 0,
            error: err.message,
            hallucination: false,
            routingCorrect: null,
          });
          continue;
        }

        const det = evaluateResponse(agent.content, {
          ...scenario,
          observedSubAgent: agent.agentType,
        });

        // Three-judge ensemble on every run
        const judge = await judgeReply({
          text: agent.content,
          scenario,
          observedSubAgent: agent.agentType,
          useLlm,
        });

        const instr = instrumentRun(
          { responseText: agent.content, agentType: agent.agentType },
          scenario
        );

        runs.push({
          pass: det.pass,
          score: det.score,
          reason: det.reason,
          responseText: agent.content,
          agentType: agent.agentType,
          responseTimeMs: agent.responseTimeMs,
          judge,
          ...instr,
        });
      }

      const scenarioScore = scoreScenario({ scenario, runs });
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
  router.post('/run', async (req, res) => {
    try {
      const runId = randomUUID();
      const opts = {
        n:       Math.max(1, Math.min(10, parseInt(req.body?.n, 10) || 3)),
        scope:   req.body?.scope === 'all' ? 'all'
               : req.body?.scope === 'tag' ? 'tag'
               : 'mustPass',
        tags:    Array.isArray(req.body?.tags) ? req.body.tags : null,
        useLlm:  !!req.body?.useLlm,
        agentUrl: req.body?.agentUrl,
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
