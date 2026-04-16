import mongoose, { Schema, Document, Model } from 'mongoose';
import { mongoConfig } from '../config/index.js';
import { createLogger } from '../common/utils/logger.js';

const logger = createLogger('ChatSessionService');

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ChatMessageRecord {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  isButtonTap?: boolean;
  metadata?: {
    agentType?: string;
    responseTimeMs?: number;
    buttons?: Array<{ id: string; title: string; payload?: string }>;
    data?: Record<string, unknown>;
  };
  comment?: string;
  flag?: 'pass' | 'fail' | 'bug' | 'slow' | null;
}

export interface ChatSession {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  from: string;
  totalMessages: number;
  totalAgentMessages: number;
  avgResponseTimeMs: number;
  agentTypesUsed: string[];
  flags: { pass: number; fail: number; bug: number; slow: number };
  messages: ChatMessageRecord[];
  summary?: string;
}

// ─── Mongoose Schema ──────────────────────────────────────────────────────────

interface ChatSessionDoc extends Document {
  sessionId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  from: string;
  totalMessages: number;
  totalAgentMessages: number;
  avgResponseTimeMs: number;
  agentTypesUsed: string[];
  flags: { pass: number; fail: number; bug: number; slow: number };
  messages: ChatMessageRecord[];
  summary?: string;
}

const MessageSchema = new Schema<ChatMessageRecord>(
  {
    id:          { type: String, required: true },
    role:        { type: String, enum: ['user', 'agent'], required: true },
    content:     { type: String, default: '' },
    timestamp:   { type: String, required: true },
    isButtonTap: { type: Boolean, default: false },
    comment:     { type: String, default: null },
    flag:        { type: String, enum: ['pass', 'fail', 'bug', 'slow', null], default: null },
    metadata:    { type: Schema.Types.Mixed, default: null },
  },
  { _id: false }
);

const ChatSessionSchema = new Schema<ChatSessionDoc>(
  {
    sessionId:          { type: String, required: true, unique: true, index: true },
    title:              { type: String, default: 'Untitled Session' },
    createdAt:          { type: String, required: true },
    updatedAt:          { type: String, required: true },
    from:               { type: String, default: '' },
    totalMessages:      { type: Number, default: 0 },
    totalAgentMessages: { type: Number, default: 0 },
    avgResponseTimeMs:  { type: Number, default: 0 },
    agentTypesUsed:     [String],
    flags: {
      pass: { type: Number, default: 0 },
      fail: { type: Number, default: 0 },
      bug:  { type: Number, default: 0 },
      slow: { type: Number, default: 0 },
    },
    messages: [MessageSchema],
    summary:  { type: String, default: null },
  },
  { versionKey: false }
);

// Lazy model initialisation — avoids "Cannot overwrite model" errors in tests
function getModel(): Model<ChatSessionDoc> {
  if (mongoose.modelNames().includes('ChatSession')) {
    return mongoose.model<ChatSessionDoc>('ChatSession');
  }
  return mongoose.model<ChatSessionDoc>('ChatSession', ChatSessionSchema);
}

// ─── DB connection helper ─────────────────────────────────────────────────────

let _connected = false;

async function ensureConnected(): Promise<void> {
  if (_connected || mongoose.connection.readyState === 1) return;
  try {
    await mongoose.connect(mongoConfig.uri);
    _connected = true;
    logger.info({ uri: mongoConfig.uri.replace(/:\/\/.*@/, '://<credentials>@') }, '[ChatSessionService] MongoDB connected');
  } catch (err) {
    logger.error({ err }, '[ChatSessionService] MongoDB connection failed');
    throw err;
  }
}

// ─── Helper: doc → ChatSession ────────────────────────────────────────────────

function toSession(doc: ChatSessionDoc): ChatSession {
  const obj = doc.toObject ? doc.toObject() : { ...doc };
  const { sessionId, _id, __v, ...rest } = obj as any;
  return { id: sessionId, ...rest } as ChatSession;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export class ChatSessionService {

  async saveChatSession(session: ChatSession): Promise<void> {
    try {
      await ensureConnected();
      const model = getModel();
      const { id, ...rest } = session;
      await model.findOneAndUpdate(
        { sessionId: id },
        { $set: { sessionId: id, ...rest } },
        { upsert: true, new: true, runValidators: false }
      );
      logger.info({ sessionId: id, messages: session.totalMessages }, '[ChatSessionService] Saved');
    } catch (error) {
      logger.error({ error }, '[ChatSessionService] Failed to save session');
    }
  }

  async getChatSessions(): Promise<ChatSession[]> {
    try {
      await ensureConnected();
      const model = getModel();
      const docs = await model.find({}, { messages: 0 }).sort({ updatedAt: -1 });
      return docs.map(toSession);
    } catch (error) {
      logger.error({ error }, '[ChatSessionService] Failed to list sessions');
      return [];
    }
  }

  async getChatSession(id: string): Promise<ChatSession | undefined> {
    try {
      await ensureConnected();
      const model = getModel();
      const doc = await model.findOne({ sessionId: id });
      return doc ? toSession(doc) : undefined;
    } catch (error) {
      logger.error({ error, id }, '[ChatSessionService] Failed to get session');
      return undefined;
    }
  }

  async getAllChatSessions(): Promise<ChatSession[]> {
    try {
      await ensureConnected();
      const model = getModel();
      const docs = await model.find({}).sort({ updatedAt: -1 });
      return docs.map(toSession);
    } catch (error) {
      logger.error({ error }, '[ChatSessionService] Failed to export sessions');
      return [];
    }
  }

  async importChatSessions(sessions: ChatSession[]): Promise<number> {
    let count = 0;
    try {
      await ensureConnected();
      const model = getModel();
      for (const session of sessions) {
        if (!session.id) continue;
        const { id, ...rest } = session;
        await model.findOneAndUpdate(
          { sessionId: id },
          { $set: { sessionId: id, ...rest } },
          { upsert: true, new: true, runValidators: false }
        );
        count++;
      }
      logger.info({ count }, '[ChatSessionService] Bulk import done');
    } catch (error) {
      logger.error({ error }, '[ChatSessionService] Bulk import failed');
    }
    return count;
  }

  async deleteChatSession(id: string): Promise<void> {
    try {
      await ensureConnected();
      const model = getModel();
      await model.deleteOne({ sessionId: id });
      logger.info({ sessionId: id }, '[ChatSessionService] Deleted');
    } catch (error) {
      logger.error({ error, id }, '[ChatSessionService] Failed to delete session');
    }
  }
}

export const chatSessionService = new ChatSessionService();
