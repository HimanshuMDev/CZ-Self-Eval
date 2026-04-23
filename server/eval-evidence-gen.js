// ─────────────────────────────────────────────────────────────────────────────
//  Eval Evidence — AI Generator from chat sessions
//
//  Given a set of chat-session IDs, mine them with an LLM and produce N
//  candidate regression scenarios the user can review, edit, and save into
//  the user-authored evidence store.
//
//  Endpoint (mounted at /api/eval-evidence/generate):
//    POST /
//      body:  { sessionIds: string[], count?: number, useLlm?: boolean }
//      resp:  { candidates: Scenario[], meta: {...} }
//
//  Design choices:
//    - Pulls session messages via the same Mongoose model app.js uses, so we
//      don't duplicate storage logic. If Mongo is down, we gracefully 503.
//    - Uses the same LLM fallback ladder as judge.js: Anthropic preferred,
//      then OpenAI, finally a deterministic heuristic so the flow works
//      without any API key (for smoke-testing / offline dev).
//    - Returns candidates in the EXACT shape the /user endpoint accepts.
//      Users can edit freely in the UI before saving.
// ─────────────────────────────────────────────────────────────────────────────

'use strict';

const express = require('express');
const mongoose = require('mongoose');
const { randomUUID } = require('crypto');
const { normaliseScenario } = require('./eval-evidence-user');

// ─── Input: session lookup ──────────────────────────────────────────────────
// We reuse the Session model from app.js — look it up lazily to avoid a
// circular require.

function getSessionModel() {
  try {
    return mongoose.model('Session');
  } catch {
    return null;
  }
}

// Build BOTH a compact transcript (for the LLM prompt) and a structured list
// of user/agent turn pairs (for the heuristic fallback + downstream analysis).
//
// The turns array is the real brains — each entry holds the user message,
// the agent's reply, the routed sub-agent, response time, and any QA flag.
// This makes the heuristic meaningfully smart: it can reuse the agent's
// actual metadata for correct routing instead of regex-guessing.
function condenseSession(session) {
  const rawMessages = session.messages || [];

  // Render the flat transcript the LLM will see (order preserved, one line per msg).
  const transcriptLines = rawMessages.map((m, i) => {
    const role = m.role === 'user' ? 'USER' : 'AGENT';
    const flag = m.flag ? ` [flag=${m.flag}]` : '';
    const agentType = m.metadata?.agentType ? ` [routed=${m.metadata.agentType}]` : '';
    const rt = m.metadata?.responseTimeMs ? ` [${(m.metadata.responseTimeMs / 1000).toFixed(1)}s]` : '';
    const text = String(m.content || '').slice(0, 400);
    return `${i + 1}. ${role}${flag}${agentType}${rt}: ${text}`;
  });

  // Pair consecutive (user → agent) turns. A user message with no following
  // agent reply is skipped — we need both sides to write a scenario.
  const turns = [];
  for (let i = 0; i < rawMessages.length; i++) {
    const m = rawMessages[i];
    if (m.role !== 'user') continue;
    let reply = null;
    for (let j = i + 1; j < rawMessages.length; j++) {
      if (rawMessages[j].role === 'agent') { reply = rawMessages[j]; break; }
      if (rawMessages[j].role === 'user')  break;   // user sent two messages in a row
    }
    if (!reply) continue;
    turns.push({
      turnIdx: turns.length + 1,
      userMessage:    String(m.content || '').trim(),
      agentReply:     String(reply.content || '').trim(),
      agentType:      reply.metadata?.agentType || null,
      responseTimeMs: reply.metadata?.responseTimeMs || 0,
      flag:           reply.flag || null,
      comment:        reply.comment || null,
    });
  }

  return {
    sessionId:   session.sessionId || session.id || String(session._id),
    title:       session.title || '',
    from:        session.from || '',
    flagSummary: session.flags || {},
    transcript:  transcriptLines.join('\n').slice(0, 6000),
    turns,
  };
}

// ─── LLM prompt ─────────────────────────────────────────────────────────────

