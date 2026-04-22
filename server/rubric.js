// ─────────────────────────────────────────────────────────────────────────────
//  CZ Agent Rubric + Scoring Config
//
//  Every number the Eval Score tab shows traces back to this file. Treat it
//  as versioned configuration: edits land in git, are reviewed in PR, and
//  produce a deterministic hash that is stamped on every eval run. When the
//  hash changes, the dashboard knows a historical score isn't apples-to-apples
//  with today's score.
//
//  There are four sections:
//    1. RUBRIC              — the 5 sub-dimensions the judge grades on
//    2. COMPONENTS          — the 5 top-line components of the CZ Agent Score
//    3. SCENARIO_WEIGHTS    — default per-category weights (1–5 importance)
//    4. THRESHOLDS          — status bands, flakiness, confidence, SLAs
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const crypto = require('crypto');

// ─── 1. Rubric dimensions (judge grades each on 0–10) ──────────────────────
// Weight column must sum to 1.0
const RUBRIC = {
  version: '1.0.0',
  dimensions: [
    {
      id: 'goal',
      label: 'Goal Completion',
      weight: 0.40,
      prompt: 'Did the reply fully answer what the user asked for? 10 = fully resolved, 7 = partially, 4 = deflected, 0 = wrong or harmful.',
    },
    {
      id: 'routing',
      label: 'Routing Correctness',
      weight: 0.20,
      prompt: 'Was this handled by the correct sub-agent (Discovery, Session, Payment, Support, FAQ)? 10 = exact match, 5 = plausible but suboptimal, 0 = wrong agent.',
    },
    {
      id: 'efficiency',
      label: 'Efficiency',
      weight: 0.20,
      prompt: 'Did the bot reach the answer without unnecessary loops or repetition? 10 = single-turn resolution, 5 = one redundant turn, 0 = multiple loops.',
    },
    {
      id: 'accuracy',
      label: 'Factual Accuracy',
      weight: 0.10,
      prompt: 'Every claim in the reply must be grounded in tool output or verified context. 10 = all grounded, 5 = one unverifiable claim, 0 = fabricated facts.',
    },
    {
      id: 'quality',
      label: 'Quality & Tone',
      weight: 0.10,
      prompt: 'Clarity, brevity, right language, respectful tone. 10 = polished, 5 = acceptable, 0 = rude or confusing.',
    },
  ],
};

// ─── 2. CZ Agent Score — top-level composite weights ───────────────────────
// Must sum to 1.0
const COMPONENTS = {
  version: '1.0.0',
  weights: {
    goldenPassRate:    0.40,  // % of scenarios that passed (weighted)
    rubricAvg:         0.30,  // LLM judge rubric average
    hallucinationFree: 0.15,  // % of runs with zero fabricated claims
    routingAccuracy:   0.10,  // % of runs routed to correct sub-agent
    latencySla:        0.05,  // % of runs under latency SLA
  },
  latencySlaMs: 10_000,        // 10 s SLA — replies slower than this count as miss
};

// ─── 3. Default scenario-category weights (1 = nice-to-have, 5 = existential) ─
const SCENARIO_WEIGHTS = {
  safety:        5,  // fire / smoke / medical — never lose these
  payment:       4,  // money movement
  booking:       4,  // session start / stop
  support:       3,  // RFID, tickets, account
  discovery:     2,  // find stations
  faq:           2,  // info questions
  language:      2,  // Hinglish / Hindi handling
  edgeCase:      2,
  adversarial:   3,  // prompt injection / jailbreak
  default:       2,
};

// ─── 4. Status bands + thresholds ──────────────────────────────────────────
const THRESHOLDS = {
  // Final CZ Agent Score bands (0–100)
  status: [
    { min: 90, label: 'Excellent', color: '#10b981', tone: 'green' },
    { min: 80, label: 'Healthy',   color: '#22c55e', tone: 'green' },
    { min: 70, label: 'Watch',     color: '#f59e0b', tone: 'yellow' },
    { min: 60, label: 'Degraded',  color: '#f97316', tone: 'orange' },
    { min:  0, label: 'Critical',  color: '#ef4444', tone: 'red' },
  ],
  // Flakiness (stdev of scores across N runs, 0–1)
  flakiness: {
    stable: 0.10,    // below this = stable
    flaky:  0.25,    // above this = unacceptable on must-pass
  },
  // Judge-ensemble agreement (1 = unanimous, 0 = maximum spread)
  judgeAgreement: {
    strong: 0.85,
    weak:   0.60,
  },
  // Minimum per-scenario score for pass
  minScoreDefault: 0.50,
  // Confidence band scale factor — translates flakiness + disagreement → ±
  confidenceScale: 40,   // a 0.1 stdev becomes ±4 points; tune by watching runs
  // Rolling baseline window — compare to median of this many most-recent main runs
  baselineWindow: 7,
  // Regression thresholds (delta from baseline in score points)
  regression: {
    watch:    -3,   // drop of 3 points → yellow
    block:    -10,  // drop of 10 → block merge
  },
};

// ─── Hash util — stamps every eval run with the config version ─────────────
function configHash() {
  const payload = JSON.stringify({ RUBRIC, COMPONENTS, SCENARIO_WEIGHTS, THRESHOLDS });
  return crypto.createHash('sha256').update(payload).digest('hex').slice(0, 12);
}

function statusFor(score) {
  for (const band of THRESHOLDS.status) {
    if (score >= band.min) return band;
  }
  return THRESHOLDS.status[THRESHOLDS.status.length - 1];
}

function weightForScenario(scenario) {
  // Honour an explicit weight if the scenario has one
  if (typeof scenario.weight === 'number' && scenario.weight > 0) {
    return scenario.weight;
  }
  // Else derive from category/tags
  const tags = Array.isArray(scenario.tags) ? scenario.tags : [];
  const cat = (scenario.category || '').toLowerCase();

  // Must-pass baseline bump
  const mustPassBump = scenario.mustPass ? 1 : 0;

  // Check explicit category first
  if (SCENARIO_WEIGHTS[cat] != null) return SCENARIO_WEIGHTS[cat] + mustPassBump;

  // Check tags
  for (const tag of tags) {
    const t = tag.toLowerCase();
    if (SCENARIO_WEIGHTS[t] != null) return SCENARIO_WEIGHTS[t] + mustPassBump;
  }
  return SCENARIO_WEIGHTS.default + mustPassBump;
}

module.exports = {
  RUBRIC,
  COMPONENTS,
  SCENARIO_WEIGHTS,
  THRESHOLDS,
  configHash,
  statusFor,
  weightForScenario,
};
