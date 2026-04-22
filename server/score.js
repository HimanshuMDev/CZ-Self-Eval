// ─────────────────────────────────────────────────────────────────────────────
//  CZ Agent Score — the composite number the dashboard shows at the top.
//
//  This module is the single source of truth for "what does the score mean".
//  It takes raw per-run scenario outputs + judge results and produces:
//
//    { czScore, confidence, status, components, scenarioBreakdown, meta }
//
//  Every number here has a formula documented inline. If you disagree with a
//  number on the dashboard, trace it to the sub-score, then to the scenario,
//  then to the run — in that order. No black boxes.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const {
  RUBRIC,
  COMPONENTS,
  THRESHOLDS,
  configHash,
  statusFor,
  weightForScenario,
} = require('./rubric');

// ─── Helpers ────────────────────────────────────────────────────────────────
function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function mean(nums) {
  if (!nums.length) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}
function stdev(nums) {
  if (nums.length < 2) return 0;
  const m = mean(nums);
  return Math.sqrt(nums.reduce((a, b) => a + (b - m) ** 2, 0) / nums.length);
}
function round(n, decimals = 1) {
  const f = 10 ** decimals;
  return Math.round(n * f) / f;
}
function clamp01(v) { return Math.max(0, Math.min(1, v)); }

// ─── Single scenario score (per-run detail included) ───────────────────────
/**
 * Expects: {
 *   scenario,                       // the golden scenario
 *   runs: [                          // output of runScenarioN or richer form
 *     { pass, score, responseText, agentType, responseTimeMs, judge }
 *   ],
 *   deterministic: {                // optional deterministic checks
 *     hallucination, routingCorrect, toolAccuracy
 *   }
 * }
 */
function scoreScenario({ scenario, runs }) {
  const n = runs.length;
  const weight = weightForScenario(scenario);

  // 1. Per-run composite: 50% deterministic score, 50% judge overall (0–100).
  //    Deterministic runs already return 0.1–1.0 so we scale.
  const perRunComposite = runs.map(r => {
    const detScore = typeof r.score === 'number' ? r.score : (r.pass ? 1 : 0); // 0..1
    const judgeOverall10 = r.judge?.overall ?? 5;                             // 0..10
    const composite = 0.5 * detScore * 100 + 0.5 * judgeOverall10 * 10;       // 0..100
    return composite;
  });

  const medianScore = median(perRunComposite);
  const stdevScore  = stdev(perRunComposite);
  const flakinessRaw = stdevScore / 100;  // 0..1
  const passCount = runs.filter(r => r.pass).length;
  const passRate  = passCount / Math.max(1, n);

  // 2. Per-dim median (across runs) for the rubric breakdown
  const perDim = {};
  for (const dim of RUBRIC.dimensions) {
    const vals = runs
      .map(r => r.judge?.perDim?.[dim.id])
      .filter(v => typeof v === 'number');
    perDim[dim.id] = vals.length ? median(vals) : null;   // 0–10
  }

  // 3. Judge agreement (median across runs)
  const judgeAgreements = runs
    .map(r => r.judge?.agreement)
    .filter(v => typeof v === 'number');
  const agreement = judgeAgreements.length ? median(judgeAgreements) : null;

  // 4. Hallucination flag (any run flagged)
  const hallucinationRuns = runs.filter(r => r.hallucination).length;
  const hallucinationFreeRate = 1 - (hallucinationRuns / Math.max(1, n));

  // 5. Routing correctness rate
  const routingCorrectRuns = runs.filter(r => r.routingCorrect).length;
  const routingAccuracy = routingCorrectRuns / Math.max(1, n);

  // 6. Latency SLA compliance
  const slaMs = COMPONENTS.latencySlaMs;
  const slaRuns = runs.filter(r => (r.responseTimeMs || Infinity) <= slaMs).length;
  const latencyRate = slaRuns / Math.max(1, n);
  const medianLatency = median(runs.map(r => r.responseTimeMs || 0).filter(Boolean));

  // 7. Overall pass (matches golden.js semantics: median score ≥ min AND majority)
  const minScore = typeof scenario.minScore === 'number' ? scenario.minScore : THRESHOLDS.minScoreDefault;
  const majorityPass = passRate >= 0.5;
  const overallPass = (medianScore / 100) >= minScore && majorityPass;

  // 8. Flakiness tier
  let flakinessTier = 'stable';
  if (flakinessRaw >= THRESHOLDS.flakiness.flaky) flakinessTier = 'flaky';
  else if (flakinessRaw >= THRESHOLDS.flakiness.stable) flakinessTier = 'wobbly';

  return {
    scenarioId: scenario.id,
    title: scenario.title,
    category: scenario.category || null,
    mustPass: !!scenario.mustPass,
    weight,
    n,
    medianScore: round(medianScore, 1),           // 0..100
    stdevScore:  round(stdevScore, 2),            // 0..100
    flakiness:   round(flakinessRaw, 3),          // 0..1
    flakinessTier,
    passRate:    round(passRate, 3),
    overallPass,
    regressionAlert: !!scenario.mustPass && !overallPass,
    perDim,                                        // 0..10 per dim
    agreement,                                     // 0..1
    hallucinationFreeRate: round(hallucinationFreeRate, 3),
    routingAccuracy:       round(routingAccuracy, 3),
    latencyRate:           round(latencyRate, 3),
    medianLatency:         Math.round(medianLatency || 0),
    runs: runs.map(r => ({
      pass: r.pass,
      score: r.score,
      composite: round(0.5 * (r.score ?? 0) * 100 + 0.5 * (r.judge?.overall ?? 5) * 10, 1),
      agentType: r.agentType,
      responseTimeMs: r.responseTimeMs,
      responseText: (r.responseText || '').slice(0, 400),
      judge: r.judge ? {
        overall: r.judge.overall,
        perDim: r.judge.perDim,
        agreement: r.judge.agreement,
        agreementTier: r.judge.agreementTier,
        judges: (r.judge.judges || []).map(j => ({
          judgeId: j.judgeId,
          backend: j.backend,
          overall: j.overall,
          rationale: (j.rationale || '').slice(0, 500),
        })),
      } : null,
      hallucination: !!r.hallucination,
      routingCorrect: r.routingCorrect ?? null,
    })),
  };
}

