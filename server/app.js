const express  = require('express');
const mongoose = require('mongoose');
const cors     = require('cors');
const { createGoldenRouter } = require('./golden');

const app = express();

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '20mb' }));

// ─── Schemas ──────────────────────────────────────────────────────────────────

const MessageSchema = new mongoose.Schema({
  id:          { type: String, required: true },
  role:        { type: String, enum: ['user', 'agent'], required: true },
  content:     { type: String, default: '' },
  timestamp:   { type: String, required: true },
  isButtonTap: { type: Boolean, default: false },
  comment:     { type: String, default: null },
  flag:        { type: String, enum: ['pass', 'fail', 'bug', 'slow', null], default: null },
  metadata: {
    agentType:      { type: String, default: null },
    responseTimeMs: { type: Number, default: null },
    thought:        { type: String, default: null },
    buttons: [{ id: String, title: String, payload: String }],
    data:           { type: mongoose.Schema.Types.Mixed, default: null },
  },
}, { _id: false });

const SessionSchema = new mongoose.Schema({
  sessionId:           { type: String, required: true, unique: true, index: true },
  title:               { type: String, default: 'Untitled Session' },
  createdAt:           { type: String, required: true },
  updatedAt:           { type: String, required: true },
  from:                { type: String, default: '' },
  totalMessages:       { type: Number, default: 0 },
  totalAgentMessages:  { type: Number, default: 0 },
  avgResponseTimeMs:   { type: Number, default: 0 },
  agentTypesUsed:      [String],
  healthScore:         { type: Number, default: null },
  flags: {
    pass: { type: Number, default: 0 },
    fail: { type: Number, default: 0 },
    bug:  { type: Number, default: 0 },
    slow: { type: Number, default: 0 },
  },
  messages:  [MessageSchema],
  summary:   { type: String, default: null },
}, { timestamps: false, versionKey: false });

const Session = mongoose.models.Session || mongoose.model('Session', SessionSchema);

// ─── Question Bank Schema ─────────────────────────────────────────────────────

const QuestionBankSchema = new mongoose.Schema({
  text:      { type: String, required: true },
  category:  { type: String, default: 'general' },
  source:    { type: String, enum: ['ai', 'history', 'custom'], default: 'ai' },
  batchId:   { type: String, default: null },
  createdAt: { type: Date, default: Date.now },
}, { timestamps: false, versionKey: false });

// Unique on normalized text to prevent exact duplicates
QuestionBankSchema.index(
  { text: 1 },
  { unique: true, collation: { locale: 'en', strength: 2 } }
);

const QuestionBank = mongoose.models.QuestionBank || mongoose.model('QuestionBank', QuestionBankSchema);

// ─── Compare Report Schema ────────────────────────────────────────────────────

const CompareReportSchema = new mongoose.Schema({
  reportId:     { type: String, required: true, unique: true, index: true },
  sessionId:    String, sessionTitle: String,
  runAt:        String, savedAt: String,
  name:         { type: String, default: null },
  runCount:     { type: Number, default: 1 },
  entries:      { type: [mongoose.Schema.Types.Mixed], default: [] },
  isBaseline:   { type: Boolean, default: false },
}, { timestamps: false, versionKey: false });

const CompareReport = mongoose.models.CompareReport || mongoose.model('CompareReport', CompareReportSchema);

// ─── Eval Result Schema ───────────────────────────────────────────────────────

const EvalResultSchema = new mongoose.Schema({
  scenarioId:   { type: String, required: true, index: true },
  scenarioName: String,
  category:     String,
  testMessage:  String,
  botResponse:  String,
  pass:         Boolean,
  score:        Number,
  reason:       String,
  detail:       String,
  method:       { type: String, default: 'smart' }, // 'llm' | 'smart'
  flaky:        { type: Boolean, default: false },
  runAt:        { type: String, default: () => new Date().toISOString() },
  runHistory: [{
    pass:   Boolean,
    score:  Number,
    reason: String,
    runAt:  String,
  }],
}, { timestamps: false, versionKey: false });

const EvalResult = mongoose.models.EvalResult || mongoose.model('EvalResult', EvalResultSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toClient(doc, includeMessages = true) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const { sessionId, _id, messages, ...rest } = obj;
  const out = { id: sessionId, ...rest };
  if (includeMessages) out.messages = messages ?? [];
  return out;
}

function fromClient(body) {
  const { id, messages = [], ...rest } = body;
  return { sessionId: id, messages, ...rest };
}

// ─── Smart Judge (no external API needed) ────────────────────────────────────

