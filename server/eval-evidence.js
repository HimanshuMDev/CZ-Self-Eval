/**
 * Eval Evidence — canonical scenario store for the CZ self-eval app.
 *
 * Loaded from data/eval-evidence.json, which is itself a snapshot of the
 * agent repo's tests/evals/datasets/*.ts files (see scripts/sync-eval-evidence.js).
 *
 * This module replaces the old Golden Set + hardcoded Evidence Registry.
 * Everything downstream — the Eval Score runner, the dashboard, CI — pulls
 * scenarios from here.
 */
'use strict';

const fs   = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const express   = require('express');

const EVIDENCE_PATH = path.resolve(__dirname, '..', 'data', 'eval-evidence.json');
const SYNC_SCRIPT   = path.resolve(__dirname, '..', 'scripts', 'sync-eval-evidence.js');

// ─── In-memory cache with mtime-based invalidation ──────────────────────────

let cache = null;            // parsed payload
let cacheMtimeMs = 0;

function loadEvidence() {
  if (!fs.existsSync(EVIDENCE_PATH)) {
    return emptyPayload('eval-evidence.json not found — run `node scripts/sync-eval-evidence.js`');
  }
  const stat = fs.statSync(EVIDENCE_PATH);
  if (cache && stat.mtimeMs === cacheMtimeMs) return cache;

  try {
    const raw = fs.readFileSync(EVIDENCE_PATH, 'utf8');
    cache = JSON.parse(raw);
    cacheMtimeMs = stat.mtimeMs;
    return cache;
  } catch (err) {
    return emptyPayload(`Failed to parse eval-evidence.json: ${err.message}`);
  }
}

function emptyPayload(error) {
  return {
    version: 1,
    generatedAt: null,
    source: null,
    stats: { total: 0, byAgent: {}, byKind: {}, byCaseType: {}, byEvalType: {} },
    scenarios: [],
    error,
  };
}

/** Public accessor used by eval-runs.js etc. */
function getScenarios(opts = {}) {
  const payload = loadEvidence();
  let out = payload.scenarios.slice();

  if (opts.agent) {
    const set = new Set([].concat(opts.agent));
    out = out.filter(s => set.has(s.agent));
  }
  if (opts.kind) {
    out = out.filter(s => s.kind === opts.kind);
  }
  if (opts.caseType) {
    const set = new Set([].concat(opts.caseType));
    out = out.filter(s => set.has(s.caseType));
  }
  if (opts.evalType) {
    const set = new Set([].concat(opts.evalType));
    out = out.filter(s => set.has(s.evalType));
  }
  if (opts.tag) {
    const tag = String(opts.tag).toLowerCase();
    out = out.filter(s => Array.isArray(s.tags) && s.tags.some(t => String(t).toLowerCase() === tag));
  }
  if (opts.id) {
    const set = new Set([].concat(opts.id));
    out = out.filter(s => set.has(s.id));
  }
  return out;
}

function getScenarioById(id) {
  return loadEvidence().scenarios.find(s => s.id === id) || null;
}

function getStats() {
  return loadEvidence().stats;
}

function getMeta() {
  const payload = loadEvidence();
  return {
    version:     payload.version,
    generatedAt: payload.generatedAt,
    source:      payload.source,
    stats:       payload.stats,
    error:       payload.error || null,
  };
}

// ─── Express router ─────────────────────────────────────────────────────────

function createEvalEvidenceRouter() {
  const router = express.Router();

  // GET /api/eval-evidence
  //   Query params: agent=, caseType=, evalType=, kind=, tag=, q= (search),
  //                 limit=, offset=
  router.get('/', (req, res) => {
    const { agent, caseType, evalType, kind, tag, q, limit, offset } = req.query;
    let list = getScenarios({ agent, caseType, evalType, kind, tag });

    if (q) {
      const needle = String(q).toLowerCase();
      list = list.filter(s =>
        (s.id          && s.id.toLowerCase().includes(needle)) ||
        (s.name        && s.name.toLowerCase().includes(needle)) ||
        (s.description && s.description.toLowerCase().includes(needle)) ||
        (Array.isArray(s.tags) && s.tags.some(t => String(t).toLowerCase().includes(needle)))
      );
    }

    const total = list.length;
    const o = Math.max(0, parseInt(offset, 10) || 0);
    const l = Math.max(1, Math.min(parseInt(limit, 10) || 500, 1000));
    const page = list.slice(o, o + l);

    res.json({
      total,
      offset: o,
      limit: l,
      scenarios: page,
      meta: getMeta(),
    });
  });

  // GET /api/eval-evidence/stats
  router.get('/stats', (_req, res) => {
    res.json({ ...getMeta(), stats: getStats() });
  });

  // GET /api/eval-evidence/meta  (sync status, version, paths)
  router.get('/meta', (_req, res) => {
    res.json(getMeta());
  });

  // GET /api/eval-evidence/:id
  router.get('/:id', (req, res) => {
    const s = getScenarioById(req.params.id);
    if (!s) return res.status(404).json({ error: 'scenario not found' });
    res.json(s);
  });

  // POST /api/eval-evidence/sync — re-run the snapshot script, stream progress
  router.post('/sync', (req, res) => {
    const child = spawn(process.execPath, [SYNC_SCRIPT], {
      cwd: path.resolve(__dirname, '..'),
      env: process.env,
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', chunk => { stdout += chunk.toString(); });
    child.stderr.on('data', chunk => { stderr += chunk.toString(); });

    child.on('close', (code) => {
      // Force cache invalidation on next read.
      cache = null; cacheMtimeMs = 0;
      const ok = code === 0;
      res.status(ok ? 200 : 500).json({
        ok,
        exitCode: code,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        meta: getMeta(),
      });
    });

    child.on('error', (err) => {
      res.status(500).json({ ok: false, error: err.message });
    });
  });

  return router;
}

module.exports = {
  createEvalEvidenceRouter,
  getScenarios,
  getScenarioById,
  getStats,
  getMeta,
};