// ─── Top-line composite score ──────────────────────────────────────────────
/**
 * Expects an array of scenario-level results from scoreScenario().
 * Returns the full payload the dashboard renders.
 *
 * @param {object} opts
 * @param {Array}  opts.scenarioResults  - output of scoreScenario() × N scenarios
 * @param {object} opts.meta             - { commitSha, modelId, judgeModel, ... }
 * @param {number} [opts.baselineScore]  - rolling baseline for delta (0–100)
 */
function computeCzScore({ scenarioResults, meta = {}, baselineScore = null }) {
  if (!scenarioResults.length) {
    return emptyReport(meta);
  }

  const totalWeight = scenarioResults.reduce((s, r) => s + r.weight, 0);
  const weightedSum = (selector) =>
    scenarioResults.reduce((sum, r) => sum + selector(r) * r.weight, 0);

  // Component 1: Golden pass rate (weighted) — 0..100
  const goldenPassRate = 100 * weightedSum(r => r.overallPass ? 1 : 0) / totalWeight;

  // Component 2: Rubric average — median score across all scenarios, 0..100
  const rubricAvg = weightedSum(r => r.medianScore) / totalWeight;

  // Component 3: Hallucination-free — 0..100
  const hallucinationFree = 100 * weightedSum(r => r.hallucinationFreeRate) / totalWeight;

  // Component 4: Routing accuracy — 0..100
  const routingAccuracy = 100 * weightedSum(r => r.routingAccuracy) / totalWeight;

  // Component 5: Latency SLA — 0..100
  const latencySla = 100 * weightedSum(r => r.latencyRate) / totalWeight;

  // Final CZ Agent Score
  const w = COMPONENTS.weights;
  const czScore =
    w.goldenPassRate    * goldenPassRate +
    w.rubricAvg         * rubricAvg +
    w.hallucinationFree * hallucinationFree +
    w.routingAccuracy   * routingAccuracy +
    w.latencySla        * latencySla;

  // Confidence band: wider when scenarios are flaky OR judges disagree
  const avgFlakiness = mean(scenarioResults.map(r => r.flakiness));
  const avgAgreement = mean(
    scenarioResults.map(r => r.agreement).filter(v => typeof v === 'number')
  );
  const disagreementPenalty = (typeof avgAgreement === 'number') ? (1 - avgAgreement) : 0.1;
  const confidence = (avgFlakiness + disagreementPenalty * 0.5) * THRESHOLDS.confidenceScale;

  // Status band
  const band = statusFor(czScore);

  // Delta vs baseline
  const deltaVsBaseline =
    typeof baselineScore === 'number' ? round(czScore - baselineScore, 1) : null;

  // Per-scenario contribution to the headline number
  const scenarioBreakdown = scenarioResults
    .map(r => {
      const contrib = (r.weight / totalWeight) * r.medianScore;
      return {
        ...r,
        contribution: round(contrib, 2),
      };
    })
    .sort((a, b) => b.contribution - a.contribution);

  // Disagreement panel — lowest-agreement scenarios
  const lowAgreement = [...scenarioResults]
    .filter(r => typeof r.agreement === 'number')
    .sort((a, b) => a.agreement - b.agreement)
    .slice(0, 5)
    .map(r => ({
      scenarioId: r.scenarioId,
      title: r.title,
      agreement: r.agreement,
      medianScore: r.medianScore,
    }));

  // Top regressions (scenarios that failed overall)
  const failing = scenarioResults
    .filter(r => !r.overallPass)
    .sort((a, b) => (b.weight - a.weight) || (a.medianScore - b.medianScore));

  return {
    czScore:           round(czScore, 1),
    confidence:        round(confidence, 1),
    deltaVsBaseline,
    baselineScore:     typeof baselineScore === 'number' ? round(baselineScore, 1) : null,
    status:            band,
    components: {
      goldenPassRate:    round(goldenPassRate, 1),
      rubricAvg:         round(rubricAvg, 1),
      hallucinationFree: round(hallucinationFree, 1),
      routingAccuracy:   round(routingAccuracy, 1),
      latencySla:        round(latencySla, 1),
      weights:           COMPONENTS.weights,
    },
    stats: {
      totalScenarios: scenarioResults.length,
      passed:         scenarioResults.filter(r => r.overallPass).length,
      failed:         scenarioResults.filter(r => !r.overallPass).length,
      flaky:          scenarioResults.filter(r => r.flakinessTier === 'flaky').length,
      mustPassTotal:  scenarioResults.filter(r => r.mustPass).length,
      mustPassFailed: scenarioResults.filter(r => r.mustPass && !r.overallPass).length,
      avgAgreement:   round(avgAgreement || 0, 3),
      avgFlakiness:   round(avgFlakiness, 3),
    },
    scenarioBreakdown,
    lowAgreement,
    failing: failing.map(f => ({
      scenarioId: f.scenarioId,
      title: f.title,
      weight: f.weight,
      medianScore: f.medianScore,
      reason: f.runs?.[0]?.reason || 'see run detail',
    })),
    meta: {
      ...meta,
      configHash:  configHash(),
      rubricVersion: RUBRIC.version,
      computedAt:  new Date().toISOString(),
    },
  };
}

function emptyReport(meta) {
  return {
    czScore: 0,
    confidence: 0,
    deltaVsBaseline: null,
    baselineScore: null,
    status: statusFor(0),
    components: {
      goldenPassRate: 0, rubricAvg: 0, hallucinationFree: 0,
      routingAccuracy: 0, latencySla: 0, weights: COMPONENTS.weights,
    },
    stats: {
      totalScenarios: 0, passed: 0, failed: 0, flaky: 0,
      mustPassTotal: 0, mustPassFailed: 0,
      avgAgreement: 0, avgFlakiness: 0,
    },
    scenarioBreakdown: [],
    lowAgreement: [],
    failing: [],
    meta: {
      ...meta,
      configHash: configHash(),
      rubricVersion: RUBRIC.version,
      computedAt: new Date().toISOString(),
    },
  };
}

module.exports = {
  scoreScenario,
  computeCzScore,
};
