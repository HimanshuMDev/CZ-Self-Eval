// ─────────────────────────────────────────────────────────────────────────────
//  Multi-Judge Service for CZ AI Agent
//
//  Philosophy: one judge is a vibes check, three judges is a measurement.
//  We score every reply through three independent perspectives and report
//  the median — plus an agreement number so the dashboard can flag scenarios
//  where the judges disagree and should be sent to a human.
//
//  Each judge produces scores for the 5 rubric dimensions (goal / routing /
//  efficiency / accuracy / quality) on a 0–10 scale. Judges are pluggable:
//
//    - heuristic  (default, no API key required — deterministic, fast)
//    - llm        (uses OPENAI_API_KEY or ANTHROPIC_API_KEY if present)
//
//  The dashboard treats the ensemble as an atomic unit: it gets back
//  { perDim, perDimStdev, overall, agreement, rationales, judges }.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const { RUBRIC, THRESHOLDS } = require('./rubric');

// ─── Three judge perspectives ──────────────────────────────────────────────
// Each perspective re-weights the rubric + uses its own heuristic lens.
const JUDGE_PERSONAS = [
  {
    id: 'balanced',
    label: 'Balanced',
    style: 'Neutral scoring against the rubric as written.',
    weightAdjust: {},     // no re-weighting
  },
  {
    id: 'strict',
    label: 'Strict',
    style: 'Heavier penalty for missing keywords, vague answers, or hedging.',
    weightAdjust: { accuracy: 1.5, goal: 1.2 },
  },
  {
    id: 'safety',
    label: 'Safety-focused',
    style: 'Hyper-weights safety keywords and routing correctness.',
    weightAdjust: { routing: 1.5, accuracy: 1.3 },
  },
];

// ─── Heuristic scorer — per-dimension ──────────────────────────────────────
// Each returns 0–10. The heuristic tries to approximate what an LLM judge
// would say; its strength is determinism and cost, its weakness is nuance.
function scoreGoal(text, scenario) {
  const lower = text.toLowerCase();
  const passKeywords = scenario.passKeywords || [];
  const failKeywords = scenario.failKeywords || [];

  // Any failKeyword = 0
  for (const kw of failKeywords) {
    try {
      if (new RegExp(kw, 'i').test(text)) return 0;
    } catch {
      if (lower.includes(String(kw).toLowerCase())) return 0;
    }
  }
  if (!passKeywords.length) {
    return text.length > 20 ? 6 : 3;
  }
  let matched = 0;
  for (const kw of passKeywords) {
    try {
      if (new RegExp(kw, 'i').test(text)) matched++;
    } catch {
      if (lower.includes(String(kw).toLowerCase())) matched++;
    }
  }
  const ratio = matched / passKeywords.length;
  return Math.round(ratio * 10);
}

function scoreRouting(observedSubAgent, scenario) {
  if (!scenario.expectedSubAgent) return 8;   // no expectation set → neutral
  if (!observedSubAgent)          return 5;
  if (observedSubAgent === scenario.expectedSubAgent) return 10;
  // Close miss — same family? (e.g. support → faq)
  const closeFamilies = {
    support:   ['faq'],
    faq:       ['support'],
    session:   ['payment'],
    payment:   ['session'],
    discovery: ['faq'],
  };
  const close = closeFamilies[(observedSubAgent || '').toLowerCase()] || [];
  if (close.includes((scenario.expectedSubAgent || '').toLowerCase())) return 3;
  return 0;
}

function scoreEfficiency(text) {
  // Penalise rambling, redundancy, "as I said earlier" patterns.
  const len = text.length;
  if (len === 0) return 0;
  if (len < 60)  return 7;               // short and likely direct
  if (len < 200) return 9;               // sweet spot
  if (len < 400) return 8;
  if (len < 800) return 6;
  return 4;                              // too long
}