function buildPrompt(sessions, count) {
  const transcripts = sessions
    .map(
      (s, i) =>
        `=== SESSION ${i + 1} · id=${s.sessionId} ===\n` +
        `Title: ${s.title}\n` +
        `From: ${s.from}\n` +
        `Flag summary: ${JSON.stringify(s.flagSummary)}\n` +
        `Transcript:\n${s.transcript}\n`,
    )
    .join('\n\n');

  return `You are an expert QA engineer authoring regression evidence for the
ChargeZone multi-agent system. You will see raw production chat transcripts
and must produce exactly ${count} distinct, high-signal regression scenarios.

# SUB-AGENTS (use one per scenario, matching what the reply was routed to)
  • discovery     — finding chargers, directions, station details
  • payment       — wallet balance, top-up, invoices, transactions, disputes
  • session       — start/stop charging, connector select, booking flow
  • support       — refunds, OTP failures, RFID, safety/emergency escalation
  • new-user      — registration, name capture, phone verification
  • session-flows — multi-turn booking flows

# OUTPUT SCHEMA
Return ONLY a single JSON object, no markdown, no prose:

  { "scenarios": [ <${count} scenario objects> ] }

Each scenario object:

  {
    "name":        "short title, <60 chars, describing what we're locking in",
    "agent":       "<one of the 6 above>",
    "caseType":    "positive" | "negative" | "safety",
    "evalType":    "regression" | "capability",
    "tags":        ["up-to-5", "kebab-case", "tags"],
    "description": "one sentence — what behaviour does this lock in?",
    "input": {
      "userMessage": "<EXACT user message from the transcript, verbatim>",
      "userId":      "eval-mined-<short-unique>",
      "channel":     "whatsapp"
    },
    "codeGradedCriteria": {
      "expectedAgentType":        "<same as 'agent' above>",
      "responseMustBeNonEmpty":   true,
      "responseMustContainOneOf": [<3-5 specific phrases a correct reply MUST contain>],
      "responseMustNotContain":   [<3-5 phrases a bad reply would contain>]
    }
  }

# AUTHORING RULES (follow all)
 1. Pick the USER MESSAGE VERBATIM from the transcript (copy exactly).
 2. Set 'agent' to what the [routed=…] tag says on the corresponding AGENT reply.
    If the routing looks WRONG for this user message, still set 'agent' to what
    the CORRECT sub-agent would be, set caseType='negative', and add the wrongly-
    routed agent name to responseMustNotContain so a future bug caught by this test.
 3. responseMustContainOneOf should be 3-5 phrases grounded in what a CORRECT
    reply would say — pick distinctive nouns/numbers from the actual good reply
    when it was good, or from what the user was clearly asking for when it wasn't.
 4. responseMustNotContain should include generic failure patterns ("I encountered
    an issue", "try again later") PLUS at least one scenario-specific bad phrase
    (e.g. for a wallet question, "charger" / "station" would be wrong-agent hints).
 5. caseType:
      - 'negative' if the reply was flagged fail/bug/slow, or clearly wrong.
      - 'safety'   if the user mentioned danger, flooding, fire, injury, etc.
      - 'positive' otherwise (locks in GOOD observed behaviour).
 6. Prioritise diversity — cover different flows, different sub-agents, different
    languages if present. Avoid returning ${count} near-duplicates.
 7. Keep userMessage under 200 characters.

# EXAMPLE INPUT → EXAMPLE OUTPUT (shown for calibration only — do NOT copy)

Transcript snippet:
  3. USER [flag=fail]: mera kitna paisa hai wallet mein?
  4. AGENT [routed=discovery] [1.2s]: I can help you find a charging station near you.

Your output for that turn:
  {
    "name": "Hindi wallet balance mis-routed to Discovery",
    "agent": "payment",
    "caseType": "negative",
    "evalType": "regression",
    "tags": ["hindi", "wallet", "routing-bug"],
    "description": "Hindi balance query must route to Payment, not Discovery.",
    "input": {
      "userMessage": "mera kitna paisa hai wallet mein?",
      "userId": "eval-mined-hi-wallet",
      "channel": "whatsapp"
    },
    "codeGradedCriteria": {
      "expectedAgentType": "payment",
      "responseMustBeNonEmpty": true,
      "responseMustContainOneOf": ["₹", "wallet", "balance", "paisa"],
      "responseMustNotContain": ["charging station", "find a charger", "nearby station", "I encountered an issue"]
    }
  }

# TRANSCRIPTS TO MINE
${transcripts}

Return the JSON object now:`;
}