function smartJudge(testMessage, botResponse, successCondition) {
  const response  = (botResponse  || '').toLowerCase();
  const condition = (successCondition || '').toLowerCase();
  const msgLower  = (testMessage || '').toLowerCase();

  // ── 1. Extract meaningful terms from success condition ──
  const stopWords = new Set([
    'should', 'agent', 'provide', 'response', 'without', 'gives', 'clear',
    'correct', 'must', 'will', 'that', 'with', 'from', 'this', 'when',
    'user', 'does', 'have', 'not', 'ask', 'for', 'and', 'the', 'a',
    'an', 'or', 'at', 'in', 'to', 'of', 'is', 'are', 'be', 'been',
  ]);
  const conditionTerms = condition
    .split(/\W+/)
    .filter(w => w.length > 3 && !stopWords.has(w));

  const matchCount  = conditionTerms.filter(w => response.includes(w)).length;
  const matchRatio  = conditionTerms.length > 0 ? matchCount / conditionTerms.length : 0.5;

  // ── 2. Hard-fail patterns ──
  const hardFails = [
    { pattern: /i (cannot|can't|am unable to) help/i,     label: 'Agent refused to help' },
    { pattern: /please (call|contact) (us|support)/i,      label: 'Agent deflected without answering' },
    { pattern: /no (stations?|chargers?) (found|available|near)/i, label: 'False negative — no stations' },
    { pattern: /i don'?t (know|have|understand)/i,         label: 'Agent admitted ignorance' },
    { pattern: /what would you like to (change|update)\?/i,label: 'Agent lost context — re-asked same question' },
    { pattern: /raise a new ticket/i,                       label: 'Duplicate ticket instead of lookup' },
  ];
  for (const { pattern, label } of hardFails) {
    if (pattern.test(botResponse)) {
      const snippet = botResponse.slice(0, 140).replace(/\n/g, ' ');
      return {
        pass: false,
        score: 0.1,
        reason: label,
        detail: `Bot said: "${snippet}${botResponse.length > 140 ? '…' : ''}"`,
        method: 'smart',
      };
    }
  }

  // ── 3. Positive quality signals ──
  const positiveSignals = [
    'here is', 'here are', 'you can', 'please follow', 'step', 'option',
    'available', 'support', 'help', 'check the app', 'download', 'registered',
    'confirmed', 'updated', 'station', 'charger', 'ticket', 'invoice',
  ];
  const posCount = positiveSignals.filter(s => response.includes(s)).length;

  // ── 4. Red flags (soft) ──
  const softRedFlags = [
    'sorry', 'apologize', 'unfortunately', 'cannot assist', 'not able',
    '7 minute wait', 'queue', 'try again later',
  ];
  const redFlagCount = softRedFlags.filter(s => response.includes(s)).length;

  // ── 5. Response quality heuristics ──
  const lengthScore    = Math.min(1, response.length / 200);   // longer = more informative
  const structureScore = response.includes('\n') ? 0.1 : 0;    // structured response

  // ── 6. Compute final score ──
  let score = (
    matchRatio   * 0.55 +
    (posCount / Math.max(1, positiveSignals.length)) * 0.20 +
    lengthScore  * 0.15 +
    structureScore * 0.10
  ) - (redFlagCount * 0.08);

  score = Math.max(0, Math.min(1, score));
  const pass = score >= 0.50;

  // ── 7. Human-readable reason ──
  let reason, detail;
  if (pass) {
    reason = matchRatio >= 0.6
      ? `Response addressed ${Math.round(matchRatio * 100)}% of expected success criteria.`
      : `Response contained sufficient positive signals and no critical failures.`;
  } else if (redFlagCount > 0) {
    const foundFlag = softRedFlags.find(s => response.includes(s));
    reason = `Response contained deflection or error patterns ("${foundFlag}").`;
    detail = `Bot said: "${botResponse.slice(0, 150).replace(/\n/g, ' ')}${botResponse.length > 150 ? '…' : ''}"`;
  } else {
    const missingTerms = conditionTerms.filter(w => !response.includes(w)).slice(0, 3);
    reason = `Response only covered ${Math.round(matchRatio * 100)}% of expected criteria${missingTerms.length ? ` — missing: ${missingTerms.join(', ')}` : ''}.`;
    detail = `Bot said: "${botResponse.slice(0, 150).replace(/\n/g, ' ')}${botResponse.length > 150 ? '…' : ''}"`;
  }

  return { pass, score: Math.round(score * 100) / 100, reason, detail, method: 'smart' };
}

// ─── Sessions Router ──────────────────────────────────────────────────────────

const sessionsRouter = express.Router();

sessionsRouter.get('/export/all', async (_req, res) => {
  try {
    const docs = await Session.find({}).sort({ updatedAt: -1 });
    res.json(docs.map(d => toClient(d, true)));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Search sessions by title or message content
sessionsRouter.get('/search', async (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    if (!q) return res.json([]);
    const docs = await Session.find(
      {
        $or: [
          { title: { $regex: q, $options: 'i' } },
          { 'messages.content': { $regex: q, $options: 'i' } },
          { summary: { $regex: q, $options: 'i' } },
        ]
      },
      { messages: 0 }
    ).sort({ updatedAt: -1 }).limit(50).lean();
    res.json(docs.map(({ sessionId, _id, ...rest }) => ({ id: sessionId, ...rest })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

sessionsRouter.get('/', async (_req, res) => {
  try {
    const docs = await Session.find({}, { messages: 0 }).sort({ updatedAt: -1 }).lean();
    res.json(docs.map(({ sessionId, _id, ...rest }) => ({ id: sessionId, ...rest })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

sessionsRouter.get('/questions', async (_req, res) => {
  try {
    // Load sessions sorted newest first so most recent questions appear first
    const sessions = await Session.find({}, { messages: 1, createdAt: 1, _id: 0 })
      .sort({ createdAt: -1 }).lean();

    const seen = new Set();
    const questions = [];

    // Patterns to skip — these are not real questions
    const SKIP = [
      /^📍/,                              // location shares
      /^shared location/i,
      /^\s*(yes|no|ok|okay|thanks|thank you|hi|hello|bye|sure|done)\s*$/i,
      /^https?:\/\//i,                    // URLs
      /^\d{6}$/,                          // OTPs
      /^[+\d\s\-()]{7,15}$/,             // phone numbers
    ];

    for (const s of sessions) {
      for (const m of (s.messages || [])) {
        if (m.role !== 'user') continue;
        if (m.isButtonTap) continue;
        const raw = (m.content || '').trim();
        if (raw.length < 10 || raw.length > 300) continue;
        if (SKIP.some(r => r.test(raw))) continue;

        // Normalize for dedup: lowercase + collapse whitespace
        const norm = raw.toLowerCase().replace(/\s+/g, ' ');
        if (seen.has(norm)) continue;
        seen.add(norm);
        questions.push(raw);
      }
    }

    res.json({ questions });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

sessionsRouter.get('/:id', async (req, res) => {
  try {
    const doc = await Session.findOne({ sessionId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Session not found' });
    res.json(toClient(doc, true));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

sessionsRouter.post('/import', async (req, res) => {
  try {
    const sessions = Array.isArray(req.body) ? req.body : [req.body];
    const results = [];
    for (const session of sessions) {
      const payload = fromClient(session);
      if (!payload.sessionId) continue;
      await Session.findOneAndUpdate(
        { sessionId: payload.sessionId },
        { $set: payload },
        { upsert: true, new: true, runValidators: false }
      );
      results.push(payload.sessionId);
    }
    res.json({ ok: true, imported: results.length, ids: results });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

sessionsRouter.post('/', async (req, res) => {
  try {
    const payload = fromClient(req.body);
    if (!payload.sessionId) return res.status(400).json({ error: 'Session id is required' });
    const doc = await Session.findOneAndUpdate(
      { sessionId: payload.sessionId },
      { $set: payload },
      { upsert: true, new: true, runValidators: false }
    );
    res.json({ ok: true, id: doc.sessionId });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

sessionsRouter.delete('/:id', async (req, res) => {
  try {
    const result = await Session.deleteOne({ sessionId: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Compare Reports Router ───────────────────────────────────────────────────

const reportsRouter = express.Router();

reportsRouter.get('/', async (_req, res) => {
  try {
    const docs = await CompareReport.find({}, { entries: 0 }).sort({ savedAt: -1 }).lean();
    res.json(docs.map(({ reportId, _id, ...rest }) => ({ id: reportId, ...rest })));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

reportsRouter.get('/:id', async (req, res) => {
  try {
    const doc = await CompareReport.findOne({ reportId: req.params.id }).lean();
    if (!doc) return res.status(404).json({ error: 'Report not found' });
    const { reportId, _id, ...rest } = doc;
    res.json({ id: reportId, ...rest });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

reportsRouter.post('/', async (req, res) => {
  try {
    const { id, sessionId, sessionTitle, runAt, savedAt, name, entries, isBaseline } = req.body;
    if (!id) return res.status(400).json({ error: 'Report id required' });
    await CompareReport.findOneAndUpdate(
      { reportId: id },
      { $set: { reportId: id, sessionId, sessionTitle, runAt, savedAt, name, entries, isBaseline } },
      { upsert: true, new: true, runValidators: false }
    );
    res.json({ ok: true, id });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Pin/unpin baseline
reportsRouter.post('/:id/baseline', async (req, res) => {
  try {
    // Clear all existing baselines first
    await CompareReport.updateMany({}, { $set: { isBaseline: false } });
    // Set this one
    await CompareReport.findOneAndUpdate({ reportId: req.params.id }, { $set: { isBaseline: true } });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

reportsRouter.delete('/:id', async (req, res) => {
  try {
    await CompareReport.deleteOne({ reportId: req.params.id });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Eval Results Router ──────────────────────────────────────────────────────

const evalRouter = express.Router();

// GET all results (latest per scenario)
evalRouter.get('/', async (_req, res) => {
  try {
    const docs = await EvalResult.find({}).sort({ runAt: -1 }).lean();
    res.json(docs.map(({ _id, ...r }) => r));
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// POST save/update a result (upsert by scenarioId, keep run history)
evalRouter.post('/', async (req, res) => {
  try {
    const { scenarioId, pass, score, reason, detail, method, botResponse, testMessage, scenarioName, category } = req.body;
    if (!scenarioId) return res.status(400).json({ error: 'scenarioId required' });

    const existing = await EvalResult.findOne({ scenarioId });
    const runAt    = new Date().toISOString();
    const historyEntry = { pass, score, reason, runAt };

    let runHistory = existing?.runHistory ?? [];
    runHistory = [historyEntry, ...runHistory].slice(0, 20); // keep last 20 runs

    // Detect flakiness: if last 3 runs have different results
    const flaky = runHistory.length >= 3 &&
      new Set(runHistory.slice(0, 3).map(r => r.pass)).size > 1;

    await EvalResult.findOneAndUpdate(
      { scenarioId },
      { $set: {
          scenarioId, scenarioName, category, testMessage, botResponse,
          pass, score, reason, detail, method, runAt, flaky, runHistory,
        }
      },
      { upsert: true, new: true, runValidators: false }
    );
    res.json({ ok: true, flaky });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE all results
evalRouter.delete('/', async (_req, res) => {
  try {
    await EvalResult.deleteMany({});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Question Bank Router ─────────────────────────────────────────────────────

const qbRouter = express.Router();

// Helper: auto-detect category from question text
function detectCategory(text) {
  const t = text.toLowerCase();
  if (/charg|session|kwh|\bac\b|\bdc\b|plug|connector|start.*charg|stop.*charg/i.test(t)) return 'charging';
  if (/pay|wallet|money|refund|bill|invoice|transaction|₹|rupee/i.test(t)) return 'payment';
  if (/register|sign.?up|creat.*account|onboard|new.*user/i.test(t)) return 'registration';
  if (/fault|smoke|smell|damage|broken|not.work|error|faulted/i.test(t)) return 'fault';
  if (/help|support|contact|24.7|helpline|toll.?free/i.test(t)) return 'support';
  if (/profile|phone|name|password|login|otp|account/i.test(t)) return 'account';
  return 'general';
}

// GET /api/questions-bank — return all questions sorted newest first
qbRouter.get('/', async (_req, res) => {
  try {
    const docs = await QuestionBank.find({}).sort({ createdAt: -1 }).lean();
    res.json({ questions: docs.map(({ _id, ...d }) => ({ id: _id.toString(), ...d })) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Shared helper: pull history + LLM generate (no DB write) ──────────────────
async function generateQuestions(count = 20) {
  let historyQuestions = [];
  try {
    const sessions = await Session.find({}, { messages: 1, _id: 0 }).lean();
    const seen = new Set();
    const SKIP = [
      /^📍/, /^shared location/i,
      /^\s*(yes|no|ok|okay|thanks|thank you|hi|hello|bye|sure|done)\s*$/i,
      /^https?:\/\//i, /^\d{6}$/, /^[+\d\s\-()]{7,15}$/,
    ];
    for (const s of sessions) {
      for (const m of (s.messages || [])) {
        if (m.role !== 'user' || m.isButtonTap) continue;
        const raw = (m.content || '').trim();
        if (raw.length < 8 || raw.length > 300) continue;
        if (SKIP.some(r => r.test(raw))) continue;
        const norm = raw.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(norm)) { seen.add(norm); historyQuestions.push(raw); }
      }
    }
  } catch (e) { console.warn('[QB] history fetch failed:', e.message); }

  let generated = [];
  let method = 'fallback';
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;

  if (apiKey && historyQuestions.length > 0) {
    try {
      const seedList = historyQuestions.slice(0, 30).map((q, i) => `${i + 1}. ${q}`).join('\n');
      const llmRes = await fetch(
        process.env.LLM_BASE_URL || 'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.LLM_MODEL || 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You generate test questions for ChargeZone — an Indian EV charging platform where users interact via WhatsApp. Study the real user questions provided, understand their vocabulary, style, topics, and level of detail, then generate MORE questions that feel like they came from the SAME real users. Match the tone, vocabulary, and sentence structure. Cover: finding chargers, sessions, payments, wallet, RFID, faults, refunds, registration, account. Write in natural Indian English as real users would type on WhatsApp. Output ONLY the questions, one per line, no numbering, no bullets.`,
              },
              {
                role: 'user',
                content: `Here are ${historyQuestions.length} real messages from our ChargeZone WhatsApp chat history:\n\n${seedList}\n\nStudy these carefully. Now generate ${count} MORE questions that feel like they came from the same real users. Output only the questions, one per line.`,
              },
            ],
            max_tokens: 1200,
            temperature: 0.85,
          }),
        }
      );
      const data = await llmRes.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      generated = text
        .split('\n')
        .map(l => l.trim().replace(/^[-•*\d.]+\s*/, ''))
        .filter(l => l.length > 10 && l.length < 250 && /[a-z]/i.test(l))
        .slice(0, count);
      if (generated.length > 0) method = 'llm';
    } catch (e) { console.warn('[QB] LLM failed:', e.message); }
  }

  if (generated.length === 0) {
    const LOCS = ['Jaipur', 'Delhi', 'Mumbai', 'Pune', 'Gurgaon', 'Noida'];
    const CARS = ['Nexon EV', 'Tata Tigor EV', 'MG ZS EV', 'Ather 450X'];
    const rand = arr => arr[Math.floor(Math.random() * arr.length)];
    generated = [
      'How do I find EV chargers near {loc}?',
      'My RFID card is not working at the {loc} charger',
      'The charger shows Faulted, what should I do?',
      'How do I add ₹500 to my ChargeZone wallet?',
      'I started a session but it stopped in 10 minutes without charging fully',
      'How long does it take to charge a {car} from 20% to 80%?',
      'I paid but the charging did not start. Where is my money?',
      'What is the per unit rate at ChargeZone AC chargers?',
      'How do I register my {car} on the ChargeZone app?',
      'The app shows charger is available but it is occupied',
      'How do I get invoice for my last charging session?',
      'My session ended but I was charged double',
      'There is a burning smell from the charger, what do I do?',
      'How do I change my registered phone number?',
      'The QR code on the charger is not scanning',
      'I need a refund for a failed transaction from last week',
      'Does ChargeZone have chargers on the Delhi-Jaipur highway?',
      'My car shows charging but the app says session not started',
      'Can I use ChargeZone at {loc} mall?',
      'Is there a 24/7 helpline for ChargeZone?',
    ].slice(0, count).map(t => t.replace('{loc}', rand(LOCS)).replace('{car}', rand(CARS)));
    method = 'fallback';
  }

  return { generated, historyCount: historyQuestions.length, method };
}

// POST /api/questions-bank/preview — generate questions WITHOUT saving (for dialog)
qbRouter.post('/preview', async (req, res) => {
  const { count = 20 } = req.body;
  try {
    const { generated, historyCount, method } = await generateQuestions(count);
    res.json({
      ok: true,
      method,
      historyCount,
      questions: generated.map(text => ({
        text,
        category: detectCategory(text),
      })),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// POST /api/questions-bank/save-batch — save only the selected questions
qbRouter.post('/save-batch', async (req, res) => {
  const { questions = [] } = req.body; // [{ text, category }]
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'questions array required' });
  }
  const batchId = `batch_${Date.now()}`;
  const saved = [];
  for (const { text, category } of questions) {
    if (!text || text.trim().length < 5) continue;
    try {
      const doc = new QuestionBank({
        text: text.trim(),
        category: category || detectCategory(text.trim()),
        source: 'ai',
        batchId,
        createdAt: new Date(),
      });
      await doc.save();
      const { _id, ...rest } = doc.toObject();
      saved.push({ id: _id.toString(), ...rest });
    } catch (e) {
      if (e.code !== 11000) console.warn('[QB save-batch] error:', e.message);
      // skip duplicates silently
    }
  }
  const allDocs = await QuestionBank.find({}).sort({ createdAt: -1 }).lean();
  res.json({
    ok: true,
    batchId,
    savedCount: saved.length,
    questions: allDocs.map(({ _id, ...d }) => ({ id: _id.toString(), ...d })),
  });
});

// POST /api/questions-bank/generate
// Full pipeline: (1) pull real history questions, (2) AI generates more, (3) save to DB
qbRouter.post('/generate', async (req, res) => {
  const { count = 20 } = req.body;
  const batchId = `batch_${Date.now()}`;

  // ── Step 1: Pull all real user questions from chat history ──────────────────
  let historyQuestions = [];
  try {
    const sessions = await Session.find({}, { messages: 1, _id: 0 }).lean();
    const seen = new Set();
    const SKIP = [
      /^📍/, /^shared location/i,
      /^\s*(yes|no|ok|okay|thanks|thank you|hi|hello|bye|sure|done)\s*$/i,
      /^https?:\/\//i, /^\d{6}$/, /^[+\d\s\-()]{7,15}$/,
    ];
    for (const s of sessions) {
      for (const m of (s.messages || [])) {
        if (m.role !== 'user' || m.isButtonTap) continue;
        const raw = (m.content || '').trim();
        if (raw.length < 8 || raw.length > 300) continue;
        if (SKIP.some(r => r.test(raw))) continue;
        const norm = raw.toLowerCase().replace(/\s+/g, ' ');
        if (!seen.has(norm)) { seen.add(norm); historyQuestions.push(raw); }
      }
    }
  } catch (e) {
    console.warn('[QB Generate] history fetch failed:', e.message);
  }

  // ── Step 2: Generate via LLM using history as context ──────────────────────
  let generated = [];
  let method = 'fallback';

  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (apiKey && historyQuestions.length > 0) {
    try {
      // Use up to 30 real questions as seed context
      const seedList = historyQuestions
        .slice(0, 30)
        .map((q, i) => `${i + 1}. ${q}`)
        .join('\n');

      const llmRes = await fetch(
        process.env.LLM_BASE_URL || 'https://api.openai.com/v1/chat/completions',
        {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: process.env.LLM_MODEL || 'gpt-4o-mini',
            messages: [
              {
                role: 'system',
                content: `You generate test questions for ChargeZone — an Indian EV charging platform where users interact via WhatsApp.
Your job: study the real user questions provided, understand their vocabulary, style, topics, and level of detail, then generate MORE questions that feel like they came from the SAME real users.
Rules:
- Match the tone, vocabulary, and sentence structure of the real users
- Cover a variety of topics: finding chargers, sessions, payments, wallet, RFID, faults, refunds, registration, account
- Write in natural Indian English as real users would type on WhatsApp
- Do NOT generate formal or marketing-style questions
- Output ONLY the questions, one per line, no numbering, no bullets`,
              },
              {
                role: 'user',
                content: `Here are ${historyQuestions.length} real messages from our ChargeZone WhatsApp chat history:\n\n${seedList}\n\nStudy these carefully — notice the style, vocabulary, abbreviations, and topics. Now generate ${count} MORE questions that feel like they came from the same real users. Output only the questions, one per line.`,
              },
            ],
            max_tokens: 1200,
            temperature: 0.85,
          }),
        }
      );
      const data = await llmRes.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      generated = text
        .split('\n')
        .map(l => l.trim().replace(/^[-•*\d.]+\s*/, ''))
        .filter(l => l.length > 10 && l.length < 250 && /[a-z]/i.test(l))
        .slice(0, count);
      if (generated.length > 0) method = 'llm';
    } catch (e) {
      console.warn('[QB Generate] LLM failed:', e.message);
    }
  }

  // Fallback if LLM unavailable or history is empty
  if (generated.length === 0) {
    const CZ_TEMPLATES = [
      'How do I find EV chargers near {loc}?',
      'My RFID card is not working at the {loc} charger',
      'The charger shows Faulted, what should I do?',
      'How do I add ₹500 to my ChargeZone wallet?',
      'I started a session but it stopped in 10 minutes without charging fully',
      'How long does it take to charge a {car} from 20% to 80%?',
      'I paid but the charging did not start. Where is my money?',
      'What is the per unit rate at ChargeZone AC chargers?',
      'How do I register my {car} on the ChargeZone app?',
      'The app shows charger is available but it is occupied',
      'How do I get invoice for my last charging session?',
      'My session ended but I was charged double',
      'There is a burning smell from the charger, what do I do?',
      'How do I change my registered phone number?',
      'The QR code on the charger is not scanning',
      'I need a refund for a failed transaction from last week',
      'Does ChargeZone have chargers on the Delhi-Jaipur highway?',
      'My car shows charging but the app says session not started',
      'Can I use ChargeZone at {loc} mall?',
      'Is there a 24/7 helpline for ChargeZone?',
    ];
    const LOCS = ['Jaipur', 'Delhi', 'Mumbai', 'Pune', 'Gurgaon', 'Noida'];
    const CARS = ['Nexon EV', 'Tata Tigor EV', 'MG ZS EV', 'Ather 450X'];
    const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
    generated = CZ_TEMPLATES.slice(0, count).map(t =>
      t.replace('{loc}', rand(LOCS)).replace('{car}', rand(CARS))
    );
    method = 'fallback';
  }

  // ── Step 3: Save to QuestionBank (skip duplicates) ──────────────────────────
  const savedQuestions = [];
  for (const text of generated) {
    try {
      const doc = await QuestionBank.findOneAndUpdate(
        { text: { $regex: `^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, $options: 'i' } },
        { $setOnInsert: { text, category: detectCategory(text), source: 'ai', batchId, createdAt: new Date() } },
        { upsert: true, new: true, rawResult: true, runValidators: false }
      );
      const saved = doc.value || doc;
      if (saved && saved._id) {
        savedQuestions.push({
          id: saved._id.toString(),
          text: saved.text,
          category: saved.category,
          source: saved.source,
          batchId: saved.batchId,
          createdAt: saved.createdAt,
        });
      }
    } catch (e) {
      // Skip duplicate key errors silently
      if (e.code !== 11000) console.warn('[QB Save] error:', e.message);
    }
  }

  // Return all questions currently in bank
  const allDocs = await QuestionBank.find({}).sort({ createdAt: -1 }).lean();
  res.json({
    ok: true,
    method,
    historyCount: historyQuestions.length,
    generatedCount: generated.length,
    savedCount: savedQuestions.length,
    batchId,
    questions: allDocs.map(({ _id, ...d }) => ({ id: _id.toString(), ...d })),
  });
});

// POST /api/questions-bank — add a single custom question
qbRouter.post('/', async (req, res) => {
  const { text } = req.body;
  if (!text || text.trim().length < 5) return res.status(400).json({ error: 'text is required (min 5 chars)' });
  try {
    const doc = new QuestionBank({
      text: text.trim(),
      category: detectCategory(text.trim()),
      source: 'custom',
    });
    await doc.save();
    const { _id, ...rest } = doc.toObject();
    res.json({ ok: true, question: { id: _id.toString(), ...rest } });
  } catch (err) {
    if (err.code === 11000) return res.status(409).json({ error: 'Question already exists' });
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/questions-bank/:id
qbRouter.delete('/:id', async (req, res) => {
  try {
    const result = await QuestionBank.deleteOne({ _id: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// DELETE /api/questions-bank — clear all
qbRouter.delete('/', async (_req, res) => {
  try {
    await QuestionBank.deleteMany({});
    res.json({ ok: true });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

// ── LLM-as-Judge endpoint ─────────────────────────────────────────────────────
app.post('/api/eval/judge', async (req, res) => {
  const { testMessage, botResponse, successCondition } = req.body;
  if (!botResponse || !successCondition) {
    return res.status(400).json({ error: 'botResponse and successCondition are required' });
  }

  // Try real LLM if API key is configured
  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (apiKey) {
    try {
      const llmRes = await fetch(process.env.LLM_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'gpt-4o-mini',
          messages: [{
            role: 'user',
            content: `You are an expert evaluator for a ChargeZone EV charging AI agent.

Test message sent to the bot:
"${testMessage}"

Bot response:
"${botResponse}"

Success condition (what the bot should have done):
"${successCondition}"

Evaluate strictly whether the bot response meets the success condition.
Reply in EXACTLY this format — no extra text:
VERDICT: PASS
SCORE: 85
REASON: The bot correctly explained that charging hours vary by station and directed to the app.
EVIDENCE: "operating hours depend on the host location"`
          }],
          max_tokens: 180,
          temperature: 0.1,
        }),
      });
      const data = await llmRes.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      const pass     = /VERDICT:\s*PASS/i.test(text);
      const scoreM   = text.match(/SCORE:\s*(\d+)/);
      const reasonM  = text.match(/REASON:\s*(.+?)(?:\n|$)/);
      const evidenceM = text.match(/EVIDENCE:\s*(.+?)(?:\n|$)/);
      return res.json({
        pass,
        score:  scoreM   ? parseInt(scoreM[1]) / 100  : (pass ? 0.82 : 0.18),
        reason: reasonM  ? reasonM[1].trim()           : (pass ? 'Response meets criteria.' : 'Response does not meet criteria.'),
        detail: evidenceM ? evidenceM[1].trim().replace(/^"|"$/g, '') : undefined,
        method: 'llm',
      });
    } catch (e) {
      console.warn('[Judge] LLM failed, falling back to smart:', e.message);
    }
  }

  // Smart fallback
  res.json(smartJudge(testMessage, botResponse, successCondition));
});

// ── AI Question Generator ─────────────────────────────────────────────────────
app.post('/api/generate-questions', async (req, res) => {
  const { questions = [], count = 12, fromHistory = false } = req.body;

  const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY;
  if (apiKey && questions.length > 0) {
    try {
      const seedList = questions.slice(0, 25).map((q, i) => `${i + 1}. ${q}`).join('\n');
      const llmRes = await fetch(process.env.LLM_BASE_URL || 'https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: process.env.LLM_MODEL || 'gpt-4o-mini',
          messages: [{
            role: 'system',
            content: `You generate test questions for ChargeZone (CZ) — an Indian EV charging platform. Users chat via WhatsApp. Generate realistic, conversational questions in Indian English that real CZ app users would ask. Topics: finding chargers, starting/stopping charging sessions, payment, wallet top-up, RFID cards, vehicle registration, billing issues, refunds, charger faults, account management. Keep varied, human, direct. No markdown.`,
          }, {
            role: 'user',
            content: `${fromHistory ? 'These are real user messages from our chat history:\n' : 'Use these as style examples:\n'}${seedList}\n\nGenerate ${count} more distinct, realistic CZ user questions. Different phrasings and topics. Output only the questions — one per line, no numbering, no bullets, no extra text.`,
          }],
          max_tokens: 900,
          temperature: 0.88,
        }),
      });
      const data = await llmRes.json();
      const text = data.choices?.[0]?.message?.content ?? '';
      const generated = text.split('\n')
        .map(l => l.trim().replace(/^[-•*\d.]+\s*/, ''))
        .filter(l => l.length > 12 && l.length < 200)
        .slice(0, count);
      if (generated.length > 0) return res.json({ generated, method: 'llm' });
    } catch (e) {
      console.warn('[GenerateQ] LLM failed:', e.message);
    }
  }

  // Smart fallback — CZ domain templates
  const CZ_TEMPLATES = [
    'How do I find EV chargers near {loc}?',
    'My RFID card is not working at the {loc} charger',
    'Can I use ChargeZone at {loc} mall?',
    'The charger shows Faulted, what should I do?',
    'How do I add ₹500 to my ChargeZone wallet?',
    'I started a session but it stopped in 10 minutes without charging fully',
    'How long does it take to charge a {car} from 20% to 80%?',
    'Is there a 24/7 helpline for ChargeZone?',
    'I paid but the charging did not start. Where is my money?',
    'What is the per unit rate at ChargeZone AC chargers?',
    'How do I register my {car} on the ChargeZone app?',
    'Can I share my account with my spouse?',
    'The app shows charger is available but it\'s occupied, please help',
    'How do I get invoice for my charging session?',
    'My session ended but I was charged double',
    'Can I book a charger in advance for a specific time?',
    'There is a burning smell from the charger, what do I do?',
    'How do I change my registered phone number?',
    'Does ChargeZone support AC as well as DC fast charging?',
    'The QR code on the charger is not scanning, what now?',
    'I need a refund for a failed transaction from last week',
    'How to check my charging history and bills?',
    'Does ChargeZone have chargers on the Delhi-Jaipur highway?',
    'My car shows charging but the app says session not started',
  ];
  const LOCS = ['Jaipur', 'Delhi', 'Mumbai', 'Pune', 'Gurgaon', 'Noida', 'Select City Walk', 'Phoenix Mall'];
  const CARS = ['Nexon EV', 'Tata Tigor EV', 'MG ZS EV', 'Hyundai Kona', 'Ather 450X', 'Ola S1 Pro'];
  const rand = (arr) => arr[Math.floor(Math.random() * arr.length)];
  const generated = CZ_TEMPLATES.slice(0, count).map(t =>
    t.replace('{loc}', rand(LOCS)).replace('{car}', rand(CARS))
  );
  res.json({ generated, method: 'fallback' });
});

// ── Extract questions from chat sessions ───────────────────────────────────────
app.get('/api/sessions/questions', async (_req, res) => {
  try {
    const sessions = await Session.find({}, { messages: 1, _id: 0 }).lean();
    const seen = new Set();
    const questions = [];
    for (const s of sessions) {
      for (const m of (s.messages || [])) {
        if (m.role === 'user' && !m.isButtonTap && m.content && m.content.length > 8) {
          const clean = m.content.trim();
          const key = clean.toLowerCase().slice(0, 60);
          if (!seen.has(key)) { seen.add(key); questions.push(clean); }
        }
      }
    }
    res.json({ questions: questions.slice(0, 200) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ── Metrics endpoint ──────────────────────────────────────────────────────────
app.get('/api/metrics', async (_req, res) => {
  try {
    const sessions = await Session.find({}, { messages: 0 }).lean();
    const evalResults = await EvalResult.find({}).lean();

    // Sessions per day (last 30 days)
    const now = Date.now();
    const dayMs = 86400000;
    const sessionsByDay = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * dayMs);
      sessionsByDay[d.toISOString().slice(0, 10)] = 0;
    }
    for (const s of sessions) {
      const day = (s.createdAt || '').slice(0, 10);
      if (sessionsByDay[day] !== undefined) sessionsByDay[day]++;
    }

    // Agent type failures (from sessions with messages — we'll approximate from agentTypesUsed)
    const agentFailures = {};
    for (const s of sessions) {
      const bugRatio = s.totalMessages > 0 ? ((s.flags?.bug || 0) + (s.flags?.fail || 0)) / s.totalMessages : 0;
      if (bugRatio > 0.2) {
        for (const at of (s.agentTypesUsed || [])) {
          agentFailures[at] = (agentFailures[at] || 0) + 1;
        }
      }
    }

    // Overall flag aggregates
    const totalFlags  = { pass: 0, fail: 0, bug: 0, slow: 0 };
    let totalAvgMs    = 0;
    let msCount       = 0;
    for (const s of sessions) {
      totalFlags.pass += s.flags?.pass || 0;
      totalFlags.fail += s.flags?.fail || 0;
      totalFlags.bug  += s.flags?.bug  || 0;
      totalFlags.slow += s.flags?.slow || 0;
      if (s.avgResponseTimeMs > 0) { totalAvgMs += s.avgResponseTimeMs; msCount++; }
    }

    // Eval results breakdown
    const evalByCategory = {};
    const topFailing     = [];
    for (const r of evalResults) {
      const cat = r.category || 'unknown';
      if (!evalByCategory[cat]) evalByCategory[cat] = { pass: 0, fail: 0 };
      if (r.pass) evalByCategory[cat].pass++; else evalByCategory[cat].fail++;
      if (!r.pass) topFailing.push({ name: r.scenarioName, reason: r.reason, runAt: r.runAt, flaky: r.flaky });
    }
    topFailing.sort((a, b) => new Date(b.runAt) - new Date(a.runAt));

    // Pass rate over time (from evalResults runHistory)
    const passRateByDay = {};
    for (let i = 29; i >= 0; i--) {
      const d = new Date(now - i * dayMs).toISOString().slice(0, 10);
      passRateByDay[d] = { pass: 0, total: 0 };
    }
    for (const r of evalResults) {
      for (const h of (r.runHistory || [])) {
        const day = (h.runAt || '').slice(0, 10);
        if (passRateByDay[day]) {
          passRateByDay[day].total++;
          if (h.pass) passRateByDay[day].pass++;
        }
      }
    }

    // Health score
    const totalFlagged = totalFlags.fail + totalFlags.bug;
    const totalFlagAll = totalFlags.pass + totalFlags.fail + totalFlags.bug + totalFlags.slow;
    const flagRatio    = totalFlagAll > 0 ? totalFlagged / totalFlagAll : 0;
    const evalPassRate = evalResults.length > 0
      ? evalResults.filter(r => r.pass).length / evalResults.length
      : 0.5;
    const healthScore  = Math.round(
      (1 - flagRatio)   * 40 +
      evalPassRate      * 40 +
      Math.min(1, sessions.length / 20) * 20
    );

    res.json({
      healthScore,
      totalSessions:   sessions.length,
      totalEvalRuns:   evalResults.length,
      evalPassRate:    Math.round(evalPassRate * 100),
      avgResponseMs:   msCount > 0 ? Math.round(totalAvgMs / msCount) : 0,
      flags:           totalFlags,
      sessionsByDay,
      passRateByDay,
      agentFailures,
      evalByCategory,
      topFailing:      topFailing.slice(0, 5),
      flakyCount:      evalResults.filter(r => r.flaky).length,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/stats', async (_req, res) => {
  try {
    const total    = await Session.countDocuments();
    const pipeline = [{ $group: {
      _id: null,
      totalMessages:      { $sum: '$totalMessages' },
      totalAgentMessages: { $sum: '$totalAgentMessages' },
      totalPass:          { $sum: '$flags.pass' },
      totalFail:          { $sum: '$flags.fail' },
      totalBug:           { $sum: '$flags.bug' },
      totalSlow:          { $sum: '$flags.slow' },
    }}];
    const [agg] = await Session.aggregate(pipeline);
    res.json({ sessions: total, ...agg, _id: undefined });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Mount routers
app.use('/api/sessions',            sessionsRouter);
app.use('/api/arena/chat-sessions', sessionsRouter);
app.use('/api/compare-reports',     reportsRouter);
app.use('/api/eval-results',        evalRouter);
app.use('/api/questions-bank',      qbRouter);
app.use('/api/golden',              createGoldenRouter());

// ─── Serve dashboard in production ───────────────────────────────────────────
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  const distDir = path.join(__dirname, '../dashboard/dist');
  app.use(express.static(distDir));
  app.get(/^(?!\/api\/)/, (_req, res) => res.sendFile(path.join(distDir, 'index.html')));
}

module.exports = app;
