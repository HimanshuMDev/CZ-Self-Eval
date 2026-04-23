// ─────────────────────────────────────────────────────────────────────────────
//  Eval Evidence — User-authored store
//
//  A second-tier evidence layer that sits alongside the synced agent-repo
//  snapshot (data/eval-evidence.json). Everything mined from real chat
//  sessions via "Generate Evidence" lands here instead of polluting the
//  synced file, so `node scripts/sync-eval-evidence.js` stays idempotent
//  and user creations are never overwritten.
//
//  Endpoints (mounted at /api/eval-evidence/user):
//    GET    /               — list all user-authored scenarios
//    POST   /               — append a single scenario
//    POST   /batch          — append many at once (used by "Save selected")
//    PUT    /:id            — edit one
//    DELETE /:id            — remove one
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const fs      = require('fs').promises;
const fsSync  = require('fs');
const path    = require('path');
const express = require('express');
const { randomUUID } = require('crypto');

const STORE_PATH = path.resolve(__dirname, '..', 'data', 'eval-evidence-user.json');

// ─── Storage helpers ────────────────────────────────────────────────────────

function emptyStore() {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    scenarios: [],
  };
}

async function readStore() {
  try {
    const raw = await fs.readFile(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.scenarios)) return emptyStore();
    return parsed;
  } catch (err) {
    if (err.code === 'ENOENT') return emptyStore();
    throw err;
  }
}

async function writeStore(store) {
  store.generatedAt = new Date().toISOString();
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, JSON.stringify(store, null, 2) + '\n');
}

// Sync version used by readers who can't await (index/merge at boot time).
function readStoreSync() {
  try {
    const raw = fsSync.readFileSync(STORE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.scenarios)) return emptyStore();
    return parsed;
  } catch {
    return emptyStore();
  }
}

// ─── Normalisation ──────────────────────────────────────────────────────────
// Ensures every scenario has the envelope fields the dashboard expects.

function normaliseScenario(sc) {
  const id = sc.id || `user-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`;
  return {
    id,
    name: sc.name || sc.title || id,
    agent: sc.agent || 'support',
    kind: sc.kind === 'flow' ? 'flow' : 'single',
    tags: Array.isArray(sc.tags) ? sc.tags : [],
    caseType: sc.caseType || 'negative',
    evalType: sc.evalType || 'regression',
    source: sc.source || 'user-generated',
    createdAt: sc.createdAt || new Date().toISOString(),
    origin: sc.origin || { kind: 'user-generated' },     // e.g. { kind: 'chat-mined', sessionIds: [...] }
    task: sc.task || {
      id,
      name: sc.name || sc.title || id,
      description: sc.description || '',
      tags: Array.isArray(sc.tags) ? sc.tags : [],
      caseType: sc.caseType || 'negative',
      evalType: sc.evalType || 'regression',
      input: sc.input || {
        userMessage: '',
        userId: `user-eval-${Date.now()}`,
        channel: 'whatsapp',
      },
      codeGradedCriteria: sc.codeGradedCriteria || {
        expectedAgentType: sc.agent || 'support',
        responseMustBeNonEmpty: true,
        responseMustNotContain: [],
        responseMustContainOneOf: [],
      },
      modelGradedRubric: sc.modelGradedRubric || undefined,
    },
  };
}

// ─── Public loader used by other server modules ─────────────────────────────

function getUserScenarios() {
  return readStoreSync().scenarios;
}

// ─── Express router ─────────────────────────────────────────────────────────

function createEvalEvidenceUserRouter() {
  const router = express.Router();

  router.get('/', async (_req, res) => {
    try {
      const store = await readStore();
      res.json({ count: store.scenarios.length, scenarios: store.scenarios });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const sc = normaliseScenario(req.body || {});
      const store = await readStore();
      if (store.scenarios.some((x) => x.id === sc.id)) {
        return res.status(409).json({ error: `scenario id already exists: ${sc.id}` });
      }
      store.scenarios.push(sc);
      await writeStore(store);
      res.json({ ok: true, scenario: sc });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post('/batch', async (req, res) => {
    try {
      const list = Array.isArray(req.body?.scenarios) ? req.body.scenarios : [];
      if (list.length === 0) return res.status(400).json({ error: 'scenarios: []' });
      const store = await readStore();
      const existing = new Set(store.scenarios.map((s) => s.id));
      const added = [];
      for (const input of list) {
        const sc = normaliseScenario(input);
        if (existing.has(sc.id)) continue;     // skip silently; caller can inspect added.length
        store.scenarios.push(sc);
        existing.add(sc.id);
        added.push(sc);
      }
      await writeStore(store);
      res.json({ ok: true, addedCount: added.length, skipped: list.length - added.length, added });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put('/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const store = await readStore();
      const idx = store.scenarios.findIndex((s) => s.id === id);
      if (idx === -1) return res.status(404).json({ error: 'not found' });
      const merged = normaliseScenario({ ...store.scenarios[idx], ...req.body, id });
      store.scenarios[idx] = merged;
      await writeStore(store);
      res.json({ ok: true, scenario: merged });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  router.delete('/:id', async (req, res) => {
    try {
      const id = req.params.id;
      const store = await readStore();
      const next = store.scenarios.filter((s) => s.id !== id);
      if (next.length === store.scenarios.length) {
        return res.status(404).json({ error: 'not found' });
      }
      store.scenarios = next;
      await writeStore(store);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = {
  createEvalEvidenceUserRouter,
  getUserScenarios,
  normaliseScenario,
  readStore,
  writeStore,
};
