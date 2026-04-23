// ─────────────────────────────────────────────────────────────────────────────
//  Evidence Runner — adapts Eval Evidence scenarios (sourced from the agent
//  repo's tests/evals/datasets/*.ts) into the shape the CZ Score pipeline
//  (score.js, judge.js) already understands.
//
//  Responsibilities:
//    1. Call the CZ AI agent for a given evidence scenario (single or flow).
//    2. Evaluate the response against the scenario's codeGradedCriteria
//       (responseMustContainOneOf / responseMustNotContain / expectedAgentType).
//    3. Return runs in the exact shape scoreScenario() wants, with an adapter
//       scenario object that exposes {id, title, category, tags, mustPass,
//       expectedSubAgent, expectsBookingConfirmation, minScore}.
//
//  Everything that used to be specific to golden.js now flows through here.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const DEFAULT_AGENT_URL = process.env.CZ_AGENT_URL
  || 'https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate';
const DEFAULT_TEST_FROM = process.env.CZ_AGENT_TEST_FROM || '919000000001';
const DEFAULT_TEST_NAME = process.env.CZ_AGENT_TEST_NAME || 'EvalBot';

// ─── Adapter: evidence → scoring-shape scenario ────────────────────────────
// score.js / rubric.js look up these fields by name. Evidence uses slightly
// different conventions (name vs title, expectedAgentType vs expectedSubAgent,
// caseType vs mustPass). Translate once so downstream code stays clean.

function toScoringScenario(ev) {
  const criteria = ev.codeGradedCriteria || {};
  const mustPass = isMustPass(ev);

  return {
    id:         ev.id,
    title:      ev.name,
    description: ev.description,
    category:   ev.agent,                  // rubric.weightForScenario honours category
    tags:       ev.tags || [],
    mustPass,
    minScore:   ev.modelGradedRubric?.passingScore ?? 0.5,
    language:   detectLanguage(ev),
    expectedSubAgent: criteria.expectedAgentType || null,
    // Hallucination detector in eval-runs.js uses this to skip the "booked/
    // confirmed/reserved" regex when booking confirmation IS the expected path.
    expectsBookingConfirmation: expectsBookingConfirmation(ev),
    // Pass through the raw evidence so the dashboard can drill in.
    evidence: {
      kind:            ev.kind,
      agent:           ev.agent,
      caseType:        ev.caseType,
      evalType:        ev.evalType,
      input:           ev.input || null,
      turns:           ev.turns || null,
      codeGradedCriteria: ev.codeGradedCriteria || null,
      modelGradedRubric:  ev.modelGradedRubric || null,
      mockBehavior:    ev.mockBehavior || null,
    },
  };
}

function isMustPass(ev) {
  // Regressions are the "must not break" set. Routing-critical support cases
  // and capability tasks are informational unless they regress.
  if (ev.evalType === 'regression') return true;
  // Safety / guardrail tests always must-pass regardless of evalType.
  const tags = (ev.tags || []).map(t => String(t).toLowerCase());
  if (tags.includes('safety') || tags.includes('guardrail')) return true;
  if (ev.caseType === 'safety') return true;
  return false;
}

function detectLanguage(ev) {
  const tags = (ev.tags || []).map(t => String(t).toLowerCase());
  if (tags.includes('hindi'))    return 'Hindi';
  if (tags.includes('hinglish')) return 'Hinglish';
  return 'English';
}

function expectsBookingConfirmation(ev) {
  // If the scenario's expected answer talks about confirming a booking, or
  // the scenario is a multi-turn flow that walks through booking, the
  // hallucination detector should NOT treat "booked/confirmed" as a red flag.
  const tags = (ev.tags || []).map(t => String(t).toLowerCase());
  if (tags.includes('booking') || tags.includes('session-start')) return true;
  if (ev.agent === 'session-flows') return true;
  const criteria = ev.codeGradedCriteria || {};
  const oneOf = criteria.responseMustContainOneOf || [];
  return oneOf.some(s => /confirm|booking|session|book/i.test(String(s)));
}

// ─── Agent caller ──────────────────────────────────────────────────────────

