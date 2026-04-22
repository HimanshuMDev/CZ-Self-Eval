// ─────────────────────────────────────────────────────────────────────────────
//  Golden Scenarios — file-backed store + N-repetition runner
//
//  The golden set is the versioned baseline the CZ AI agent must pass on.
//  Storage is a single JSON file committed to git (data/golden.json) so
//  scenarios are code-reviewable and CI-runnable without a database.
// ─────────────────────────────────────────────────────────────────────────────

const fs      = require('fs').promises;
const path    = require('path');
const express = require('express');

const GOLDEN_FILE = path.resolve(__dirname, '..', 'data', 'golden.json');
const LOCK_FILE   = GOLDEN_FILE + '.lock';

const DEFAULT_AGENT_URL = process.env.CZ_AGENT_URL
  || 'https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate';
const DEFAULT_TEST_FROM = process.env.CZ_AGENT_TEST_FROM || '919000000001';
const DEFAULT_TEST_NAME = process.env.CZ_AGENT_TEST_NAME || 'GoldenBot';

// ─── File-lock ──────────────────────────────────────────────────────────────
async function withFileLock(fn, maxRetries = 5) {
  let lastError;
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const fd = await fs.open(LOCK_FILE, 'wx');
      await fd.close();
      try {
        return await fn();
      } finally {
        try { await fs.unlink(LOCK_FILE); } catch (_) { /* noop */ }
      }
    } catch (err) {
      lastError = err;
      if (err.code === 'EEXIST' && attempt < maxRetries - 1) {
        await new Promise(r => setTimeout(r, 100));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

// ─── Load / Save ────────────────────────────────────────────────────────────
async function loadStore() {
  try {
    const txt = await fs.readFile(GOLDEN_FILE, 'utf-8');
    const data = JSON.parse(txt);
    if (!data.scenarios) data.scenarios = [];
    return data;
  } catch (err) {
    if (err.code === 'ENOENT') {
      return { version: 1, updatedAt: new Date().toISOString(), scenarios: [] };
    }
    throw err;
  }
}

async function saveStore(store) {
  store.updatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(GOLDEN_FILE), { recursive: true });
  await fs.writeFile(GOLDEN_FILE, JSON.stringify(store, null, 2) + '\n', 'utf-8');
}

// ─── Validation ─────────────────────────────────────────────────────────────
function validateScenario(s) {
  const errors = [];
  if (!s.title || typeof s.title !== 'string') errors.push('title is required');
  if (!s.initialMessage || typeof s.initialMessage !== 'string') errors.push('initialMessage is required');
  if (!s.expectedAnswer || typeof s.expectedAnswer !== 'string') errors.push('expectedAnswer is required');
  if (s.language && !['English', 'Hindi', 'Hinglish'].includes(s.language))
    errors.push('language must be English, Hindi, or Hinglish');
  if (s.mustPass !== undefined && typeof s.mustPass !== 'boolean')
    errors.push('mustPass must be boolean');
  if (s.minScore !== undefined && (typeof s.minScore !== 'number' || s.minScore < 0 || s.minScore > 1))
    errors.push('minScore must be between 0 and 1');
  return errors;
}

function normalizeScenario(s, existing = {}) {
  const now = new Date().toISOString();
  return {
    id: s.id || existing.id || `golden_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    title: String(s.title || '').trim(),
    description: String(s.description || '').trim(),
    language: s.language || existing.language || 'English',
    expectedSubAgent: s.expectedSubAgent || existing.expectedSubAgent || null,
    initialMessage: String(s.initialMessage || '').trim(),
    expectedAnswer: String(s.expectedAnswer || '').trim(),
    passKeywords: Array.isArray(s.passKeywords) ? s.passKeywords : [],
    failKeywords: Array.isArray(s.failKeywords) ? s.failKeywords : [],
    tags: Array.isArray(s.tags) ? s.tags : [],
    mustPass: Boolean(s.mustPass),
    minScore: typeof s.minScore === 'number' ? s.minScore : 0.5,
    notes: String(s.notes || existing.notes || '').trim(),
    createdAt: existing.createdAt || now,
    updatedAt: now,
  };
}

// ─── Bot caller ─────────────────────────────────────────────────────────────
async function callAgent(message, opts = {}) {
  const url = opts.url || DEFAULT_AGENT_URL;
  const from = opts.from || DEFAULT_TEST_FROM;
  const name = opts.name || DEFAULT_TEST_NAME;
  const started = Date.now();

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, name, message }),
  });

  const responseTimeMs = Date.now() - started;

  if (!res.ok) {
    throw new Error(`Agent returned ${res.status}: ${res.statusText}`);
  }
  const data = await res.json();

  let content = '';
  let agentType = null;
  if (data?.success && data?.response?.content) {
    content = String(data.response.content);
    agentType = data.agentType || data.response.agentType || null;
  } else if (typeof data === 'string') {
    content = data;
  } else if (data?.content) {
    content = String(data.content);
    agentType = data.agentType || null;
  } else if (data?.text) {
    content = String(data.text);
  } else if (data?.message && typeof data.message === 'string') {
    content = data.message;
  } else {
    content = JSON.stringify(data);
  }

  return { content, agentType, responseTimeMs };
}

// ─── Evaluator ──────────────────────────────────────────────────────────────
function evaluateResponse(responseText, scenario) {
  const text = String(responseText || '');
  const lower = text.toLowerCase();
  const failures = [];

  // Fail keywords — any match is a hard fail
  for (const kw of scenario.failKeywords || []) {
    try {
      const re = new RegExp(kw, 'i');
      if (re.test(text)) {
        failures.push(`matched fail pattern: ${kw}`);
      }
    } catch {
      if (lower.includes(kw.toLowerCase())) {
        failures.push(`contained forbidden phrase: ${kw}`);
      }
    }
  }

  // Pass keywords — must all match (each can be regex with alternation)
  const missingPass = [];
  for (const kw of scenario.passKeywords || []) {
    try {
      const re = new RegExp(kw, 'i');
      if (!re.test(text)) missingPass.push(kw);
    } catch {
      if (!lower.includes(kw.toLowerCase())) missingPass.push(kw);
    }
  }

  // Sub-agent routing check (optional)
  const routingOk = !scenario.expectedSubAgent
    || !scenario.observedSubAgent
    || scenario.observedSubAgent === scenario.expectedSubAgent;

  let score;
  if (failures.length > 0) {
    score = 0.1;
  } else if (missingPass.length > 0) {
    const passRatio = 1 - (missingPass.length / Math.max(1, (scenario.passKeywords || []).length));
    score = Math.max(0.3, Math.min(0.55, 0.3 + passRatio * 0.25));
  } else {
    // All keywords satisfied — score by length/structure bonus up to 1.0
    const lengthScore = Math.min(1, text.length / 200);
    const structureScore = text.includes('\n') ? 0.05 : 0;
    score = Math.min(1, 0.75 + lengthScore * 0.15 + structureScore);
  }

  const pass = failures.length === 0 && missingPass.length === 0 && routingOk;

  let reason;
  if (failures.length > 0) {
    reason = `Response contains forbidden pattern(s): ${failures.join('; ')}`;
  } else if (missingPass.length > 0) {
    reason = `Response missing expected term(s): ${missingPass.join(', ')}`;
  } else if (!routingOk) {
    reason = `Routed to ${scenario.observedSubAgent} but expected ${scenario.expectedSubAgent}`;
  } else {
    reason = `All expected criteria satisfied`;
  }

  return {
    pass,
    score: Math.round(score * 100) / 100,
    reason,
    failures,
    missingPass,
    routingOk,
    responseText: text.slice(0, 400),
  };
}

// ─── Stats ──────────────────────────────────────────────────────────────────
function median(nums) {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function stdev(nums) {
  if (nums.length < 2) return 0;
  const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
  const variance = nums.reduce((a, b) => a + (b - avg) ** 2, 0) / nums.length;
  return Math.sqrt(variance);
}

// ─── N-repetition runner ────────────────────────────────────────────────────
async function runScenarioN(scenario, n = 3, opts = {}) {
  const runs = [];
  for (let i = 0; i < n; i++) {
    try {
      const agent = await callAgent(scenario.initialMessage, opts);
      const evalResult = evaluateResponse(agent.content, {
        ...scenario,
        observedSubAgent: agent.agentType,
      });
      runs.push({
        index: i,
        pass: evalResult.pass,
        score: evalResult.score,
        reason: evalResult.reason,
        responseText: evalResult.responseText,
        responseTimeMs: agent.responseTimeMs,
        agentType: agent.agentType,
      });
    } catch (err) {
      runs.push({
        index: i,
        pass: false,
        score: 0,
        reason: `Agent call failed: ${err.message}`,
        responseText: '',
        responseTimeMs: 0,
        agentType: null,
        error: err.message,
      });
    }
  }

  const scores = runs.map(r => r.score);
  const passCount = runs.filter(r => r.pass).length;
  const medianScore = median(scores);
  const stdevScore = stdev(scores);
  const flaky = runs.length >= 2 && new Set(runs.map(r => r.pass)).size > 1;

  // Overall pass = median score >= minScore AND at least majority passed
  const minScore = typeof scenario.minScore === 'number' ? scenario.minScore : 0.5;
  const majorityPass = passCount / runs.length >= 0.5;
  const overallPass = medianScore >= minScore && majorityPass;

  return {
    scenarioId: scenario.id,
    scenarioTitle: scenario.title,
    mustPass: !!scenario.mustPass,
    minScore,
    n,
    runs,
    medianScore: Math.round(medianScore * 100) / 100,
    stdevScore: Math.round(stdevScore * 1000) / 1000,
    passCount,
    failCount: runs.length - passCount,
    flaky,
    overallPass,
    regressionAlert: !!scenario.mustPass && !overallPass,
    runAt: new Date().toISOString(),
  };
}

// ─── Express router ─────────────────────────────────────────────────────────
function createGoldenRouter() {
  const router = express.Router();

  // List all scenarios + store metadata
  router.get('/', async (_req, res) => {
    try {
      const store = await loadStore();
      res.json({
        version: store.version,
        updatedAt: store.updatedAt,
        count: store.scenarios.length,
        scenarios: store.scenarios,
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Get single scenario
  router.get('/:id', async (req, res) => {
    try {
      const store = await loadStore();
      const s = store.scenarios.find(x => x.id === req.params.id);
      if (!s) return res.status(404).json({ error: 'Scenario not found' });
      res.json(s);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Create scenario
  router.post('/', async (req, res) => {
    try {
      const errs = validateScenario(req.body);
      if (errs.length) return res.status(400).json({ error: 'Validation failed', details: errs });
      await withFileLock(async () => {
        const store = await loadStore();
        const scenario = normalizeScenario(req.body);
        if (store.scenarios.some(s => s.id === scenario.id)) {
          throw Object.assign(new Error('Scenario id already exists'), { code: 409 });
        }
        store.scenarios.push(scenario);
        await saveStore(store);
        res.status(201).json(scenario);
      });
    } catch (err) {
      const status = err.code === 409 ? 409 : 500;
      res.status(status).json({ error: err.message });
    }
  });

  // Update scenario
  router.put('/:id', async (req, res) => {
    try {
      const errs = validateScenario(req.body);
      if (errs.length) return res.status(400).json({ error: 'Validation failed', details: errs });
      await withFileLock(async () => {
        const store = await loadStore();
        const idx = store.scenarios.findIndex(s => s.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'Scenario not found' });
        const existing = store.scenarios[idx];
        store.scenarios[idx] = normalizeScenario({ ...req.body, id: req.params.id }, existing);
        await saveStore(store);
        res.json(store.scenarios[idx]);
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Delete scenario
  router.delete('/:id', async (req, res) => {
    try {
      await withFileLock(async () => {
        const store = await loadStore();
        const before = store.scenarios.length;
        store.scenarios = store.scenarios.filter(s => s.id !== req.params.id);
        if (store.scenarios.length === before) {
          return res.status(404).json({ error: 'Scenario not found' });
        }
        await saveStore(store);
        res.json({ ok: true });
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Run single scenario N times
  router.post('/:id/run', async (req, res) => {
    try {
      const store = await loadStore();
      const scenario = store.scenarios.find(s => s.id === req.params.id);
      if (!scenario) return res.status(404).json({ error: 'Scenario not found' });
      const n = Math.max(1, Math.min(10, Number(req.body?.n) || 3));
      const result = await runScenarioN(scenario, n, {
        url: req.body?.agentUrl,
        from: req.body?.from,
        name: req.body?.name,
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Run ALL scenarios — streaming via SSE
  router.get('/run-all/stream', async (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    const emit = (event, payload) => {
      res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    try {
      const store = await loadStore();
      const n = Math.max(1, Math.min(10, Number(req.query.n) || 3));
      const filter = req.query.mustPassOnly === '1';
      const scenarios = filter ? store.scenarios.filter(s => s.mustPass) : store.scenarios;

      emit('batch-start', { total: scenarios.length, n, startedAt: new Date().toISOString() });

      const results = [];
      let mustPassFailures = 0;
      for (let i = 0; i < scenarios.length; i++) {
        const s = scenarios[i];
        emit('batch-progress', { index: i, total: scenarios.length, scenarioId: s.id, scenarioTitle: s.title });
        try {
          const r = await runScenarioN(s, n);
          results.push(r);
          if (r.regressionAlert) mustPassFailures++;
          emit('scenario-result', r);
        } catch (err) {
          emit('scenario-error', { scenarioId: s.id, error: err.message });
        }
      }

      const passAll = results.filter(r => r.overallPass).length;
      const flaky   = results.filter(r => r.flaky).length;
      emit('batch-complete', {
        total: results.length,
        passed: passAll,
        failed: results.length - passAll,
        mustPassFailures,
        flaky,
        results,
        finishedAt: new Date().toISOString(),
      });
      res.end();
    } catch (err) {
      emit('batch-error', { error: err.message });
      res.end();
    }
  });

  // Export — for git versioning / CI
  router.get('/export', async (_req, res) => {
    try {
      const store = await loadStore();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="golden.json"');
      res.send(JSON.stringify(store, null, 2));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Import — replace store from JSON
  router.post('/import', async (req, res) => {
    try {
      const body = req.body;
      if (!body || !Array.isArray(body.scenarios)) {
        return res.status(400).json({ error: 'Expected { scenarios: [...] } in body' });
      }
      await withFileLock(async () => {
        const store = {
          version: body.version || 1,
          updatedAt: new Date().toISOString(),
          scenarios: body.scenarios.map(s => normalizeScenario(s, s)),
        };
        await saveStore(store);
        res.json({ ok: true, count: store.scenarios.length });
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createGoldenRouter,
  loadStore,
  runScenarioN,
  callAgent,
  evaluateResponse,
  median,
  stdev,
};