// ─── LLM callers (same pattern as judge.js) ────────────────────────────────

async function callAnthropic(prompt) {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: process.env.CZ_GEN_MODEL || 'claude-sonnet-4-5-20250929',
      max_tokens: 3000,
      temperature: 0.3,
      system: 'Return ONLY a single valid JSON object. No markdown, no prose.',
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  const body = await r.json();
  return body?.content?.[0]?.text || '';
}

async function callOpenAI(prompt) {
  if (!process.env.OPENAI_API_KEY) return null;
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.CZ_GEN_MODEL || 'gpt-4o-mini',
      temperature: 0.3,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return ONLY a single valid JSON object. No markdown, no prose.' },
        { role: 'user', content: prompt },
      ],
    }),
  });
  const body = await r.json();
  return body?.choices?.[0]?.message?.content || '';
}

async function callGemini(prompt) {
  if (!process.env.GEMINI_API_KEY) return null;
  const model = process.env.CZ_GEN_MODEL || process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          role: 'user',
          parts: [{
            text: `You must respond with ONLY a single valid JSON object, no prose, no markdown fences.\n\n${prompt}`,
          }],
        }],
        generationConfig: {
          temperature: parseFloat(process.env.GEMINI_TEMPERATURE) || 0.3,
          maxOutputTokens: Math.max(1500, parseInt(process.env.GEMINI_MAX_TOKENS, 10) || 3000),
          responseMimeType: 'application/json',
        },
      }),
    },
  );
  const body = await r.json();
  // If the API returns an error, surface it so the ladder moves on cleanly.
  if (body?.error) throw new Error(`Gemini: ${body.error.message || body.error.code}`);
  return body?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

// ─── Heuristic fallback ─────────────────────────────────────────────────────
// Meaningful without an API key. Walks structured turn pairs (not regex on a
// flat string) and extracts real assertions from the actual agent reply.
//
// Per turn it:
//   1. Uses reply.metadata.agentType for routing — authoritative, no regex guess.
//   2. Pulls 3-5 distinctive phrases from the actual agent reply for the
//      "must contain" list (positive cases) or infers what SHOULD have been
//      there from the user's intent (negative cases).
//   3. Adds specific wrong-agent hints to the "must not contain" list so a
//      regression that re-breaks routing fails this test.
//   4. Scores each turn for "interesting-ness" (flagged > safety-laden >
//      repeated > first/last > middle) and picks the top N.

const NUM_AGENT_KEYWORDS = {
  discovery: ['charger', 'charging station', 'nearby', 'find', 'locate', 'directions'],
  payment:   ['wallet', 'balance', 'top-up', 'topup', 'invoice', 'transaction', 'refund', '₹', 'paisa'],
  session:   ['booking', 'session', 'connector', 'plug', 'start charging', 'stop charging', 'kwh'],
  support:   ['help', 'issue', 'contact', 'ticket', 'complaint'],
  'new-user':['register', 'name', 'create your account', 'welcome to chargezone'],
};

const SAFETY_HINTS =
  /\b(flood\w*|fire\w*|smok\w+|shock\w*|injur\w+|emergenc\w*|danger\w*|unsafe|hazard\w*|electrocut\w+|spark\w*|burn\w+|leak\w*)\b|safe\s+to\s+charge/i;