async function callAgent(payload, opts = {}) {
  const url = opts.url || DEFAULT_AGENT_URL;
  // Per-call wall-clock cap. Prevents a slow / hung agent from wedging the
  // whole eval run forever — the user will see a clear "timeout" error on
  // that scenario, the pipeline moves on, and the run can still complete.
  const timeoutMs = Math.max(5_000, Math.min(120_000, opts.timeoutMs || 45_000));
  const maxRetries = Math.max(0, Math.min(3, opts.maxRetries ?? 1));
  const started = Date.now();

  // Retry loop: one retry by default on transient network errors (refused,
  // DNS, 5xx, timeout on the first try). Doesn't retry on 4xx responses —
  // those are deterministic.
  let lastErr = null;
  let res;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(timeoutMs),
      });
      // Retry on 5xx (transient server issue); don't retry on 4xx.
      if (!res.ok && res.status >= 500 && attempt < maxRetries) {
        lastErr = new Error(`Agent returned ${res.status} ${res.statusText}`);
        await new Promise((r) => setTimeout(r, 500 + attempt * 500));
        continue;
      }
      break;        // success OR non-retryable error
    } catch (err) {
      lastErr = err;
      const cause = err?.cause?.code || err?.code || err?.name || err?.message || 'unknown';
      const retryable = /^(ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|UND_ERR_)/.test(cause)
        || err?.name === 'TimeoutError'
        || /aborted/i.test(String(err));
      if (!retryable || attempt >= maxRetries) {
        if (err?.name === 'TimeoutError' || /aborted/i.test(String(err))) {
          throw new Error(`Agent call timed out after ${(timeoutMs / 1000).toFixed(0)}s — ${url}`);
        }
        throw new Error(`Could not reach agent at ${url} (${cause})`);
      }
      // Transient — exponential-ish backoff, 500ms / 1000ms
      await new Promise((r) => setTimeout(r, 500 + attempt * 500));
    }
  }

  if (!res) {
    throw new Error(`Could not reach agent at ${url}: ${lastErr?.message || 'unknown error'}`);
  }

  const responseTimeMs = Date.now() - started;

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.text()).slice(0, 200); } catch { /* ignore */ }
    throw new Error(
      `Agent at ${url} returned ${res.status} ${res.statusText}${detail ? ` — ${detail}` : ''}`,
    );
  }
  const data = await res.json();

  let content = '';
  let agentType = null;
  if (data?.success && data?.response?.content) {
    content   = String(data.response.content);
    agentType = data.agentType || data.response.agentType || null;
  } else if (typeof data === 'string') {
    content = data;
  } else if (data?.content) {
    content   = String(data.content);
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

// ─── Build the agent request body from an evidence scenario's `input` ──────

function buildAgentPayload(input, { from, name, message } = {}) {
  const base = {
    from:    from || input?.contactInfo?.phone || DEFAULT_TEST_FROM,
    name:    name || input?.contactInfo?.name  || DEFAULT_TEST_NAME,
    message: message != null ? message : input?.userMessage || '',
  };
  // Optional fields the simulate endpoint may honour — pass through if present.
  if (input?.buttonReplyId) base.buttonReplyId = input.buttonReplyId;
  if (input?.hasLocation && input?.location) {
    base.location = input.location;
    base.hasLocation = true;
  }
  if (input?.channel) base.channel = input.channel;
  if (input?.userId)  base.userId  = input.userId;
  return base;
}

// ─── Evaluator — pass/fail against codeGradedCriteria ─────────────────────

function evaluateEvidenceResponse(responseText, scenario) {
  const text  = String(responseText || '');
  const lower = text.toLowerCase();
  const c     = scenario.evidence?.codeGradedCriteria || {};
  const failures    = [];
  const missingPass = [];

  // 1. responseMustNotContain — any match = hard fail
  for (const needle of c.responseMustNotContain || []) {
    if (lower.includes(String(needle).toLowerCase())) {
      failures.push(`contained forbidden phrase: ${needle}`);
    }
  }

  // 2. responseMustContainOneOf — at least one must match
  const oneOf = c.responseMustContainOneOf || [];
  if (oneOf.length > 0) {
    const hit = oneOf.some(kw => lower.includes(String(kw).toLowerCase()));
    if (!hit) missingPass.push(`one of [${oneOf.slice(0, 4).join(', ')}${oneOf.length > 4 ? ', …' : ''}]`);
  }

  // 3. responseMustBeNonEmpty (default yes for positive cases)
  if (c.responseMustBeNonEmpty !== false && text.trim().length === 0) {
    failures.push('empty response');
  }

  // 4. Routing
  const routingOk = !scenario.expectedSubAgent
    || !scenario.observedSubAgent
    || String(scenario.observedSubAgent).toLowerCase() === String(scenario.expectedSubAgent).toLowerCase();

  let score;
  if (failures.length > 0) {
    score = 0.1;
  } else if (missingPass.length > 0) {
    score = 0.45;
  } else if (!routingOk) {
    score = 0.5;
  } else {
    const lengthScore = Math.min(1, text.length / 200);
    const structureScore = text.includes('\n') ? 0.05 : 0;
    score = Math.min(1, 0.75 + lengthScore * 0.15 + structureScore);
  }
  const pass = failures.length === 0 && missingPass.length === 0 && routingOk;

  let reason;
  if (failures.length)      reason = `Response contains forbidden pattern(s): ${failures.join('; ')}`;
  else if (missingPass.length) reason = `Response missing expected term(s): ${missingPass.join(', ')}`;
  else if (!routingOk)      reason = `Routed to ${scenario.observedSubAgent} but expected ${scenario.expectedSubAgent}`;
  else                      reason = 'All expected criteria satisfied';

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

// ─── Single-scenario execution (one run; called N times by caller) ─────────

async function runSingleOnce(scoringScenario, { agentUrl } = {}) {
  const ev = scoringScenario.evidence;
  const payload = buildAgentPayload(ev.input);
  try {
    const agent = await callAgent(payload, { url: agentUrl });
    const det = evaluateEvidenceResponse(agent.content, {
      ...scoringScenario,
      observedSubAgent: agent.agentType,
    });
    return {
      pass: det.pass,
      score: det.score,
      reason: det.reason,
      responseText: agent.content,
      agentType: agent.agentType,
      responseTimeMs: agent.responseTimeMs,
      _rawResponse: agent.content,
    };
  } catch (err) {
    return {
      pass: false,
      score: 0,
      reason: `Agent call failed: ${err.message}`,
      responseText: '',
      agentType: null,
      responseTimeMs: 0,
      error: err.message,
    };
  }
}

// ─── Flow execution — walks turns with the same userId so context carries ──
// The overall flow "pass" = every turn passes its per-turn assertions.
// The overall score is the mean turn score. Final-turn response is what
// the LLM judge sees (it's the one the user would read).

async function runFlowOnce(scoringScenario, { agentUrl } = {}) {
  const ev = scoringScenario.evidence;
  const turns = Array.isArray(ev.turns) ? ev.turns : [];
  if (!turns.length) {
    return {
      pass: false, score: 0, reason: 'Flow has no turns', responseText: '',
      agentType: null, responseTimeMs: 0,
    };
  }

  // Stable synthetic userId so multi-turn context persists (agent backend keys
  // by `from` phone). Prefix with the scenario id so parallel runs don't clash.
  const syntheticFrom = `9190${Math.floor(100_000_000 + Math.random() * 899_999_999)}`;

  const turnResults = [];
  let totalLatency = 0;

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    const payload = buildAgentPayload(
      ev.input || {},
      { from: syntheticFrom, message: t.userMessage }
    );
    if (t.buttonReplyId) payload.buttonReplyId = t.buttonReplyId;

    try {
      const agent = await callAgent(payload, { url: agentUrl });
      totalLatency += agent.responseTimeMs;

      const a = t.assertions || {};
      const lower = String(agent.content || '').toLowerCase();
      const failures = [];
      const missing = [];

      if (a.mustContainOneOf && a.mustContainOneOf.length) {
        const hit = a.mustContainOneOf.some(k => lower.includes(String(k).toLowerCase()));
        if (!hit) missing.push(`turn ${i + 1}: missing any of [${a.mustContainOneOf.slice(0, 3).join(', ')}]`);
      }
      for (const bad of a.mustNotContain || []) {
        if (lower.includes(String(bad).toLowerCase())) failures.push(`turn ${i + 1}: forbidden "${bad}"`);
      }
      const routingOk = !a.expectedAgentType
        || !agent.agentType
        || String(agent.agentType).toLowerCase() === String(a.expectedAgentType).toLowerCase();

      const turnPass = !failures.length && !missing.length && routingOk;
      turnResults.push({
        label: t.label || `Turn ${i + 1}`,
        userMessage: t.userMessage,
        pass: turnPass,
        routingOk,
        agentType: agent.agentType,
        responseText: agent.content,
        responseTimeMs: agent.responseTimeMs,
        failures, missing,
      });

      // Short-circuit if an early turn breaks context.
      if (!turnPass && i < turns.length - 1) {
        // Continue — even broken turns exercise later turns; don't bail early.
      }
    } catch (err) {
      turnResults.push({
        label: t.label || `Turn ${i + 1}`,
        userMessage: t.userMessage,
        pass: false, error: err.message,
        agentType: null, responseText: '', responseTimeMs: 0,
        failures: [err.message], missing: [],
      });
    }
  }

  const passedTurns  = turnResults.filter(r => r.pass).length;
  const totalTurns   = turnResults.length;
  const flowPass     = passedTurns === totalTurns;
  const flowScore    = passedTurns / Math.max(1, totalTurns);

  const finalTurn = turnResults[turnResults.length - 1];
  return {
    pass: flowPass,
    score: Math.round(flowScore * 100) / 100,
    reason: flowPass
      ? `All ${totalTurns} turns passed`
      : `${totalTurns - passedTurns}/${totalTurns} turn(s) failed`,
    responseText: finalTurn.responseText,    // judged on the final reply
    agentType:    finalTurn.agentType,
    responseTimeMs: Math.round(totalLatency / Math.max(1, totalTurns)),
    turnResults,
  };
}

async function runScenarioOnce(scoringScenario, opts) {
  return scoringScenario.evidence.kind === 'flow'
    ? runFlowOnce(scoringScenario, opts)
    : runSingleOnce(scoringScenario, opts);
}

module.exports = {
  toScoringScenario,
  buildAgentPayload,
  evaluateEvidenceResponse,
  callAgent,
  runScenarioOnce,
  runSingleOnce,
  runFlowOnce,
};
