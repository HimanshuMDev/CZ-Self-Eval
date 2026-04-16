require('dotenv').config();
const express   = require('express');
const mongoose  = require('mongoose');
const cors      = require('cors');

const app  = express();
const PORT = process.env.PORT || 4001;

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '20mb' }));

// ─── MongoDB ──────────────────────────────────────────────────────────────────
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/cz-self-eval';

mongoose.connect(MONGODB_URI)
  .then(() => console.log(`✅  MongoDB connected → ${MONGODB_URI.replace(/:\/\/.*@/, '://<credentials>@')}`))
  .catch(err => { console.error('❌  MongoDB connection error:', err.message); process.exit(1); });

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
    buttons: [{
      id:      String,
      title:   String,
      payload: String,
    }],
    data:           { type: mongoose.Schema.Types.Mixed, default: null },
  },
}, { _id: false });

const SessionSchema = new mongoose.Schema({
  // Use `sessionId` as the Mongo primary key alias so `id` is the app-level ID
  sessionId:           { type: String, required: true, unique: true, index: true },
  title:               { type: String, default: 'Untitled Session' },
  createdAt:           { type: String, required: true },
  updatedAt:           { type: String, required: true },
  from:                { type: String, default: '' },
  totalMessages:       { type: Number, default: 0 },
  totalAgentMessages:  { type: Number, default: 0 },
  avgResponseTimeMs:   { type: Number, default: 0 },
  agentTypesUsed:      [String],
  flags: {
    pass: { type: Number, default: 0 },
    fail: { type: Number, default: 0 },
    bug:  { type: Number, default: 0 },
    slow: { type: Number, default: 0 },
  },
  messages:  [MessageSchema],
  summary:   { type: String, default: null },
}, {
  timestamps: false,   // we manage our own timestamps
  versionKey: false,
});

const Session = mongoose.model('Session', SessionSchema);

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Map a Mongoose doc → the shape the frontend expects (with `id` field) */
function toClient(doc, includeMessages = true) {
  if (!doc) return null;
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const { sessionId, _id, messages, ...rest } = obj;
  const out = { id: sessionId, ...rest };
  if (includeMessages) out.messages = messages ?? [];
  return out;
}

/** Strip unknown fields and normalise a session payload from the client */
function fromClient(body) {
  const { id, messages = [], ...rest } = body;
  return { sessionId: id, messages, ...rest };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/** Health check */
app.get('/health', (_req, res) => res.json({ ok: true, time: new Date().toISOString() }));

/** List all sessions (metadata only, no messages) — sorted newest first */
app.get('/api/sessions', async (_req, res) => {
  try {
    const docs = await Session.find({}, { messages: 0 }).sort({ updatedAt: -1 }).lean();
    const sessions = docs.map(d => {
      const { sessionId, _id, ...rest } = d;
      return { id: sessionId, ...rest };
    });
    res.json(sessions);
  } catch (err) {
    console.error('[GET /api/sessions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Export ALL sessions with messages (for JSON bulk download) */
app.get('/api/sessions/export/all', async (_req, res) => {
  try {
    const docs = await Session.find({}).sort({ updatedAt: -1 });
    res.json(docs.map(d => toClient(d, true)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Get a single session with messages */
app.get('/api/sessions/:id', async (req, res) => {
  try {
    const doc = await Session.findOne({ sessionId: req.params.id });
    if (!doc) return res.status(404).json({ error: 'Session not found' });
    res.json(toClient(doc, true));
  } catch (err) {
    console.error('[GET /api/sessions/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Create or update (upsert) a session */
app.post('/api/sessions', async (req, res) => {
  try {
    const payload = fromClient(req.body);
    if (!payload.sessionId) return res.status(400).json({ error: 'Session id is required' });

    const doc = await Session.findOneAndUpdate(
      { sessionId: payload.sessionId },
      { $set: payload },
      { upsert: true, new: true, runValidators: false }
    );
    res.json({ ok: true, id: doc.sessionId });
  } catch (err) {
    console.error('[POST /api/sessions]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Bulk import — accepts array of sessions */
app.post('/api/sessions/import', async (req, res) => {
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
  } catch (err) {
    console.error('[POST /api/sessions/import]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Delete a session */
app.delete('/api/sessions/:id', async (req, res) => {
  try {
    const result = await Session.deleteOne({ sessionId: req.params.id });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Session not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/sessions/:id]', err.message);
    res.status(500).json({ error: err.message });
  }
});

/** Stats endpoint */
app.get('/api/stats', async (_req, res) => {
  try {
    const total    = await Session.countDocuments();
    const pipeline = [
      { $group: {
        _id: null,
        totalMessages:      { $sum: '$totalMessages' },
        totalAgentMessages: { $sum: '$totalAgentMessages' },
        totalPass:          { $sum: '$flags.pass' },
        totalFail:          { $sum: '$flags.fail' },
        totalBug:           { $sum: '$flags.bug' },
        totalSlow:          { $sum: '$flags.slow' },
      }},
    ];
    const [agg] = await Session.aggregate(pipeline);
    res.json({ sessions: total, ...agg, _id: undefined });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`🚀  CZ Self-Eval server running on http://localhost:${PORT}`);
  console.log(`     GET    /api/sessions`);
  console.log(`     GET    /api/sessions/:id`);
  console.log(`     POST   /api/sessions          (upsert)`);
  console.log(`     POST   /api/sessions/import   (bulk)`);
  console.log(`     DELETE /api/sessions/:id`);
  console.log(`     GET    /api/sessions/export/all`);
  console.log(`     GET    /api/stats`);
});