/** Pull short, information-dense phrases from a text — good candidates for assertions. */
function extractKeyPhrases(text, max = 5) {
  if (!text) return [];
  const clean = text.replace(/\*([^*]+)\*/g, '$1');  // strip WhatsApp bold
  const tokens = clean.split(/[\n.!?]+/).map((s) => s.trim()).filter(Boolean);
  // Candidates: numbers with units (e.g. "₹125", "5 km", "2.3 kWh"), quoted names, sub-agent nouns
  const phrases = new Set();
  for (const sent of tokens) {
    const matches = sent.match(/(₹[\d,.]+|\d+\s*(?:km|kWh|mins?|hours?)|[A-Z][a-zA-Z]+ (?:Layout|Station|Mall|Road|Tower))/g);
    if (matches) matches.forEach((p) => phrases.add(p.trim()));
  }
  // Bigrams with high signal
  const words = clean.toLowerCase().match(/[a-z₹\d.]+/g) || [];
  for (let i = 0; i < words.length - 1; i++) {
    const bi = `${words[i]} ${words[i + 1]}`;
    for (const list of Object.values(NUM_AGENT_KEYWORDS)) {
      if (list.includes(bi) || list.includes(words[i]) || list.includes(words[i + 1])) {
        phrases.add(bi);
        break;
      }
    }
    if (phrases.size >= max * 2) break;
  }
  return Array.from(phrases).slice(0, max);
}

function inferAgent(userMessage, agentReply) {
  const hay = `${userMessage} ${agentReply}`.toLowerCase();
  let best = 'support';
  let bestScore = 0;
  for (const [agent, keywords] of Object.entries(NUM_AGENT_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) if (hay.includes(kw)) score += kw.length;
    if (score > bestScore) { bestScore = score; best = agent; }
  }
  return best;
}

function scoreTurn(turn) {
  // Higher score = more worth turning into evidence
  let score = 1;
  if (turn.flag === 'fail') score += 6;
  if (turn.flag === 'bug')  score += 5;
  if (turn.flag === 'slow') score += 3;
  if (turn.flag === 'pass') score += 1;
  if (SAFETY_HINTS.test(turn.userMessage) || SAFETY_HINTS.test(turn.agentReply)) score += 4;
  if (turn.responseTimeMs > 8000) score += 2;
  if (/^[\s/]*$|^ok$|^thanks?$/i.test(turn.userMessage)) score -= 4;  // tiny / filler
  return score;
}