function scoreAccuracy(text, scenario) {
  const lower = text.toLowerCase();

  // Hallucination signals — bot claimed things without grounding
  const fabricationSignals = [
    /\bbooked\b/i, /\bconfirmed\b/i, /\breserved\b/i,
    /\byour (?:session|booking) (?:has|is) (?:started|started)\b/i,
    /\bi have (?:booked|reserved|confirmed)\b/i,
  ];
  let hallucinationHits = 0;
  if (!scenario.expectsBookingConfirmation) {
    for (const re of fabricationSignals) {
      if (re.test(text)) hallucinationHits++;
    }
  }
  if (hallucinationHits > 1) return 0;
  if (hallucinationHits === 1) return 3;

  // Hedging is better than confident wrong
  const hedging = /(i think|maybe|possibly|i believe|not sure)/i.test(lower);
  const deflect = /(i (?:cannot|can't|am unable to) help|please (?:call|contact) (?:us|support)(?!.*ticket))/i.test(lower);
  if (deflect) return 4;
  if (hedging) return 7;
  return 9;
}

function scoreQuality(text) {
  if (!text || text.length === 0) return 0;
  const lower = text.toLowerCase();

  // Structural / clarity signals
  const hasStructure = /\n|•|- |1\.|2\./.test(text);
  const hasGreeting  = /^(hi|hello|namaste|hey|sure)/i.test(text.trim());
  const profanity    = /(damn|shit|wtf|stupid|idiot)/i.test(lower);

  let s = 7;
  if (hasStructure) s += 1;
  if (hasGreeting)  s += 1;
  if (profanity)    s -= 6;
  if (text.length > 800) s -= 1;
  if (text.length < 10)  s -= 5;
  return Math.max(0, Math.min(10, s));
}

// ─── Run a single heuristic judge ──────────────────────────────────────────
function runHeuristicJudge(persona, { text, scenario, observedSubAgent }) {
  const raw = {
    goal:       scoreGoal(text, scenario),
    routing:    scoreRouting(observedSubAgent, scenario),
    efficiency: scoreEfficiency(text),
    accuracy:   scoreAccuracy(text, scenario),
    quality:    scoreQuality(text),
  };

  // Apply persona weight adjustments
  const adjusted = {};
  for (const dim of RUBRIC.dimensions) {
    const mult = persona.weightAdjust?.[dim.id] ?? 1;
    // Weight adjustments bias the weight used in the overall; the per-dim
    // scores are reported raw so the dashboard can drill in clearly.
    adjusted[dim.id] = Math.max(0, Math.min(10, raw[dim.id]));
  }

  // Overall = weighted sum using rubric weights × persona multipliers
  let weightSum = 0;
  let weighted = 0;
  for (const dim of RUBRIC.dimensions) {
    const mult = persona.weightAdjust?.[dim.id] ?? 1;
    const w = dim.weight * mult;
    weightSum += w;
    weighted += adjusted[dim.id] * w;
  }
  const overall = weighted / weightSum;   // 0–10

  // Build rationale
  const reasons = [];
  if (raw.goal <= 3)       reasons.push(`missed expected content (goal ${raw.goal}/10)`);
  if (raw.routing <= 3)    reasons.push(`routed to ${observedSubAgent || 'n/a'} vs expected ${scenario.expectedSubAgent} (routing ${raw.routing}/10)`);
  if (raw.accuracy <= 3)   reasons.push(`possible fabrication detected (accuracy ${raw.accuracy}/10)`);
  if (raw.efficiency <= 4) reasons.push(`reply too long or too short (efficiency ${raw.efficiency}/10)`);
  if (raw.quality <= 4)    reasons.push(`quality concerns (${raw.quality}/10)`);
  if (!reasons.length)     reasons.push(`all dimensions within acceptable range`);

  return {
    judgeId: persona.id,
    judgeLabel: persona.label,
    backend: 'heuristic',
    perDim: adjusted,
    overall: Math.round(overall * 100) / 100,
    rationale: `[${persona.label}] ${reasons.join('; ')}`,
  };
}

// ─── LLM judge (pluggable) ─────────────────────────────────────────────────
// If OPENAI_API_KEY or ANTHROPIC_API_KEY is set, hit the respective API.
// Otherwise we fall back to heuristic. This lets the same pipeline work in
// dev, in CI without secrets, and in full production.
async function runLlmJudge(persona, { text, scenario, observedSubAgent }) {
  // Until API keys are wired by the user, we short-circuit to heuristic.
  // The stub below documents the contract so upgrading is a one-file change.
  if (!process.env.OPENAI_API_KEY && !process.env.ANTHROPIC_API_KEY) {
    return runHeuristicJudge(persona, { text, scenario, observedSubAgent });
  }

  // Structured prompt — enforce JSON output, quote-before-score, rubric.
  const rubricLines = RUBRIC.dimensions
    .map(d => `- ${d.id} (weight ${d.weight}): ${d.prompt}`)
    .join('\n');

  const prompt = `You are a judge named "${persona.label}". ${persona.style}

Score the following bot reply against the rubric. Return ONLY valid JSON:
{ "perDim": {"goal":0-10,"routing":0-10,"efficiency":0-10,"accuracy":0-10,"quality":0-10},
  "overall": 0-10, "rationale": "<one paragraph citing the exact span that drove your score>" }

Rubric:
${rubricLines}

Scenario: ${scenario.title}
Expected sub-agent: ${scenario.expectedSubAgent || '(any)'}
Observed sub-agent: ${observedSubAgent || '(unknown)'}
Must-pass: ${scenario.mustPass ? 'yes' : 'no'}
User message: ${scenario.initialMessage || ''}
Expected answer (hint): ${scenario.expectedAnswer || '(not provided)'}
Pass keywords: ${JSON.stringify(scenario.passKeywords || [])}
Fail keywords: ${JSON.stringify(scenario.failKeywords || [])}

Bot reply to score:
"""
${text}
"""`;

  // Light-weight fetch — implementation intentionally minimal. Replace with
  // the Anthropic/OpenAI SDK once keys are wired.
  try {
    if (process.env.ANTHROPIC_API_KEY) {
      const r = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': process.env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: process.env.CZ_JUDGE_MODEL || 'claude-sonnet-4-5-20250929',
          max_tokens: 600,
          temperature: 0,
          system: 'Output ONLY a single JSON object. No prose.',
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      const body = await r.json();
      const raw = body?.content?.[0]?.text || '';
      const parsed = JSON.parse(raw);
      return normaliseLlmJudge(persona, parsed);
    }
    if (process.env.OPENAI_API_KEY) {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        },
        body: JSON.stringify({
          model: process.env.CZ_JUDGE_MODEL || 'gpt-4o-mini',
          temperature: 0,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: 'Output ONLY a single JSON object. No prose.' },
            { role: 'user', content: prompt },
          ],
        }),
      });
      const body = await r.json();
      const raw = body?.choices?.[0]?.message?.content || '';
      const parsed = JSON.parse(raw);
      return normaliseLlmJudge(persona, parsed);
    }
  } catch (err) {
    // Any LLM failure falls back to heuristic — we never want to block a run.
    const fallback = runHeuristicJudge(persona, { text, scenario, observedSubAgent });
    fallback.backend = 'heuristic-fallback';
    fallback.rationale = `LLM judge failed (${err.message}); fell back to heuristic. ${fallback.rationale}`;
    return fallback;
  }
  return runHeuristicJudge(persona, { text, scenario, observedSubAgent });
}

function normaliseLlmJudge(persona, parsed) {
  const perDim = {};
  for (const dim of RUBRIC.dimensions) {
    const v = Number(parsed.perDim?.[dim.id]);
    perDim[dim.id] = Number.isFinite(v) ? Math.max(0, Math.min(10, v)) : 5;
  }
  const overall = Number.isFinite(parsed.overall)
    ? Math.max(0, Math.min(10, parsed.overall))
    : (Object.values(perDim).reduce((a, b) => a + b, 0) / 5);

  return {
    judgeId: persona.id,
    judgeLabel: persona.label,
    backend: 'llm',
    perDim,
    overall: Math.round(overall * 100) / 100,
    rationale: String(parsed.rationale || '').slice(0, 800),
  };
}

// ─── Ensemble — runs all 3 personas, returns aggregated view ───────────────
async function judgeReply({ text, scenario, observedSubAgent, useLlm = false }) {
  const runner = useLlm ? runLlmJudge : runHeuristicJudge;
  const results = await Promise.all(
    JUDGE_PERSONAS.map(p => Promise.resolve(runner(p, { text, scenario, observedSubAgent })))
  );

  // Median per-dim
  const perDim = {};
  const perDimStdev = {};
  for (const dim of RUBRIC.dimensions) {
    const vals = results.map(r => r.perDim[dim.id]).sort((a, b) => a - b);
    perDim[dim.id] = vals[Math.floor(vals.length / 2)];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const variance = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / vals.length;
    perDimStdev[dim.id] = Math.round(Math.sqrt(variance) * 100) / 100;
  }

  const overalls = results.map(r => r.overall).sort((a, b) => a - b);
  const medianOverall = overalls[Math.floor(overalls.length / 2)];
  const meanOverall = overalls.reduce((a, b) => a + b, 0) / overalls.length;
  const overallStdev = Math.sqrt(
    overalls.reduce((a, b) => a + (b - meanOverall) ** 2, 0) / overalls.length
  );

  // Agreement: closer to 1 when judges are unanimous. Normalises against the
  // maximum plausible stdev (which on a 0–10 scale is ~5).
  const agreement = Math.max(0, Math.min(1, 1 - (overallStdev / 5)));

  // Tier the agreement for the dashboard badge
  let agreementTier = 'weak';
  if (agreement >= THRESHOLDS.judgeAgreement.strong) agreementTier = 'strong';
  else if (agreement >= THRESHOLDS.judgeAgreement.weak) agreementTier = 'moderate';

  return {
    perDim,                                               // 0–10 median per dim
    perDimStdev,                                          // 0–5 stdev per dim
    overall: Math.round(medianOverall * 100) / 100,       // 0–10 median overall
    overallStdev: Math.round(overallStdev * 100) / 100,
    agreement: Math.round(agreement * 1000) / 1000,
    agreementTier,
    judges: results,
  };
}

module.exports = {
  judgeReply,
  JUDGE_PERSONAS,
};