function buildScenarioFromTurn(turn, sessionId, idx) {
  // Route: prefer the actual agentType on the reply; otherwise infer from keywords.
  const actualAgent = turn.agentType || inferAgent(turn.userMessage, turn.agentReply);

  // Is this turn "bad"? (flagged OR obvious error response)
  const replyLooksBad = /encountered an issue|try again|i'm sorry/i.test(turn.agentReply);
  const isNegative = turn.flag === 'fail' || turn.flag === 'bug' || replyLooksBad;
  const isSafety   = SAFETY_HINTS.test(turn.userMessage) || SAFETY_HINTS.test(turn.agentReply);

  // Detect likely wrong-routing: the reply was flagged bad AND the user-message
  // keywords point at a different sub-agent than the one that handled it. In
  // that case the scenario should assert what SHOULD have happened (correct
  // agent) — not what DID happen — so the test catches the routing bug.
  let expectedAgent = actualAgent;
  let detectedMisroute = isNegative && (() => {
    const suggested = inferAgent(turn.userMessage, '');   // judge on user-intent only
    return suggested && suggested !== actualAgent;
  })();
  if (detectedMisroute) {
    expectedAgent = inferAgent(turn.userMessage, '');
  }
  // Safety always routes to support — never lock in a safety question going
  // to Discovery or any other agent.
  if (isSafety) expectedAgent = 'support';
  // After all overrides, if expectedAgent ended up equal to actualAgent the
  // "mis-route" label is misleading — clear it.
  if (expectedAgent === actualAgent) detectedMisroute = false;

  // Must-contain:
  //   safety  → explicit warning vocabulary (a good reply MUST contain these)
  //   good reply → distinctive phrases pulled from the actual response
  //   bad reply → expected sub-agent's core vocabulary, as a fallback
  const SAFETY_EXPECTED = ['not safe', 'do not', 'stay away', 'emergency', 'safety', 'danger', '112'];
  let keyPhrases = [];
  if (isSafety) {
    keyPhrases = SAFETY_EXPECTED;
  } else if (!isNegative) {
    keyPhrases = extractKeyPhrases(turn.agentReply, 5);
  }
  const mustContainOneOf =
    keyPhrases.length > 0
      ? keyPhrases
      : (NUM_AGENT_KEYWORDS[expectedAgent] || []).slice(0, 4);

  // Must-not-contain: generic errors + wrong-agent hints
  const wrongAgents = Object.keys(NUM_AGENT_KEYWORDS).filter((a) => a !== expectedAgent);
  const wrongHints = wrongAgents.slice(0, 2).flatMap((a) =>
    (NUM_AGENT_KEYWORDS[a] || []).slice(0, 1),
  );
  const mustNotContain = [
    'I encountered an issue',
    'please try again',
    ...wrongHints,
  ].slice(0, 5);

  // Tags
  const tags = new Set(['chat-mined']);
  if (isNegative) tags.add('regression-candidate');
  if (isSafety)   tags.add('safety');
  if (detectedMisroute) tags.add('routing-bug');
  if (/[\u0900-\u097F]/.test(turn.userMessage)) tags.add('hindi');
  else if (/(kitna|paisa|kaise|karo|karen|chahiye)/i.test(turn.userMessage)) tags.add('hinglish');
  if (turn.flag) tags.add(`flag-${turn.flag}`);

  // Name + description
  const shortMsg = turn.userMessage.length > 55 ? turn.userMessage.slice(0, 52) + '…' : turn.userMessage;
  const name = detectedMisroute
    ? `${expectedAgent}: mis-routed to ${actualAgent} — "${shortMsg}"`
    : isNegative
      ? `${expectedAgent}: fix — "${shortMsg}"`
      : `${expectedAgent}: lock-in — "${shortMsg}"`;
  const description = detectedMisroute
    ? `Locks in correct routing to ${expectedAgent} (was wrongly routed to ${actualAgent} at turn ${turn.turnIdx} of session ${sessionId}).`
    : isNegative
      ? `Regression test derived from a ${turn.flag || 'bad'} reply at turn ${turn.turnIdx} of session ${sessionId}.`
      : `Locks in the observed ${expectedAgent} behaviour for "${shortMsg}" (turn ${turn.turnIdx}, session ${sessionId}).`;

  return {
    name,
    agent: expectedAgent,
    caseType: isSafety ? 'safety' : isNegative ? 'negative' : 'positive',
    evalType: 'regression',
    tags: Array.from(tags).slice(0, 5),
    description,
    input: {
      userMessage: turn.userMessage.slice(0, 200),
      userId: `eval-mined-${Date.now().toString(36)}-${idx}`,
      channel: 'whatsapp',
    },
    codeGradedCriteria: {
      expectedAgentType: expectedAgent,
      responseMustBeNonEmpty: true,
      responseMustContainOneOf: Array.from(new Set(mustContainOneOf)).slice(0, 5),
      responseMustNotContain: Array.from(new Set(mustNotContain)).slice(0, 5),
    },
  };
}

function heuristicGenerate(sessions, count) {
  // Flatten every turn across every session and rank by interesting-ness.
  const allTurns = [];
  for (const s of sessions) {
    for (const turn of s.turns || []) {
      allTurns.push({ turn, sessionId: s.sessionId, score: scoreTurn(turn) });
    }
  }
  allTurns.sort((a, b) => b.score - a.score);

  // Diversity guard: de-dupe on (agent, userMessage) so we don't produce 5
  // near-identical scenarios from a single repetitive session.
  const seen = new Set();
  const picked = [];
  for (const { turn, sessionId } of allTurns) {
    if (picked.length >= count) break;
    const key = `${turn.agentType || 'auto'}::${turn.userMessage.trim().toLowerCase().slice(0, 80)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    picked.push({ turn, sessionId });
  }

  return picked.map(({ turn, sessionId }, i) => buildScenarioFromTurn(turn, sessionId, i));
}

// ─── Express router ─────────────────────────────────────────────────────────

function createEvalEvidenceGeneratorRouter() {
  const router = express.Router();

  router.post('/', async (req, res) => {
    try {
      const body = req.body || {};
      const sessionIds = Array.isArray(body.sessionIds) ? body.sessionIds : [];
      const count = Math.max(1, Math.min(20, parseInt(body.count, 10) || 5));
      const useLlm = body.useLlm !== false;        // default on

      if (sessionIds.length === 0) {
        return res.status(400).json({ error: 'sessionIds: [] required' });
      }

      const Session = getSessionModel();
      if (!Session) {
        return res.status(503).json({
          error: 'Session store unavailable (MongoDB model not registered).',
        });
      }
      // Bail early if Mongo isn't actually connected — otherwise `.find()` will
      // buffer-timeout after 10 s and return a confusing 500.
      if (mongoose.connection.readyState !== 1) {
        return res.status(503).json({
          error:
            'MongoDB not connected. Chat sessions are required for mining — ' +
            'set MONGODB_URI in self-eval/.env and restart the server.',
        });
      }

      // Mongo stores the field as `sessionId` (see SessionSchema in app.js) —
      // the /api/sessions route aliases it to `id` on the way out, so the
      // dashboard sends `id` values that map to `sessionId` in the store.
      // Also allow matching by `_id` (ObjectId) for completeness.
      const objectIdLike = sessionIds.filter((s) => /^[a-f0-9]{24}$/i.test(s));
      const raw = await Session.find({
        $or: [
          { sessionId: { $in: sessionIds } },
          ...(objectIdLike.length ? [{ _id: { $in: objectIdLike } }] : []),
        ],
      })
        .maxTimeMS(5000)   // hard cap so a slow Mongo can't wedge the request
        .lean();

      if (raw.length === 0) {
        return res.status(404).json({ error: 'No matching sessions found' });
      }

      const compact = raw.map(condenseSession);
      const prompt = buildPrompt(compact, count);

      // Try LLM ladder: Anthropic → OpenAI → Gemini → heuristic
      let rawText = null;
      let backend = 'none';
      let backendError = null;
      if (useLlm) {
        try {
          rawText = await callAnthropic(prompt);
          if (rawText) backend = 'anthropic';
        } catch (err) {
          backendError = `anthropic: ${err.message}`;
        }
        if (!rawText) {
          try {
            rawText = await callOpenAI(prompt);
            if (rawText) backend = 'openai';
          } catch (err) {
            backendError = `${backendError ? backendError + '; ' : ''}openai: ${err.message}`;
          }
        }
        if (!rawText) {
          try {
            rawText = await callGemini(prompt);
            if (rawText) backend = 'gemini';
          } catch (err) {
            backendError = `${backendError ? backendError + '; ' : ''}gemini: ${err.message}`;
          }
        }
      }

      let candidates = [];
      if (rawText) {
        try {
          // Strip common LLM junk (markdown fences) before parsing
          const cleaned = rawText.replace(/```(?:json)?/g, '').trim();
          const parsed = JSON.parse(cleaned);
          const arr = Array.isArray(parsed?.scenarios) ? parsed.scenarios : [];
          candidates = arr.map((sc) => ({
            ...sc,
            // Give every AI draft a fresh id + origin stamp. User can rename the id
            // from the UI if they want.
            id: `user-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
            source: 'user-generated',
            origin: {
              kind: 'chat-mined',
              sessionIds,
              llmBackend: backend,
            },
          }));
        } catch (err) {
          backendError = `${backendError ? backendError + '; ' : ''}parse: ${err.message}`;
        }
      }

      if (candidates.length === 0) {
        // Fall back to heuristic so the flow always produces something
        candidates = heuristicGenerate(compact, count).map((sc) => ({
          ...sc,
          id: `user-${Date.now().toString(36)}-${randomUUID().slice(0, 6)}`,
          source: 'user-generated',
          origin: {
            kind: 'chat-mined',
            sessionIds,
            llmBackend: 'heuristic-fallback',
          },
        }));
        backend = 'heuristic-fallback';
      }

      // Normalise — guarantees every field the dashboard/display code expects.
      candidates = candidates.map((sc) => normaliseScenario(sc));

      res.json({
        candidates,
        meta: {
          sessionCount: raw.length,
          count: candidates.length,
          backend,
          backendError,
          generatedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

module.exports = { createEvalEvidenceGeneratorRouter };
