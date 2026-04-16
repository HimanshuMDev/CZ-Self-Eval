import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  User, Clock, Trash2, ChevronLeft, MessageSquare,
  GitCompare, RefreshCw, AlertCircle, Download, Loader2,
  Flag, ArrowLeftRight, Search, X, Zap,
  BarChart2, CheckCircle, ChevronDown, ChevronRight,
  Upload, FileJson, CheckCheck, AlertTriangle
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ChatMessageRecord {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: string;
  isButtonTap?: boolean;
  comment?: string;
  flag?: 'pass' | 'fail' | 'bug' | 'slow' | null;
  metadata?: {
    agentType?: string;
    responseTimeMs?: number;
    buttons?: Array<{ id: string; title: string; payload?: string }>;
    data?: Record<string, unknown>;
  };
}

interface ChatSession {
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

interface CompareEntry {
  userMessage: string;
  isButtonTap: boolean;
  oldResponse: string;
  newResponse: string;
  oldAgent?: string;
  newAgent?: string;
  oldTimeMs?: number;
  newTimeMs?: number;
  similarity: number;
  status: 'match' | 'changed' | 'different' | 'error';
}

interface CompareResult {
  sessionId: string;
  sessionTitle: string;
  runAt: string;
  entries: CompareEntry[];
}

interface ReviewItem {
  question: ChatMessageRecord | null;
  answer: ChatMessageRecord;
  flag: 'pass' | 'fail' | 'bug' | 'slow' | null;
  hasComment: boolean;
}

interface GlobalReviewItem extends ReviewItem {
  sessionId: string;
  sessionTitle: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const SIMULATE_URL = 'https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate';

// ─── API helpers — talks directly to live server ──────────────────────────────
const SESSIONS_API = '/api/arena/chat-sessions';

async function apiLoadSessions(): Promise<Omit<ChatSession, 'messages'>[]> {
  const res = await fetch(SESSIONS_API);
  if (!res.ok) throw new Error(`Failed to load sessions: ${res.status}`);
  const data = await res.json();
  // Server returns { sessions: [...] }
  return Array.isArray(data) ? data : (data.sessions ?? []);
}

async function apiLoadSession(id: string): Promise<ChatSession | null> {
  const res = await fetch(`${SESSIONS_API}/${encodeURIComponent(id)}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Failed to load session: ${res.status}`);
  return res.json();
}

async function apiDeleteSession(id: string): Promise<void> {
  const res = await fetch(`${SESSIONS_API}/${encodeURIComponent(id)}`, { method: 'DELETE' });
  if (!res.ok && res.status !== 404) throw new Error(`Failed to delete session: ${res.status}`);
}

async function apiImportSessions(sessions: ChatSession[]): Promise<number> {
  const res = await fetch(`${SESSIONS_API}/import`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(sessions),
  });
  if (!res.ok) throw new Error(`Import failed: ${res.status}`);
  const data = await res.json();
  return data.imported ?? sessions.length;
}

async function apiExportAll(): Promise<ChatSession[]> {
  const res = await fetch(`${SESSIONS_API}/export/all`);
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : (data.sessions ?? []);
}
const DEFAULT_NAME = 'Self-Eval Test User';

const FLAG_META = {
  pass: { label: 'Pass', emoji: '✅', color: '#059669', bg: 'rgba(5,150,105,0.09)',   border: 'rgba(5,150,105,0.22)',  bar: '#10b981', dot: '#34d399' },
  fail: { label: 'Fail', emoji: '❌', color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.2)',   bar: '#ef4444', dot: '#f87171' },
  bug:  { label: 'Bug',  emoji: '🐛', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)',  bar: '#8b5cf6', dot: '#a78bfa' },
  slow: { label: 'Slow', emoji: '🐌', color: '#d97706', bg: 'rgba(217,119,6,0.09)',   border: 'rgba(217,119,6,0.22)', bar: '#f59e0b', dot: '#fbbf24' },
} as const;

const AGENT_META: Record<string, { color: string; bg: string; border: string; emoji: string; label: string }> = {
  discovery:    { color: '#c2410c', bg: 'rgba(194,65,12,0.08)',  border: 'rgba(194,65,12,0.2)',  emoji: '🔍', label: 'Discovery'    },
  session:      { color: '#b45309', bg: 'rgba(180,83,9,0.08)',   border: 'rgba(180,83,9,0.2)',   emoji: '⚡', label: 'Session'      },
  payment:      { color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.2)',  emoji: '💳', label: 'Payment'      },
  support:      { color: '#ea580c', bg: 'rgba(234,88,12,0.08)',  border: 'rgba(234,88,12,0.2)',  emoji: '🎧', label: 'Support'      },
  faq:          { color: '#9a3412', bg: 'rgba(154,52,18,0.08)',  border: 'rgba(154,52,18,0.2)',  emoji: '📖', label: 'FAQ'          },
  registration: { color: '#7c2d12', bg: 'rgba(124,45,18,0.08)', border: 'rgba(124,45,18,0.2)', emoji: '👤', label: 'Registration' },
  error:        { color: '#dc2626', bg: 'rgba(220,38,38,0.07)',  border: 'rgba(220,38,38,0.18)', emoji: '⚠️', label: 'Error'        },
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string, short = false) {
  try {
    const d = new Date(iso);
    if (short) return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
    return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch { return iso; }
}

function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function getAgentMeta(t?: string) {
  return AGENT_META[t?.toLowerCase() ?? ''] ?? {
    color: '#ea580c', bg: 'rgba(234,88,12,0.07)', border: 'rgba(234,88,12,0.18)', emoji: '🤖', label: t || 'Agent',
  };
}

/** Improved similarity: weighted bigram + word-overlap (Sørensen–Dice) */
function similarity(a: string, b: string): number {
  if (!a && !b) return 100;
  if (!a || !b) return 0;
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const words = (s: string) => normalize(s).split(' ').filter(w => w.length > 1);
  const bigrams = (ws: string[]): Set<string> => {
    const s = new Set<string>();
    for (let i = 0; i < ws.length - 1; i++) s.add(`${ws[i]} ${ws[i + 1]}`);
    return s;
  };
  const wa = words(a), wb = words(b);
  if (!wa.length && !wb.length) return 100;
  // Word-level Dice
  const wsa = new Set(wa), wsb = new Set(wb);
  let wCommon = 0; wsa.forEach(w => wsb.has(w) && wCommon++);
  const wScore = wsa.size + wsb.size > 0 ? (2 * wCommon) / (wsa.size + wsb.size) : 1;
  // Bigram-level Dice (better for phrase similarity)
  const bsa = bigrams(wa), bsb = bigrams(wb);
  let bCommon = 0; bsa.forEach(bg => bsb.has(bg) && bCommon++);
  const bScore = bsa.size + bsb.size > 0 ? (2 * bCommon) / (bsa.size + bsb.size) : wScore;
  // Short responses: rely on word overlap; longer: weight bigrams more
  const score = wa.length <= 4 ? wScore : 0.35 * wScore + 0.65 * bScore;
  return Math.round(Math.min(100, score * 100));
}

function entryStatus(sim: number, isError: boolean): CompareEntry['status'] {
  if (isError) return 'error';
  if (sim >= 80) return 'match';
  if (sim >= 50) return 'changed';
  return 'different';
}

/** Inline word diff — returns tokens tagged same / added / removed */
function wordDiff(oldText: string, newText: string): { text: string; type: 'same' | 'added' | 'removed' }[] {
  const tokenize = (t: string) => t.split(/(\s+)/).filter(Boolean);
  const A = tokenize(oldText), B = tokenize(newText);
  if (A.length + B.length > 600) {
    // fallback for very long texts — no diff, just return new text as-is
    return B.map(t => ({ text: t, type: 'same' as const }));
  }
  const m = A.length, n = B.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = A[i - 1].toLowerCase() === B[j - 1].toLowerCase()
        ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
  const result: { text: string; type: 'same' | 'added' | 'removed' }[] = [];
  let i = m, j = n;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && A[i - 1].toLowerCase() === B[j - 1].toLowerCase()) {
      result.unshift({ text: B[j - 1], type: 'same' }); i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ text: B[j - 1], type: 'added' }); j--;
    } else {
      result.unshift({ text: A[i - 1], type: 'removed' }); i--;
    }
  }
  return result;
}

function renderText(text: string) {
  return text.split('\n').map((line, i) => (
    <React.Fragment key={i}>
      {i > 0 && <br />}
      {line.split(/(\*[^*]+\*)/g).map((s, j) =>
        s.startsWith('*') && s.endsWith('*') && s.length > 2
          ? <strong key={j} className="font-semibold">{s.slice(1, -1)}</strong>
          : <span key={j}>{s}</span>
      )}
    </React.Fragment>
  ));
}

function exportMd(filename: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function exportJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

function buildEvalExportRow(item: ReviewItem, sessionTitle?: string) {
  const fm = item.flag ? FLAG_META[item.flag] : null;
  const rt = item.answer.metadata?.responseTimeMs;
  return {
    Asked:     item.question?.content ?? '',
    Agent:     item.answer.content,
    Comment:   item.answer.comment ?? '',
    Flag:      fm ? fm.label : '',
    Time:      rt ? `${(rt / 1000).toFixed(2)}s` : '',
    AgentType: item.answer.metadata?.agentType ?? '',
    ...(sessionTitle ? { Session: sessionTitle } : {}),
    Timestamp: item.answer.timestamp,
  };
}

const iconBtn: React.CSSProperties = {
  background: '#fff', border: '1px solid #EEF0F5', color: '#64748b',
  borderRadius: '10px', padding: '7px', display: 'flex', alignItems: 'center',
  justifyContent: 'center', transition: 'all 0.15s', boxShadow: '0 1px 3px rgba(0,0,0,0.06)',
  cursor: 'pointer',
};

// ─── Minimal Grid Card ────────────────────────────────────────────────────────

const GridCard: React.FC<{
  session: Omit<ChatSession, 'messages'>;
  index: number;
  onSelect: () => void;
  onDelete: () => void;
}> = ({ session, index, onSelect, onDelete }) => {
  const { flags } = session;
  const totalFlags = flags.pass + flags.fail + flags.bug + flags.slow;
  const hasFail = flags.fail > 0 || flags.bug > 0;

  // Health dot color
  const dotColor = flags.fail > 0 ? '#ef4444'
    : flags.bug > 0 ? '#8b5cf6'
    : flags.slow > 0 ? '#f59e0b'
    : flags.pass > 0 ? '#10b981'
    : '#F97316';

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ delay: index * 0.035, type: 'spring', stiffness: 320, damping: 28 }}
      className="relative group cursor-pointer"
      onClick={onSelect}
      style={{
        background: '#fff',
        borderRadius: '18px',
        border: '1px solid #EEF0F5',
        boxShadow: '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)',
        overflow: 'hidden',
        transition: 'box-shadow 0.18s, transform 0.18s, border-color 0.18s',
      }}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow = '0 10px 36px rgba(249,115,22,0.13), 0 4px 12px rgba(0,0,0,0.08)';
        el.style.transform  = 'translateY(-2px)';
        el.style.borderColor = 'rgba(249,115,22,0.3)';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLElement;
        el.style.boxShadow  = '0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)';
        el.style.transform  = 'translateY(0)';
        el.style.borderColor = '#EEF0F5';
      }}
    >
      {/* Orange top bar on hover — always 3px, shows on hover */}
      <div style={{ height: '3px', background: `linear-gradient(90deg, #F97316, #fb923c)`, opacity: 0, transition: 'opacity 0.18s' }}
        className="group-hover:opacity-100" />

      <div className="px-5 py-5">
        {/* Title + health dot */}
        <div className="flex items-start gap-2 mb-3">
          <div className="flex-1 min-w-0">
            <h3 className="text-[14px] font-bold line-clamp-2 leading-snug"
              style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>
              {session.title}
            </h3>
          </div>
          {/* Health indicator dot */}
          {totalFlags > 0 && (
            <div className="shrink-0 mt-0.5 w-2.5 h-2.5 rounded-full"
              style={{ background: dotColor, boxShadow: `0 0 6px ${dotColor}66`, marginTop: '3px' }} />
          )}
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-2 flex-wrap" style={{ color: '#94a3b8' }}>
          <span className="text-[11px]">{fmtDate(session.createdAt, true)}</span>
          <span className="text-[10px] opacity-40">·</span>
          <span className="text-[11px] flex items-center gap-1">
            <MessageSquare style={{ width: '10px', height: '10px' }} />
            {session.totalMessages} msgs
          </span>
          {session.avgResponseTimeMs > 0 && (
            <>
              <span className="text-[10px] opacity-40">·</span>
              <span className="text-[11px] flex items-center gap-1">
                <Clock style={{ width: '10px', height: '10px' }} />
                {(session.avgResponseTimeMs / 1000).toFixed(1)}s
              </span>
            </>
          )}
        </div>

        {/* Mini flag strip — only if flagged */}
        {totalFlags > 0 && (
          <div className="mt-3.5 flex items-center gap-1.5">
            {/* Stacked mini bar */}
            <div className="flex-1 flex rounded-full overflow-hidden h-1.5" style={{ background: '#F0F1F5' }}>
              {flags.fail > 0 && <div style={{ width: `${(flags.fail / totalFlags) * 100}%`, background: FLAG_META.fail.bar }} />}
              {flags.bug  > 0 && <div style={{ width: `${(flags.bug  / totalFlags) * 100}%`, background: FLAG_META.bug.bar  }} />}
              {flags.slow > 0 && <div style={{ width: `${(flags.slow / totalFlags) * 100}%`, background: FLAG_META.slow.bar }} />}
              {flags.pass > 0 && <div style={{ width: `${(flags.pass / totalFlags) * 100}%`, background: FLAG_META.pass.bar }} />}
            </div>
            {hasFail
              ? <span className="text-[9.5px] font-bold shrink-0" style={{ color: '#ef4444' }}>Needs review</span>
              : <span className="text-[9.5px] font-bold shrink-0" style={{ color: '#10b981' }}>All passing</span>
            }
          </div>
        )}
      </div>

      {/* Footer: view arrow */}
      <div className="px-5 pb-4 flex items-center justify-between">
        <div className="flex items-center gap-1">
          {session.agentTypesUsed.slice(0, 2).map(t => {
            const m = getAgentMeta(t);
            return (
              <span key={t} className="text-[9.5px] px-1.5 py-0.5 rounded-md font-medium"
                style={{ background: m.bg, border: `1px solid ${m.border}`, color: m.color }}>
                {m.emoji}
              </span>
            );
          })}
          {session.agentTypesUsed.length > 2 && (
            <span className="text-[9.5px]" style={{ color: '#b0b8c4' }}>+{session.agentTypesUsed.length - 2}</span>
          )}
        </div>
        <ChevronRight style={{ width: '14px', height: '14px', color: '#d1d9e0', transition: 'color 0.15s, transform 0.15s' }}
          className="group-hover:text-orange-400 group-hover:translate-x-0.5" />
      </div>

      {/* Delete button */}
      <button
        onClick={e => { e.stopPropagation(); onDelete(); }}
        className="absolute top-4 right-4 opacity-0 group-hover:opacity-100 p-1.5 rounded-lg transition-all"
        style={{ background: 'rgba(255,255,255,0.95)', border: '1px solid #EEF0F5', color: '#94a3b8', boxShadow: '0 1px 4px rgba(0,0,0,0.08)' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#dc2626'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(220,38,38,0.25)'; }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#94a3b8'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}
      >
        <Trash2 style={{ width: '12px', height: '12px' }} />
      </button>
    </motion.div>
  );
};

// ─── Message Bubble ───────────────────────────────────────────────────────────

const MsgBubble: React.FC<{ msg: ChatMessageRecord }> = ({ msg }) => {
  const [expanded, setExpanded] = useState(false);
  const isAgent = msg.role === 'agent';
  const am  = getAgentMeta(msg.metadata?.agentType);
  const fm  = msg.flag ? FLAG_META[msg.flag as keyof typeof FLAG_META] : null;
  const long    = msg.content.length > 280;
  const display = !expanded && long ? msg.content.slice(0, 280) + '…' : msg.content;
  const rt  = msg.metadata?.responseTimeMs;

  return (
    <div className={`flex gap-3 ${isAgent ? '' : 'flex-row-reverse'}`}>
      <div className="w-8 h-8 rounded-xl shrink-0 flex items-center justify-center mt-1"
        style={isAgent
          ? { background: am.bg, border: `1.5px solid ${am.border}`, boxShadow: '0 2px 6px rgba(0,0,0,0.07)' }
          : { background: 'linear-gradient(135deg,#F97316,#fb923c)', boxShadow: '0 2px 10px rgba(249,115,22,0.3)' }
        }>
        {isAgent ? <span className="text-sm leading-none">{am.emoji}</span>
          : <User style={{ width: '13px', height: '13px', color: '#fff' }} />}
      </div>

      <div className={`max-w-[76%] space-y-1 ${isAgent ? '' : 'items-end flex flex-col'}`}>
        <div className={`flex items-center gap-1.5 flex-wrap ${isAgent ? '' : 'flex-row-reverse'}`}>
          {isAgent && msg.metadata?.agentType && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-semibold"
              style={{ background: am.bg, border: `1px solid ${am.border}`, color: am.color }}>
              {am.emoji} {am.label}
            </span>
          )}
          {msg.isButtonTap && (
            <span className="inline-flex px-1.5 py-0.5 rounded-md text-[9px] font-bold"
              style={{ background: 'rgba(249,115,22,0.09)', border: '1px solid rgba(249,115,22,0.2)', color: '#c2410c' }}>Tap</span>
          )}
          {fm && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md text-[9px] font-bold"
              style={{ background: fm.bg, border: `1px solid ${fm.border}`, color: fm.color }}>
              {fm.emoji} {fm.label}
            </span>
          )}
          <span className="text-[9px]" style={{ color: '#94a3b8' }}>{fmtTime(msg.timestamp)}</span>
          {isAgent && rt && (
            <span className="text-[9px] font-medium" style={{ color: rt > 6000 ? '#dc2626' : rt > 3000 ? '#d97706' : '#94a3b8' }}>
              {(rt / 1000).toFixed(1)}s
            </span>
          )}
        </div>

        <div className="px-4 py-3 text-[13px] leading-relaxed"
          style={isAgent
            ? { background: '#fff', border: '1px solid #EEF0F5', borderTopLeftRadius: '4px', borderTopRightRadius: '16px', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px', color: '#374151', boxShadow: '0 2px 8px rgba(0,0,0,0.06)' }
            : { background: 'linear-gradient(135deg,#F97316,#fb923c)', borderTopLeftRadius: '16px', borderTopRightRadius: '4px', borderBottomLeftRadius: '16px', borderBottomRightRadius: '16px', color: '#fff', boxShadow: '0 3px 12px rgba(249,115,22,0.35)' }
          }>
          {renderText(display)}
          {long && (
            <button onClick={() => setExpanded(!expanded)} className="ml-2 text-[10px] font-semibold"
              style={{ color: isAgent ? '#F97316' : 'rgba(255,255,255,0.75)' }}>
              {expanded ? 'less' : 'more'}
            </button>
          )}
          {isAgent && rt && rt > 0 && (
            <div className="mt-2 h-[3px] rounded-full overflow-hidden" style={{ background: '#f1f5f9' }}>
              <div className="h-full rounded-full"
                style={{ width: `${Math.min((rt / 10000) * 100, 100)}%`, background: rt > 6000 ? '#ef4444' : rt > 3000 ? '#f59e0b' : '#F97316', opacity: 0.55 }} />
            </div>
          )}
          {isAgent && msg.metadata?.buttons && msg.metadata.buttons.length > 0 && (
            <div className="mt-2.5 pt-2 border-t flex flex-wrap gap-1" style={{ borderColor: '#f1f5f9' }}>
              {msg.metadata.buttons.map((btn, i) => (
                <span key={i} className="px-2.5 py-0.5 rounded-lg text-[9.5px] font-semibold"
                  style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', color: '#c2410c' }}>
                  {btn.title}
                </span>
              ))}
            </div>
          )}
        </div>

        {msg.comment && (
          <div className="px-3 py-2 rounded-xl text-[11px] flex items-start gap-1.5"
            style={{ background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.15)', color: '#c2410c' }}>
            <span>💬</span><span>{msg.comment}</span>
          </div>
        )}
      </div>
    </div>
  );
};

// ─── Eval Review Screen ───────────────────────────────────────────────────────

type FilterType = keyof typeof FLAG_META | 'comment' | 'all';

const EvalScreen: React.FC<{ session: ChatSession; onBack: () => void }> = ({ session, onBack }) => {
  const [filter, setFilter] = useState<FilterType>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const items: ReviewItem[] = session.messages.reduce<ReviewItem[]>((acc, msg, idx) => {
    if (msg.role !== 'agent') return acc;
    const hasFlag    = !!msg.flag && msg.flag in FLAG_META;
    const hasComment = !!(msg.comment?.trim());
    if (!hasFlag && !hasComment) return acc;
    let question: ChatMessageRecord | null = null;
    for (let i = idx - 1; i >= 0; i--) {
      if (session.messages[i].role === 'user') { question = session.messages[i]; break; }
    }
    acc.push({ question, answer: msg, flag: hasFlag ? msg.flag as keyof typeof FLAG_META : null, hasComment });
    return acc;
  }, []);

  const counts = {
    all:     items.length,
    pass:    items.filter(i => i.flag === 'pass').length,
    fail:    items.filter(i => i.flag === 'fail').length,
    bug:     items.filter(i => i.flag === 'bug').length,
    slow:    items.filter(i => i.flag === 'slow').length,
    comment: items.filter(i => i.hasComment).length,
  };

  const passRate = counts.all > 0 ? Math.round((counts.pass / counts.all) * 100) : 0;

  const filtered = filter === 'all' ? items
    : filter === 'comment' ? items.filter(i => i.hasComment)
    : items.filter(i => i.flag === filter);

  const doExport = () => {
    const rows = items.map(it => buildEvalExportRow(it, session.title));
    exportJson(`eval-${session.id}-${Date.now()}.json`, rows);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* ── Header ── */}
      <div className="shrink-0" style={{ background: 'white', borderBottom: '1px solid #F0F1F5', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
        <div className="px-6 py-4 flex items-center gap-4">
          <button onClick={onBack} style={iconBtn}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
            <ChevronLeft style={{ width: '16px', height: '16px' }} />
          </button>

          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center"
              style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.2)' }}>
              <BarChart2 style={{ width: '15px', height: '15px', color: '#F97316' }} />
            </div>
            <div>
              <h2 className="text-[15px] font-black leading-tight" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>
                Eval Review
              </h2>
              <p className="text-[11px]" style={{ color: '#94a3b8' }}>{session.title}</p>
            </div>
          </div>

          <div className="ml-auto flex items-center gap-2">
            <button onClick={doExport} style={iconBtn} title="Export MD"
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
              <Download style={{ width: '14px', height: '14px' }} />
            </button>
          </div>
        </div>
      </div>

      {/* ── No items state ── */}
      {counts.all === 0 ? (
        <div className="flex-1 flex items-center justify-center" style={{ background: '#F7F8FB' }}>
          <div className="text-center">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'white', border: '1px solid #EEF0F5', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
              <Flag style={{ width: '28px', height: '28px', color: '#F97316', opacity: 0.4 }} />
            </div>
            <p className="text-[15px] font-bold" style={{ color: '#1e293b' }}>No eval items yet</p>
            <p className="text-[12px] mt-2" style={{ color: '#94a3b8' }}>Flag responses or add comments in Live Chat.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden" style={{ background: '#F7F8FB' }}>

          {/* ── LEFT: Score summary ── */}
          <div className="w-64 shrink-0 flex flex-col overflow-y-auto"
            style={{ background: 'white', borderRight: '1px solid #F0F1F5' }}>

            {/* Pass rate hero */}
            <div className="px-5 py-6" style={{ borderBottom: '1px solid #F0F1F5' }}>
              <p className="text-[9.5px] font-black uppercase tracking-widest mb-3" style={{ color: '#b0b8c4' }}>Pass Rate</p>
              <div className="flex items-end gap-2 mb-3">
                <span className="text-[44px] font-black leading-none"
                  style={{ color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color, letterSpacing: '-0.04em' }}>
                  {passRate}%
                </span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden mb-2" style={{ background: '#F0F1F5' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{
                    width: `${passRate}%`,
                    background: passRate >= 70 ? 'linear-gradient(90deg,#10b981,#34d399)' : passRate >= 40 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#ef4444,#f87171)',
                  }} />
              </div>
              <p className="text-[10.5px] font-semibold"
                style={{ color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color }}>
                {passRate >= 70 ? '✅ Healthy' : passRate >= 40 ? '⚠️ Needs work' : '❌ Critical'}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>{counts.all} responses reviewed</p>
            </div>

            {/* Breakdown */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-[9.5px] font-black uppercase tracking-widest mb-1" style={{ color: '#b0b8c4' }}>Breakdown</p>
              {([
                { key: 'all'     as FilterType, label: 'All',     emoji: '📊', count: counts.all,     color: '#0f172a',           barColor: '#F97316' },
                { key: 'fail'    as FilterType, label: 'Fail',    emoji: '❌', count: counts.fail,    color: FLAG_META.fail.color, barColor: FLAG_META.fail.bar },
                { key: 'bug'     as FilterType, label: 'Bug',     emoji: '🐛', count: counts.bug,     color: FLAG_META.bug.color,  barColor: FLAG_META.bug.bar  },
                { key: 'slow'    as FilterType, label: 'Slow',    emoji: '🐌', count: counts.slow,    color: FLAG_META.slow.color, barColor: FLAG_META.slow.bar },
                { key: 'pass'    as FilterType, label: 'Pass',    emoji: '✅', count: counts.pass,    color: FLAG_META.pass.color, barColor: FLAG_META.pass.bar },
                { key: 'comment' as FilterType, label: 'Notes',   emoji: '💬', count: counts.comment, color: '#ea580c',            barColor: '#F97316'          },
              ] as Array<{ key: FilterType; label: string; emoji: string; count: number; color: string; barColor: string }>)
                .filter(r => r.count > 0)
                .map(row => {
                  const active = filter === row.key;
                  return (
                    <button key={row.key} onClick={() => setFilter(active ? 'all' : row.key)} className="w-full text-left">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px]">{row.emoji}</span>
                        <span className="text-[11px] font-semibold flex-1" style={{ color: active ? row.color : '#374151' }}>{row.label}</span>
                        <span className="text-[11px] font-black" style={{ color: active ? row.color : '#94a3b8' }}>{row.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F0F1F5' }}>
                        <div className="h-full rounded-full transition-all duration-500"
                          style={{
                            width: `${row.key === 'all' ? 100 : (row.count / counts.all) * 100}%`,
                            background: active ? row.barColor : `${row.barColor}55`,
                            boxShadow: active ? `0 0 6px ${row.barColor}88` : 'none',
                          }} />
                      </div>
                    </button>
                  );
                })}
            </div>

            {/* Distribution bar */}
            <div className="px-5 pb-5 mt-auto">
              <p className="text-[9.5px] font-black uppercase tracking-widest mb-2" style={{ color: '#b0b8c4' }}>Distribution</p>
              <div className="flex rounded-full overflow-hidden h-3" style={{ background: '#F0F1F5' }}>
                {counts.fail > 0 && <div style={{ width: `${(counts.fail / counts.all) * 100}%`, background: FLAG_META.fail.bar }} />}
                {counts.bug  > 0 && <div style={{ width: `${(counts.bug  / counts.all) * 100}%`, background: FLAG_META.bug.bar  }} />}
                {counts.slow > 0 && <div style={{ width: `${(counts.slow / counts.all) * 100}%`, background: FLAG_META.slow.bar }} />}
                {counts.pass > 0 && <div style={{ width: `${(counts.pass / counts.all) * 100}%`, background: FLAG_META.pass.bar }} />}
              </div>
            </div>
          </div>

          {/* ── RIGHT: Items list ── */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* List header */}
            <div className="px-6 py-3.5 shrink-0 flex items-center gap-2.5"
              style={{ background: 'white', borderBottom: '1px solid #F0F1F5' }}>
              <span className="text-[12.5px] font-bold" style={{ color: '#0f172a' }}>
                {filter === 'all' ? 'All Items' :
                 filter === 'comment' ? 'Comments' :
                 `${FLAG_META[filter as keyof typeof FLAG_META].emoji} ${FLAG_META[filter as keyof typeof FLAG_META].label}`}
              </span>
              <span className="text-[10.5px] px-2 py-0.5 rounded-full font-bold"
                style={{ background: 'rgba(249,115,22,0.1)', color: '#ea580c' }}>
                {filtered.length}
              </span>
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="ml-auto flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: '#94a3b8' }}>
                  <X style={{ width: '11px', height: '11px' }} /> Clear
                </button>
              )}
            </div>

            {/* Items */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5" style={{ background: '#F7F8FB' }}>
              <AnimatePresence>
                {filtered.map((item, i) => {
                  const rt     = item.answer.metadata?.responseTimeMs;
                  const am     = getAgentMeta(item.answer.metadata?.agentType);
                  const fm     = item.flag ? FLAG_META[item.flag] : null;
                  const isOpen = openId === item.answer.id;

                  return (
                    <motion.div key={item.answer.id}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }} transition={{ delay: i * 0.025 }}
                      className="rounded-2xl overflow-hidden"
                      style={{
                        background: 'white',
                        border: '1px solid #EEF0F5',
                        borderLeft: `4px solid ${fm ? fm.bar : 'rgba(249,115,22,0.45)'}`,
                        boxShadow: isOpen
                          ? '0 6px 24px rgba(0,0,0,0.09), 0 2px 6px rgba(0,0,0,0.05)'
                          : '0 1px 6px rgba(0,0,0,0.05)',
                      }}>

                      {/* Row — tap to expand */}
                      <button onClick={() => setOpenId(isOpen ? null : item.answer.id)}
                        className="w-full text-left px-5 py-4"
                        style={{ background: isOpen ? (fm ? fm.bg : 'rgba(249,115,22,0.03)') : 'transparent' }}>

                        {/* Badges */}
                        <div className="flex items-center gap-2 mb-2.5">
                          <span className="text-[9px] font-black" style={{ color: '#d1d9e0' }}>#{i + 1}</span>
                          {fm
                            ? <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold"
                                style={{ background: fm.bg, border: `1px solid ${fm.border}`, color: fm.color }}>
                                {fm.emoji} {fm.label}
                              </span>
                            : <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold"
                                style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', color: '#c2410c' }}>
                                💬 Note
                              </span>
                          }
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-medium"
                            style={{ background: am.bg, border: `1px solid ${am.border}`, color: am.color }}>
                            {am.emoji} {am.label}
                          </span>
                          {rt && (
                            <span className="text-[9.5px] font-medium flex items-center gap-0.5"
                              style={{ color: rt > 6000 ? FLAG_META.fail.color : rt > 3000 ? FLAG_META.slow.color : '#94a3b8' }}>
                              <Clock style={{ width: '9px', height: '9px' }} />{(rt / 1000).toFixed(1)}s
                            </span>
                          )}
                          <span className="ml-auto text-[9px]" style={{ color: '#b0b8c4' }}>{fmtTime(item.answer.timestamp)}</span>
                          {isOpen
                            ? <ChevronDown style={{ width: '13px', height: '13px', color: '#F97316', flexShrink: 0 }} />
                            : <ChevronRight style={{ width: '13px', height: '13px', color: '#d1d9e0', flexShrink: 0 }} />
                          }
                        </div>

                        {/* Q preview */}
                        {item.question && (
                          <p className="text-[11px] mb-1.5 line-clamp-1" style={{ color: '#94a3b8' }}>
                            <span className="font-black mr-1.5 text-[9.5px] uppercase tracking-wide" style={{ color: '#F97316' }}>Q</span>
                            {item.question.content}
                          </p>
                        )}

                        {/* A preview */}
                        <p className="text-[13.5px] font-medium leading-snug line-clamp-2" style={{ color: '#1e293b' }}>
                          {item.answer.content}
                        </p>

                        {/* Response time bar */}
                        {rt && rt > 0 && (
                          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: '#F0F1F5' }}>
                            <div className="h-full rounded-full"
                              style={{ width: `${Math.min((rt / 10000) * 100, 100)}%`, background: fm?.bar ?? '#F97316', opacity: 0.45 }} />
                          </div>
                        )}
                      </button>

                      {/* Expanded detail */}
                      <AnimatePresence>
                        {isOpen && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                            style={{ overflow: 'hidden' }}>
                            <div className="px-5 pb-5 space-y-3" style={{ borderTop: '1px solid #F0F1F5' }}>
                              {/* Question box */}
                              {item.question && (
                                <div className="mt-3 p-4 rounded-2xl"
                                  style={{ background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.12)' }}>
                                  <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: '#F97316' }}>
                                    User asked
                                  </p>
                                  <p className="text-[13px] leading-relaxed" style={{ color: '#374151' }}>
                                    {item.question.content}
                                  </p>
                                </div>
                              )}

                              {/* Answer box */}
                              <div className="p-4 rounded-2xl"
                                style={{ background: fm ? fm.bg : '#F7F8FB', border: `1px solid ${fm ? fm.border : '#EEF0F5'}` }}>
                                <p className="text-[9px] font-black uppercase tracking-widest mb-2"
                                  style={{ color: fm ? fm.color : '#94a3b8' }}>
                                  Agent response
                                </p>
                                <p className="text-[13px] leading-relaxed" style={{ color: '#1e293b' }}>
                                  {renderText(item.answer.content)}
                                </p>
                                {item.answer.metadata?.buttons && item.answer.metadata.buttons.length > 0 && (
                                  <div className="flex flex-wrap gap-1.5 mt-3 pt-3" style={{ borderTop: `1px solid ${fm ? fm.border : '#EEF0F5'}` }}>
                                    {item.answer.metadata.buttons.map((btn, bi) => (
                                      <span key={bi} className="px-2.5 py-1 rounded-lg text-[10px] font-semibold"
                                        style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', color: '#c2410c' }}>
                                        {btn.title}
                                      </span>
                                    ))}
                                  </div>
                                )}
                              </div>

                              {/* Comment box */}
                              {item.answer.comment && (
                                <div className="px-4 py-3 rounded-xl flex items-start gap-2"
                                  style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.16)', color: '#c2410c' }}>
                                  <span>💬</span>
                                  <span className="text-[12.5px] leading-relaxed">{item.answer.comment}</span>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Global Eval Screen ───────────────────────────────────────────────────────

const GlobalEvalScreen: React.FC<{
  sessions: Omit<ChatSession, 'messages'>[];
  onBack: () => void;
}> = ({ sessions, onBack }) => {
  const [items, setItems]               = useState<GlobalReviewItem[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [loadProgress, setLoadProgress] = useState('');
  const [filter, setFilter]             = useState<FilterType>('all');
  const [openId, setOpenId]             = useState<string | null>(null);

  useEffect(() => {
    const sessionsWithFlags = sessions.filter(
      s => s.flags.pass + s.flags.fail + s.flags.bug + s.flags.slow > 0
    );
    if (sessionsWithFlags.length === 0) { setIsLoading(false); return; }

    let cancelled = false;
    const allItems: GlobalReviewItem[] = [];

    const loadAll = async () => {
      for (let i = 0; i < sessionsWithFlags.length; i++) {
        if (cancelled) return;
        const s = sessionsWithFlags[i];
        setLoadProgress(`${i + 1} / ${sessionsWithFlags.length}`);
        try {
          const session = await apiLoadSession(s.id);
          if (!session) continue;
          session.messages.forEach((msg, idx) => {
            if (msg.role !== 'agent') return;
            const hasFlag    = !!msg.flag && msg.flag in FLAG_META;
            const hasComment = !!(msg.comment?.trim());
            if (!hasFlag && !hasComment) return;
            let question: ChatMessageRecord | null = null;
            for (let j = idx - 1; j >= 0; j--) {
              if (session.messages[j].role === 'user') { question = session.messages[j]; break; }
            }
            allItems.push({ question, answer: msg,
              flag: hasFlag ? msg.flag as keyof typeof FLAG_META : null,
              hasComment, sessionId: s.id, sessionTitle: s.title,
            });
          });
        } catch { /* skip failed sessions */ }
      }
      if (!cancelled) {
        const order: Record<string, number> = { fail: 0, bug: 1, slow: 2, pass: 3 };
        allItems.sort((a, b) => (order[a.flag ?? ''] ?? 4) - (order[b.flag ?? ''] ?? 4));
        setItems(allItems);
        setIsLoading(false);
      }
    };
    loadAll();
    return () => { cancelled = true; };
  }, [sessions]);

  const counts = {
    all:     items.length,
    pass:    items.filter(i => i.flag === 'pass').length,
    fail:    items.filter(i => i.flag === 'fail').length,
    bug:     items.filter(i => i.flag === 'bug').length,
    slow:    items.filter(i => i.flag === 'slow').length,
    comment: items.filter(i => i.hasComment).length,
  };
  const passRate = counts.all > 0 ? Math.round((counts.pass / counts.all) * 100) : 0;
  const filtered = filter === 'all' ? items
    : filter === 'comment' ? items.filter(i => i.hasComment)
    : items.filter(i => i.flag === filter);

  const doExport = () => {
    const rows = items.map(it => buildEvalExportRow(it, it.sessionTitle));
    exportJson(`global-eval-${Date.now()}.json`, rows);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0" style={{ background: 'white', borderBottom: '1px solid #F0F1F5', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
        <div className="px-6 py-4 flex items-center gap-4">
          <button onClick={onBack} style={iconBtn}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
            <ChevronLeft style={{ width: '16px', height: '16px' }} />
          </button>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg,rgba(249,115,22,0.15),rgba(249,115,22,0.06))', border: '1px solid rgba(249,115,22,0.22)' }}>
              <BarChart2 style={{ width: '16px', height: '16px', color: '#F97316' }} />
            </div>
            <div>
              <h2 className="text-[15px] font-black leading-tight" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>
                All Eval History
              </h2>
              <p className="text-[11px]" style={{ color: '#94a3b8' }}>
                Flags &amp; comments across all sessions
              </p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {!isLoading && (
              <button onClick={doExport} style={iconBtn} title="Export MD"
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
                onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
                <Download style={{ width: '14px', height: '14px' }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Loading */}
      {isLoading ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ background: '#F7F8FB' }}>
          <div className="relative w-16 h-16">
            <div className="absolute inset-0 rounded-2xl flex items-center justify-center"
              style={{ background: 'white', border: '1px solid #EEF0F5', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
              <Loader2 style={{ width: '22px', height: '22px', color: '#F97316' }} className="animate-spin" />
            </div>
          </div>
          <div className="text-center">
            <p className="text-[14px] font-bold" style={{ color: '#0f172a' }}>Loading eval history…</p>
            <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>{loadProgress}</p>
          </div>
        </div>
      ) : counts.all === 0 ? (
        <div className="flex-1 flex items-center justify-center" style={{ background: '#F7F8FB' }}>
          <div className="text-center">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'white', border: '1px solid #EEF0F5', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
              <Flag style={{ width: '28px', height: '28px', color: '#F97316', opacity: 0.4 }} />
            </div>
            <p className="text-[15px] font-bold" style={{ color: '#1e293b' }}>No eval items yet</p>
            <p className="text-[12px] mt-2" style={{ color: '#94a3b8' }}>Flag responses or add comments in Live Chat.</p>
          </div>
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden" style={{ background: '#F7F8FB' }}>

          {/* LEFT: Summary panel */}
          <div className="w-64 shrink-0 flex flex-col overflow-y-auto"
            style={{ background: 'white', borderRight: '1px solid #F0F1F5' }}>

            {/* Pass rate hero */}
            <div className="px-5 py-6" style={{ borderBottom: '1px solid #F0F1F5' }}>
              <p className="text-[9.5px] font-black uppercase tracking-widest mb-3" style={{ color: '#b0b8c4' }}>Overall Pass Rate</p>
              <div className="flex items-end gap-2 mb-3">
                <span className="text-[44px] font-black leading-none"
                  style={{ color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color, letterSpacing: '-0.04em' }}>
                  {passRate}%
                </span>
              </div>
              <div className="h-2.5 rounded-full overflow-hidden mb-2" style={{ background: '#F0F1F5' }}>
                <div className="h-full rounded-full transition-all duration-700" style={{
                  width: `${passRate}%`,
                  background: passRate >= 70 ? 'linear-gradient(90deg,#10b981,#34d399)' : passRate >= 40 ? 'linear-gradient(90deg,#f59e0b,#fbbf24)' : 'linear-gradient(90deg,#ef4444,#f87171)',
                }} />
              </div>
              <p className="text-[10.5px] font-semibold"
                style={{ color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color }}>
                {passRate >= 70 ? '✅ Healthy' : passRate >= 40 ? '⚠️ Needs work' : '❌ Critical'}
              </p>
              <p className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
                {counts.all} responses · {sessions.filter(s => s.flags.pass + s.flags.fail + s.flags.bug + s.flags.slow > 0).length} sessions
              </p>
            </div>

            {/* Breakdown filters */}
            <div className="px-5 py-4 space-y-3">
              <p className="text-[9.5px] font-black uppercase tracking-widest mb-1" style={{ color: '#b0b8c4' }}>Breakdown</p>
              {([
                { key: 'all'     as FilterType, label: 'All',   emoji: '📊', count: counts.all,     color: '#0f172a',           barColor: '#F97316' },
                { key: 'fail'    as FilterType, label: 'Fail',  emoji: '❌', count: counts.fail,    color: FLAG_META.fail.color, barColor: FLAG_META.fail.bar },
                { key: 'bug'     as FilterType, label: 'Bug',   emoji: '🐛', count: counts.bug,     color: FLAG_META.bug.color,  barColor: FLAG_META.bug.bar  },
                { key: 'slow'    as FilterType, label: 'Slow',  emoji: '🐌', count: counts.slow,    color: FLAG_META.slow.color, barColor: FLAG_META.slow.bar },
                { key: 'pass'    as FilterType, label: 'Pass',  emoji: '✅', count: counts.pass,    color: FLAG_META.pass.color, barColor: FLAG_META.pass.bar },
                { key: 'comment' as FilterType, label: 'Notes', emoji: '💬', count: counts.comment, color: '#ea580c',            barColor: '#F97316'          },
              ] as Array<{ key: FilterType; label: string; emoji: string; count: number; color: string; barColor: string }>)
                .filter(r => r.count > 0)
                .map(row => {
                  const active = filter === row.key;
                  return (
                    <button key={row.key} onClick={() => setFilter(active ? 'all' : row.key)} className="w-full text-left">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[11px]">{row.emoji}</span>
                        <span className="text-[11px] font-semibold flex-1" style={{ color: active ? row.color : '#374151' }}>{row.label}</span>
                        <span className="text-[11px] font-black" style={{ color: active ? row.color : '#94a3b8' }}>{row.count}</span>
                      </div>
                      <div className="h-1.5 rounded-full overflow-hidden" style={{ background: '#F0F1F5' }}>
                        <div className="h-full rounded-full transition-all duration-500" style={{
                          width: `${row.key === 'all' ? 100 : (row.count / counts.all) * 100}%`,
                          background: active ? row.barColor : `${row.barColor}55`,
                          boxShadow: active ? `0 0 6px ${row.barColor}88` : 'none',
                        }} />
                      </div>
                    </button>
                  );
                })}
            </div>

            {/* Distribution bar */}
            <div className="px-5 pb-5 mt-auto">
              <p className="text-[9.5px] font-black uppercase tracking-widest mb-2" style={{ color: '#b0b8c4' }}>Distribution</p>
              <div className="flex rounded-full overflow-hidden h-3" style={{ background: '#F0F1F5' }}>
                {counts.fail > 0 && <div style={{ width: `${(counts.fail / counts.all) * 100}%`, background: FLAG_META.fail.bar }} />}
                {counts.bug  > 0 && <div style={{ width: `${(counts.bug  / counts.all) * 100}%`, background: FLAG_META.bug.bar  }} />}
                {counts.slow > 0 && <div style={{ width: `${(counts.slow / counts.all) * 100}%`, background: FLAG_META.slow.bar }} />}
                {counts.pass > 0 && <div style={{ width: `${(counts.pass / counts.all) * 100}%`, background: FLAG_META.pass.bar }} />}
              </div>
            </div>
          </div>

          {/* RIGHT: Items list */}
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="px-6 py-3.5 shrink-0 flex items-center gap-2.5"
              style={{ background: 'white', borderBottom: '1px solid #F0F1F5' }}>
              <span className="text-[12.5px] font-bold" style={{ color: '#0f172a' }}>
                {filter === 'all' ? 'All Items' : filter === 'comment' ? 'Comments' : `${FLAG_META[filter as keyof typeof FLAG_META].emoji} ${FLAG_META[filter as keyof typeof FLAG_META].label}`}
              </span>
              <span className="text-[10.5px] px-2 py-0.5 rounded-full font-bold"
                style={{ background: 'rgba(249,115,22,0.1)', color: '#ea580c' }}>
                {filtered.length}
              </span>
              {filter !== 'all' && (
                <button onClick={() => setFilter('all')} className="ml-auto flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: '#94a3b8' }}>
                  <X style={{ width: '11px', height: '11px' }} /> Clear
                </button>
              )}
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5" style={{ background: '#F7F8FB' }}>
              <AnimatePresence>
                {filtered.map((item, i) => {
                  const rt     = item.answer.metadata?.responseTimeMs;
                  const am     = getAgentMeta(item.answer.metadata?.agentType);
                  const fm     = item.flag ? FLAG_META[item.flag] : null;
                  const isOpen = openId === item.answer.id;

                  return (
                    <motion.div key={`${item.sessionId}-${item.answer.id}`}
                      initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }} transition={{ delay: i * 0.02 }}
                      className="rounded-2xl overflow-hidden"
                      style={{
                        background: 'white',
                        border: '1px solid #EEF0F5',
                        borderLeft: `4px solid ${fm ? fm.bar : 'rgba(249,115,22,0.45)'}`,
                        boxShadow: isOpen ? '0 6px 24px rgba(0,0,0,0.09)' : '0 1px 6px rgba(0,0,0,0.05)',
                      }}>

                      <button onClick={() => setOpenId(isOpen ? null : item.answer.id)}
                        className="w-full text-left px-5 py-4"
                        style={{ background: isOpen ? (fm ? fm.bg : 'rgba(249,115,22,0.03)') : 'transparent' }}>

                        {/* Badges row */}
                        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
                          <span className="text-[9px] font-black" style={{ color: '#d1d9e0' }}>#{i + 1}</span>
                          {fm
                            ? <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold"
                                style={{ background: fm.bg, border: `1px solid ${fm.border}`, color: fm.color }}>
                                {fm.emoji} {fm.label}
                              </span>
                            : <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold"
                                style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', color: '#c2410c' }}>
                                💬 Note
                              </span>
                          }
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-medium"
                            style={{ background: am.bg, border: `1px solid ${am.border}`, color: am.color }}>
                            {am.emoji} {am.label}
                          </span>
                          {/* Session name badge */}
                          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-semibold max-w-[130px] truncate"
                            style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)', color: '#ea580c' }}
                            title={item.sessionTitle}>
                            📁 {item.sessionTitle}
                          </span>
                          {rt && (
                            <span className="text-[9.5px] font-medium flex items-center gap-0.5"
                              style={{ color: rt > 6000 ? FLAG_META.fail.color : rt > 3000 ? FLAG_META.slow.color : '#94a3b8' }}>
                              <Clock style={{ width: '9px', height: '9px' }} />{(rt / 1000).toFixed(1)}s
                            </span>
                          )}
                          <span className="ml-auto text-[9px]" style={{ color: '#b0b8c4' }}>{fmtTime(item.answer.timestamp)}</span>
                          {isOpen
                            ? <ChevronDown style={{ width: '13px', height: '13px', color: '#F97316', flexShrink: 0 }} />
                            : <ChevronRight style={{ width: '13px', height: '13px', color: '#d1d9e0', flexShrink: 0 }} />
                          }
                        </div>

                        {item.question && (
                          <p className="text-[11px] mb-1.5 line-clamp-1" style={{ color: '#94a3b8' }}>
                            <span className="font-black mr-1.5 text-[9.5px] uppercase tracking-wide" style={{ color: '#F97316' }}>Q</span>
                            {item.question.content}
                          </p>
                        )}
                        <p className="text-[13.5px] font-medium leading-snug line-clamp-2" style={{ color: '#1e293b' }}>
                          {item.answer.content}
                        </p>

                        {rt && rt > 0 && (
                          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: '#F0F1F5' }}>
                            <div className="h-full rounded-full"
                              style={{ width: `${Math.min((rt / 10000) * 100, 100)}%`, background: fm?.bar ?? '#F97316', opacity: 0.45 }} />
                          </div>
                        )}
                      </button>

                      {/* Accordion expand */}
                      <AnimatePresence>
                        {isOpen && (
                          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                            style={{ overflow: 'hidden' }}>
                            <div className="px-5 pb-5 space-y-3" style={{ borderTop: '1px solid #F0F1F5' }}>
                              {item.question && (
                                <div className="mt-3 p-4 rounded-2xl"
                                  style={{ background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.12)' }}>
                                  <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: '#F97316' }}>User asked</p>
                                  <p className="text-[13px] leading-relaxed" style={{ color: '#374151' }}>{item.question.content}</p>
                                </div>
                              )}
                              <div className="p-4 rounded-2xl"
                                style={{ background: fm ? fm.bg : '#F7F8FB', border: `1px solid ${fm ? fm.border : '#EEF0F5'}` }}>
                                <p className="text-[9px] font-black uppercase tracking-widest mb-2"
                                  style={{ color: fm ? fm.color : '#94a3b8' }}>Agent response</p>
                                <p className="text-[13px] leading-relaxed" style={{ color: '#1e293b' }}>
                                  {renderText(item.answer.content)}
                                </p>
                              </div>
                              {item.answer.comment && (
                                <div className="px-4 py-3 rounded-xl flex items-start gap-2"
                                  style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.16)', color: '#c2410c' }}>
                                  <span>💬</span>
                                  <span className="text-[12.5px] leading-relaxed">{item.answer.comment}</span>
                                </div>
                              )}
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// ─── Session View (Transcript) ────────────────────────────────────────────────

const SessionView: React.FC<{
  session: ChatSession;
  onBack: () => void;
  onDelete: () => void;
  onCompare: () => void;
  onEvalReview: () => void;
  isComparing: boolean;
  compareProgress: string;
}> = ({ session, onBack, onDelete, onCompare, onEvalReview, isComparing, compareProgress }) => {

  const evalCount = session.messages.filter(
    m => m.role === 'agent' && ((m.flag && m.flag in FLAG_META) || m.comment?.trim())
  ).length;

  const doExport = () => {
    let md = `# ${session.title}\n${fmtDate(session.createdAt)} · +${session.from}\n\n`;
    if (session.summary) md += `## Notes\n${session.summary}\n\n`;
    md += `## Transcript\n\n`;
    session.messages.forEach(m => {
      if (m.role === 'user') md += `**You${m.isButtonTap ? ' (tap)' : ''}:** ${m.content}\n\n`;
      else {
        md += `**Agent (${m.metadata?.agentType ?? '?'}):** ${m.content}\n`;
        if (m.metadata?.responseTimeMs) md += `> ${(m.metadata.responseTimeMs / 1000).toFixed(2)}s\n`;
        if (m.comment) md += `> 💬 ${m.comment}\n`;
        if (m.flag) md += `> ${FLAG_META[m.flag as keyof typeof FLAG_META]?.emoji} ${m.flag}\n`;
        md += '\n';
      }
    });
    exportMd(`session-${session.id}.md`, md);
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0"
        style={{ background: 'white', borderBottom: '1px solid #F0F1F5', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
        <div className="px-6 py-4 flex items-center gap-3">
          {/* Back */}
          <button onClick={onBack} style={iconBtn}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
            <ChevronLeft style={{ width: '16px', height: '16px' }} />
          </button>

          {/* Title */}
          <div className="flex-1 min-w-0">
            <h2 className="text-[16px] font-black leading-tight line-clamp-1"
              style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>
              {session.title}
            </h2>
            <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>
              {fmtDate(session.createdAt)} · {session.totalMessages} messages
            </p>
          </div>

          {/* ── Eval Review CTA button ── */}
          <button
            onClick={onEvalReview}
            className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-[12px] transition-all"
            style={{
              background: evalCount > 0
                ? 'linear-gradient(135deg, #F97316 0%, #fb923c 100%)'
                : '#F7F8FB',
              color: evalCount > 0 ? '#fff' : '#64748b',
              border: evalCount > 0 ? '1.5px solid rgba(249,115,22,0.3)' : '1px solid #EEF0F5',
              boxShadow: evalCount > 0 ? '0 3px 14px rgba(249,115,22,0.35)' : '0 1px 3px rgba(0,0,0,0.06)',
            }}
            onMouseEnter={e => {
              if (evalCount > 0) (e.currentTarget as HTMLElement).style.boxShadow = '0 5px 20px rgba(249,115,22,0.45)';
              else (e.currentTarget as HTMLElement).style.background = '#FFF7ED';
            }}
            onMouseLeave={e => {
              if (evalCount > 0) (e.currentTarget as HTMLElement).style.boxShadow = '0 3px 14px rgba(249,115,22,0.35)';
              else (e.currentTarget as HTMLElement).style.background = '#F7F8FB';
            }}
          >
            <BarChart2 style={{ width: '14px', height: '14px' }} />
            Eval Review
            {evalCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.5 rounded-full text-[9.5px] font-black"
                style={{ background: 'rgba(255,255,255,0.25)', color: '#fff' }}>
                {evalCount}
              </span>
            )}
          </button>

          {/* Secondary actions */}
          <button onClick={onCompare} disabled={isComparing}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-semibold"
            style={{ background: 'rgba(249,115,22,0.07)', border: '1px solid rgba(249,115,22,0.2)', color: '#ea580c', cursor: isComparing ? 'not-allowed' : 'pointer', opacity: isComparing ? 0.6 : 1 }}
            onMouseEnter={e => { if (!isComparing) (e.currentTarget as HTMLElement).style.background = 'rgba(249,115,22,0.13)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(249,115,22,0.07)'; }}>
            {isComparing
              ? <><Loader2 style={{ width: '13px', height: '13px' }} className="animate-spin" />{compareProgress || 'Running…'}</>
              : <><GitCompare style={{ width: '13px', height: '13px' }} />Compare</>
            }
          </button>

          <button onClick={doExport} style={iconBtn} title="Export"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
            <Download style={{ width: '14px', height: '14px' }} />
          </button>

          <button onClick={onDelete} style={iconBtn} title="Delete"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = 'rgba(220,38,38,0.05)'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(220,38,38,0.2)'; (e.currentTarget as HTMLElement).style.color = '#dc2626'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; (e.currentTarget as HTMLElement).style.color = '#64748b'; }}>
            <Trash2 style={{ width: '14px', height: '14px' }} />
          </button>
        </div>
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto py-6 space-y-4" style={{ background: '#F7F8FB', paddingLeft: '0', paddingRight: '0' }}>
        <div className="max-w-2xl mx-auto px-6 space-y-4">
          {session.summary && (
            <div className="p-4 rounded-2xl"
              style={{ background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.15)' }}>
              <p className="text-[9.5px] font-bold uppercase tracking-widest mb-1.5" style={{ color: '#ea580c' }}>📝 Notes</p>
              <p className="text-[13px] leading-relaxed" style={{ color: '#78350f' }}>{session.summary}</p>
            </div>
          )}
          {session.messages.map(msg => <MsgBubble key={msg.id} msg={msg} />)}
        </div>
      </div>
    </div>
  );
};

// ─── Compare View ─────────────────────────────────────────────────────────────

// ─── Status meta for Compare ──────────────────────────────────────────────────
const STATUS_META = {
  match:     { label: 'Match',     color: '#059669', bg: 'rgba(5,150,105,0.09)',   border: 'rgba(5,150,105,0.22)',  bar: '#10b981', accent: '#34d399', emoji: '✅' },
  changed:   { label: 'Changed',   color: '#d97706', bg: 'rgba(217,119,6,0.09)',   border: 'rgba(217,119,6,0.22)',  bar: '#f59e0b', accent: '#fbbf24', emoji: '⚠️' },
  different: { label: 'Different', color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.2)',   bar: '#ef4444', accent: '#f87171', emoji: '❌' },
  error:     { label: 'Error',     color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)',  bar: '#8b5cf6', accent: '#a78bfa', emoji: '🔴' },
} as const;

/** Render inline diff tokens with colour highlights */
function DiffText({ tokens }: { tokens: { text: string; type: 'same' | 'added' | 'removed' }[] }) {
  return (
    <>
      {tokens.map((tok, i) => {
        if (tok.type === 'same')    return <span key={i}>{tok.text}</span>;
        if (tok.type === 'added')   return <mark key={i} style={{ background: 'rgba(5,150,105,0.18)', color: '#065f46', borderRadius: '3px', padding: '0 1px' }}>{tok.text}</mark>;
        if (tok.type === 'removed') return <del key={i}  style={{ background: 'rgba(220,38,38,0.12)',  color: '#991b1b', borderRadius: '3px', padding: '0 1px', textDecoration: 'line-through' }}>{tok.text}</del>;
        return <span key={i}>{tok.text}</span>;
      })}
    </>
  );
}

const CompareView: React.FC<{ result: CompareResult; onClose: () => void }> = ({ result, onClose }) => {
  const [activeFilter, setActiveFilter] = useState<'all' | CompareEntry['status']>('all');
  const [showDiff, setShowDiff]         = useState(true);

  const entries = result.entries;
  const total   = entries.length;
  const avg     = total ? Math.round(entries.reduce((a, e) => a + e.similarity, 0) / total) : 0;

  const counts = {
    match:     entries.filter(e => e.status === 'match').length,
    changed:   entries.filter(e => e.status === 'changed').length,
    different: entries.filter(e => e.status === 'different').length,
    error:     entries.filter(e => e.status === 'error').length,
  };

  const visible = activeFilter === 'all' ? entries : entries.filter(e => e.status === activeFilter);

  const avgMeta = avg >= 80 ? STATUS_META.match : avg >= 50 ? STATUS_META.changed : STATUS_META.different;

  const doExport = () => {
    const rows = entries.map((e, i) => ({
      Turn:        i + 1,
      Question:    e.userMessage,
      Before:      e.oldResponse,
      Now:         e.newResponse,
      Similarity:  `${e.similarity}%`,
      Status:      STATUS_META[e.status].label,
      OldAgent:    e.oldAgent ?? '',
      NewAgent:    e.newAgent ?? '',
      OldTime:     e.oldTimeMs ? `${(e.oldTimeMs / 1000).toFixed(2)}s` : '',
      NewTime:     e.newTimeMs ? `${(e.newTimeMs / 1000).toFixed(2)}s` : '',
      Session:     result.sessionTitle,
      RunAt:       result.runAt,
    }));
    exportJson(`compare-${result.sessionId}-${Date.now()}.json`, rows);
  };

  type FilterTab = { id: 'all' | CompareEntry['status']; label: string; count: number; color: string };
  const filterTabs: FilterTab[] = ([
    { id: 'all'       as const, label: 'All',       count: total,            color: '#64748b'              },
    { id: 'match'     as const, label: 'Match',     count: counts.match,     color: STATUS_META.match.color },
    { id: 'changed'   as const, label: 'Changed',   count: counts.changed,   color: STATUS_META.changed.color },
    { id: 'different' as const, label: 'Different', count: counts.different, color: STATUS_META.different.color },
    { id: 'error'     as const, label: 'Errors',    count: counts.error,     color: STATUS_META.error.color },
  ] as FilterTab[]).filter((t): t is FilterTab => t.id === 'all' || t.count > 0);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Header ── */}
      <div className="px-6 py-4 shrink-0"
        style={{ background: 'white', borderBottom: '1px solid #F0F1F5', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onClose} style={iconBtn}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; }}
            onMouseLeave={e  => { (e.currentTarget as HTMLElement).style.background = '#fff'; }}>
            <ChevronLeft style={{ width: '15px', height: '15px' }} />
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <ArrowLeftRight style={{ width: '14px', height: '14px', color: '#F97316' }} />
              <span className="text-[14px] font-bold" style={{ color: '#0f172a', letterSpacing: '-0.01em' }}>
                Compare Report
              </span>
            </div>
            <p className="text-[10.5px] mt-0.5 truncate" style={{ color: '#94a3b8' }}>{result.sessionTitle}</p>
          </div>

          {/* Avg badge */}
          <div className="px-3.5 py-2 rounded-xl flex items-center gap-1.5 shrink-0"
            style={{ background: avgMeta.bg, border: `1.5px solid ${avgMeta.border}` }}>
            <Zap style={{ width: '12px', height: '12px', color: avgMeta.color }} />
            <span className="text-[13px] font-black" style={{ color: avgMeta.color }}>{avg}% avg</span>
          </div>

          {/* Diff toggle */}
          <button
            onClick={() => setShowDiff(p => !p)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
            style={{
              background: showDiff ? 'rgba(5,150,105,0.1)' : '#F7F8FB',
              border: showDiff ? '1px solid rgba(5,150,105,0.25)' : '1px solid #EEF0F5',
              color: showDiff ? '#059669' : '#94a3b8',
            }}>
            <GitCompare style={{ width: '12px', height: '12px' }} />
            Diff
          </button>

          {/* Export JSON */}
          <button onClick={doExport} style={iconBtn} title="Export JSON"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; }}
            onMouseLeave={e  => { (e.currentTarget as HTMLElement).style.background = '#fff'; }}>
            <Download style={{ width: '14px', height: '14px' }} />
          </button>
        </div>

        {/* ── Summary bar ── */}
        <div className="grid grid-cols-4 gap-3 mb-4">
          {(Object.entries(counts) as [keyof typeof counts, number][]).map(([k, v]) => {
            const sm = STATUS_META[k];
            return (
              <div key={k} className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl"
                style={{ background: sm.bg, border: `1px solid ${sm.border}` }}>
                <span className="text-[18px] leading-none">{sm.emoji}</span>
                <div>
                  <div className="text-[16px] font-black leading-tight" style={{ color: sm.color }}>{v}</div>
                  <div className="text-[9px] font-bold uppercase tracking-wide" style={{ color: sm.color, opacity: 0.75 }}>{sm.label}</div>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Progress bar visualisation ── */}
        {total > 0 && (
          <div className="flex rounded-full overflow-hidden h-2 mb-4" style={{ background: '#F0F1F5' }}>
            {(Object.entries(counts) as [keyof typeof counts, number][])
              .filter(([, v]) => v > 0)
              .map(([k, v]) => (
                <div key={k} style={{ width: `${(v / total) * 100}%`, background: STATUS_META[k].bar, transition: 'width 0.5s' }} />
              ))}
          </div>
        )}

        {/* ── Filter tabs ── */}
        <div className="flex gap-2 flex-wrap">
          {filterTabs.map(tab => {
            const active = activeFilter === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveFilter(tab.id)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11.5px] font-semibold transition-all"
                style={{
                  background: active ? tab.color : '#F7F8FB',
                  color:      active ? '#fff'    : tab.color,
                  border:     active ? `1px solid ${tab.color}` : '1px solid #EEF0F5',
                }}>
                {tab.label}
                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black"
                  style={{ background: active ? 'rgba(255,255,255,0.25)' : 'rgba(0,0,0,0.07)' }}>
                  {tab.count}
                </span>
              </button>
            );
          })}
          <div className="ml-auto text-[10px] flex items-center" style={{ color: '#94a3b8' }}>
            {fmtDate(result.runAt, true)} · {total} turn{total !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* ── Entry cards ── */}
      <div className="flex-1 overflow-y-auto p-5 space-y-4" style={{ background: '#F7F8FB' }}>
        <AnimatePresence mode="popLayout">
          {visible.length === 0 && (
            <motion.div key="empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex flex-col items-center justify-center py-16 gap-3">
              <CheckCircle style={{ width: '36px', height: '36px', color: '#d1fae5' }} />
              <p className="text-[13px]" style={{ color: '#94a3b8' }}>No entries in this category</p>
            </motion.div>
          )}

          {visible.map((entry, i) => {
            const sm   = STATUS_META[entry.status];
            const diff = showDiff ? wordDiff(entry.oldResponse, entry.newResponse) : null;

            return (
              <motion.div key={`${entry.userMessage}-${i}`}
                layout
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.97 }}
                transition={{ delay: i * 0.025, type: 'spring', stiffness: 340, damping: 30 }}
                className="rounded-2xl overflow-hidden"
                style={{
                  background: 'white',
                  border: '1px solid #EEF0F5',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.06)',
                  borderLeft: `3.5px solid ${sm.bar}`,
                }}>

                {/* Turn header */}
                <div className="flex items-center gap-3 px-5 py-3 border-b"
                  style={{ background: `${sm.bg}`, borderColor: sm.border }}>
                  <div className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 text-[10px]"
                    style={{ background: sm.bg, border: `1px solid ${sm.border}` }}>
                    <User style={{ width: '10px', height: '10px', color: sm.color }} />
                  </div>
                  <span className="flex-1 text-[12.5px] font-medium" style={{ color: '#374151' }}>
                    {entry.isButtonTap && (
                      <span className="text-[9px] font-bold mr-1.5 px-1.5 py-0.5 rounded"
                        style={{ background: 'rgba(249,115,22,0.12)', color: '#ea580c' }}>TAP</span>
                    )}
                    {entry.userMessage}
                  </span>

                  {/* Similarity badge */}
                  <span className="flex items-center gap-1 text-[11px] font-black px-2.5 py-1 rounded-lg shrink-0"
                    style={{ background: sm.bg, border: `1px solid ${sm.border}`, color: sm.color }}>
                    <span>{sm.emoji}</span>
                    <span>{entry.similarity}%</span>
                  </span>
                </div>

                {/* Before / Now columns */}
                <div className="grid grid-cols-2">
                  {/* Before column */}
                  <div className="p-4" style={{ borderRight: '1px solid #F0F1F5' }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#b0b8c4' }}>Before</span>
                      {entry.oldAgent && (() => {
                        const am = getAgentMeta(entry.oldAgent);
                        return (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium"
                            style={{ background: am.bg, border: `1px solid ${am.border}`, color: am.color }}>
                            {am.emoji} {am.label}
                          </span>
                        );
                      })()}
                      {entry.oldTimeMs !== undefined && (
                        <span className="ml-auto flex items-center gap-0.5 text-[9px]" style={{ color: '#94a3b8' }}>
                          <Clock style={{ width: '9px', height: '9px' }} />{(entry.oldTimeMs / 1000).toFixed(1)}s
                        </span>
                      )}
                    </div>
                    <div className="p-3.5 rounded-xl text-[12px] leading-relaxed"
                      style={{ background: '#FAFAFA', border: '1px solid #F0F1F5', color: '#374151', whiteSpace: 'pre-wrap' }}>
                      {showDiff && diff
                        ? <DiffText tokens={diff.map(t => ({ text: t.text, type: t.type === 'added' ? 'same' : t.type === 'removed' ? 'removed' : 'same' }))} />
                        : renderText(entry.oldResponse)}
                    </div>
                  </div>

                  {/* Now column */}
                  <div className="p-4" style={{ background: entry.status === 'error' ? 'rgba(220,38,38,0.018)' : 'rgba(249,115,22,0.025)' }}>
                    <div className="flex items-center gap-2 mb-2.5">
                      <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#F97316' }}>Now</span>
                      <div className="w-1.5 h-1.5 rounded-full" style={{ background: '#F97316' }} />
                      {entry.newAgent && (() => {
                        const am = getAgentMeta(entry.newAgent);
                        return (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[9px] font-medium"
                            style={{ background: am.bg, border: `1px solid ${am.border}`, color: am.color }}>
                            {am.emoji} {am.label}
                          </span>
                        );
                      })()}
                      {entry.newTimeMs !== undefined && (
                        <span className="ml-auto flex items-center gap-0.5 text-[9px]" style={{ color: '#94a3b8' }}>
                          <Clock style={{ width: '9px', height: '9px' }} />{(entry.newTimeMs / 1000).toFixed(1)}s
                          {entry.oldTimeMs !== undefined && entry.newTimeMs > entry.oldTimeMs * 1.3 && (
                            <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-bold"
                              style={{ background: 'rgba(220,38,38,0.1)', color: '#dc2626' }}>↑ slower</span>
                          )}
                          {entry.oldTimeMs !== undefined && entry.newTimeMs < entry.oldTimeMs * 0.8 && (
                            <span className="ml-1 px-1 py-0.5 rounded text-[8px] font-bold"
                              style={{ background: 'rgba(5,150,105,0.1)', color: '#059669' }}>↓ faster</span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="p-3.5 rounded-xl text-[12px] leading-relaxed"
                      style={{
                        background: entry.status === 'error' ? 'rgba(220,38,38,0.05)' : 'rgba(249,115,22,0.04)',
                        border: entry.status === 'error' ? '1px solid rgba(220,38,38,0.2)' : '1px solid rgba(249,115,22,0.15)',
                        color: '#374151', whiteSpace: 'pre-wrap',
                      }}>
                      {showDiff && diff
                        ? <DiffText tokens={diff.map(t => ({ text: t.text, type: t.type === 'removed' ? 'same' : t.type }))} />
                        : renderText(entry.newResponse)}
                    </div>
                  </div>
                </div>

                {/* Similarity progress bar at bottom of card */}
                <div className="px-5 py-2.5 flex items-center gap-3 border-t" style={{ borderColor: '#F0F1F5', background: '#FAFBFC' }}>
                  <span className="text-[9px] font-bold uppercase tracking-widest" style={{ color: '#c1c9d4' }}>Similarity</span>
                  <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: '#EEF0F5' }}>
                    <div className="h-full rounded-full transition-all duration-700"
                      style={{ width: `${entry.similarity}%`, background: sm.bar }} />
                  </div>
                  <span className="text-[10px] font-black shrink-0" style={{ color: sm.color }}>{entry.similarity}%</span>
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
};

// ─── Main ─────────────────────────────────────────────────────────────────────

type Screen = 'list' | 'session' | 'eval' | 'compare' | 'globalEval';

const ChatHistoryView: React.FC = () => {
  const [screen, setScreen]                   = useState<Screen>('list');
  const [sessions, setSessions]               = useState<Omit<ChatSession, 'messages'>[]>([]);
  const [selectedSession, setSelectedSession] = useState<ChatSession | null>(null);
  const [compareResult, setCompareResult]     = useState<CompareResult | null>(null);
  const [isLoading, setIsLoading]             = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isComparing, setIsComparing]         = useState(false);
  const [compareProgress, setCompareProgress] = useState('');
  const [error, setError]                     = useState<string | null>(null);
  const [search, setSearch]                   = useState('');

  // ── Import state ───────────────────────────────────────────────────────────
  const [showImport, setShowImport]           = useState(false);
  const [importDrag, setImportDrag]           = useState(false);
  const [importPreview, setImportPreview]     = useState<ChatSession[] | null>(null);
  const [importError, setImportError]         = useState<string | null>(null);
  const [importToast, setImportToast]         = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);
  const importFileRef                         = React.useRef<HTMLInputElement>(null);

  const loadSessions = useCallback(async () => {
    setIsLoading(true); setError(null);
    try {
      // apiLoadSessions returns already sorted (server sorts by updatedAt desc)
      const sessions = await apiLoadSessions();
      setSessions(sessions);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to connect to server — make sure the self-eval server is running (npm start in src/self-eval/server)'); }
    finally { setIsLoading(false); }
  }, []);

  useEffect(() => { loadSessions(); }, [loadSessions]);

  // ── Import helpers ─────────────────────────────────────────────────────────
  const parseImportFile = (text: string): ChatSession[] => {
    const parsed = JSON.parse(text);
    const arr: ChatSession[] = Array.isArray(parsed) ? parsed : [parsed];
    if (!arr.length) throw new Error('No sessions found in file');
    arr.forEach((s, i) => {
      if (!s.id || !s.title || !Array.isArray(s.messages))
        throw new Error(`Session ${i + 1} is missing required fields (id, title, messages)`);
    });
    return arr;
  };

  const handleImportFile = (file: File) => {
    setImportError(null); setImportPreview(null);
    if (!file.name.endsWith('.json')) { setImportError('Please upload a .json file'); return; }
    const reader = new FileReader();
    reader.onload = e => {
      try { setImportPreview(parseImportFile(e.target?.result as string)); }
      catch (err) { setImportError(err instanceof Error ? err.message : 'Invalid file'); }
    };
    reader.readAsText(file);
  };

  const confirmImport = async () => {
    if (!importPreview) return;
    // Ensure unique IDs for sessions that lack them
    const normalized = importPreview.map(s => ({
      ...s,
      id: s.id || `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    }));
    try {
      const imported = await apiImportSessions(normalized);
      setShowImport(false); setImportPreview(null); setImportError(null);
      loadSessions();
      setImportToast({ type: 'ok', msg: `${imported} session${imported !== 1 ? 's' : ''} imported to MongoDB` });
    } catch (err) {
      setImportToast({ type: 'err', msg: err instanceof Error ? err.message : 'Import failed' });
    }
    setTimeout(() => setImportToast(null), 3500);
  };

  const handleExportAll = async () => {
    try {
      const all = await apiExportAll();
      if (!all.length) return;
      const url = URL.createObjectURL(new Blob([JSON.stringify(all, null, 2)], { type: 'application/json' }));
      const a = Object.assign(document.createElement('a'), { href: url, download: `cz-sessions-${Date.now()}.json` });
      document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (err) {
      console.error('[Export]', err);
    }
  };

  const openSession = async (id: string) => {
    setIsLoadingDetail(true); setScreen('session');
    try {
      const session = await apiLoadSession(id);
      if (!session) throw new Error('Session not found');
      setSelectedSession(session);
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed'); setScreen('list'); }
    finally { setIsLoadingDetail(false); }
  };

  const deleteSession = async (id: string) => {
    if (!confirm('Delete this session?')) return;
    try {
      await apiDeleteSession(id);
    } catch (err) {
      console.error('[Delete]', err);
    }
    setSessions(p => p.filter(s => s.id !== id));
    if (selectedSession?.id === id) { setSelectedSession(null); setScreen('list'); }
  };

  const runCompare = async () => {
    if (!selectedSession) return;
    setIsComparing(true);
    setCompareProgress('Preparing…');

    // Fresh conversation from for this compare run
    const from = `917${Math.floor(1e9 + Math.random() * 9e9)}`;

    // Build turns: every user message paired with the next agent reply
    const msgs = selectedSession.messages;
    const turns: Array<{ user: ChatMessageRecord; agent?: ChatMessageRecord }> = [];
    msgs.forEach((m, idx) => {
      if (m.role === 'user') {
        const next = msgs.slice(idx + 1).find(x => x.role === 'agent');
        turns.push({ user: m, agent: next });
      }
    });

    const entries: CompareEntry[] = [];
    const RETRY_LIMIT = 2;
    const TURN_DELAY_MS = 500;

    for (let i = 0; i < turns.length; i++) {
      const { user, agent } = turns[i];
      setCompareProgress(`Turn ${i + 1} of ${turns.length} · sending…`);

      let newText = '[Error]';
      let newAgent: string | undefined;
      let newTimeMs: number | undefined;
      let succeeded = false;

      for (let attempt = 0; attempt <= RETRY_LIMIT; attempt++) {
        if (attempt > 0) {
          setCompareProgress(`Turn ${i + 1} of ${turns.length} · retry ${attempt}…`);
          await new Promise(r => setTimeout(r, 600 * attempt));
        }
        try {
          const body: Record<string, unknown> = { from, name: DEFAULT_NAME };
          if (user.isButtonTap) {
            body.buttonReplyId = user.content;
            body.buttonTitle   = user.content;
          } else {
            body.message = user.content;
          }
          const res  = await fetch(SIMULATE_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          if (data?.success) {
            newText   = data.response?.content ?? '[No response]';
            newAgent  = data.agentType ?? data.response?.metadata?.agentType;
            newTimeMs = data.processingTimeMs ?? data.response?.metadata?.responseTimeMs;
            succeeded = true;
            break;
          } else {
            throw new Error(data?.error ?? 'API returned success:false');
          }
        } catch {
          if (attempt === RETRY_LIMIT) {
            newText = '[Error — no response after retries]';
          }
        }
      }

      const sim = succeeded ? similarity(agent?.content ?? '', newText) : 0;
      entries.push({
        userMessage: user.content,
        isButtonTap: !!user.isButtonTap,
        oldResponse: agent?.content ?? '[No previous response]',
        newResponse: newText,
        oldAgent:    agent?.metadata?.agentType,
        newAgent,
        oldTimeMs:   agent?.metadata?.responseTimeMs,
        newTimeMs,
        similarity:  sim,
        status:      entryStatus(sim, !succeeded),
      });

      if (i < turns.length - 1) {
        setCompareProgress(`Turn ${i + 1} of ${turns.length} · done ✓`);
        await new Promise(r => setTimeout(r, TURN_DELAY_MS));
      }
    }

    setCompareResult({
      sessionId:    selectedSession.id,
      sessionTitle: selectedSession.title,
      runAt:        new Date().toISOString(),
      entries,
    });
    setIsComparing(false);
    setCompareProgress('');
    setScreen('compare');
  };

  const filtered = sessions.filter(s => !search || s.title.toLowerCase().includes(search.toLowerCase()));

  const totalEvalCount = sessions.reduce(
    (acc, s) => acc + s.flags.pass + s.flags.fail + s.flags.bug + s.flags.slow, 0
  );
  const totalFailCount = sessions.reduce(
    (acc, s) => acc + s.flags.fail + s.flags.bug, 0
  );

  // ── Screen router ──────────────────────────────────────────────────────────

  if (screen === 'globalEval') {
    return <GlobalEvalScreen sessions={sessions} onBack={() => setScreen('list')} />;
  }

  if (screen === 'session' || screen === 'eval' || screen === 'compare') {
    if (isLoadingDetail) return (
      <div className="flex-1 flex items-center justify-center flex-col gap-3" style={{ background: '#F7F8FB' }}>
        <Loader2 style={{ width: '28px', height: '28px', color: '#F97316' }} className="animate-spin" />
        <p className="text-[12px]" style={{ color: '#94a3b8' }}>Loading session…</p>
      </div>
    );

    if (screen === 'compare' && compareResult) {
      return <CompareView result={compareResult} onClose={() => setScreen('session')} />;
    }

    if ((screen === 'session' || screen === 'eval') && selectedSession) {
      if (screen === 'eval') {
        return <EvalScreen session={selectedSession} onBack={() => setScreen('session')} />;
      }
      return (
        <SessionView
          session={selectedSession}
          onBack={() => setScreen('list')}
          onDelete={() => deleteSession(selectedSession.id)}
          onCompare={runCompare}
          onEvalReview={() => setScreen('eval')}
          isComparing={isComparing}
          compareProgress={compareProgress}
        />
      );
    }
  }

  // ── Card grid (list) ───────────────────────────────────────────────────────

  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#F7F8FB' }}>

      {/* ── Import Modal ── */}
      <AnimatePresence>
        {showImport && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center"
            style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(4px)' }}
            onClick={e => { if (e.target === e.currentTarget) setShowImport(false); }}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 16 }} animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 16 }} transition={{ type: 'spring', stiffness: 340, damping: 28 }}
              className="w-full max-w-lg mx-4 rounded-3xl overflow-hidden"
              style={{ background: 'white', boxShadow: '0 24px 80px rgba(0,0,0,0.22), 0 8px 24px rgba(0,0,0,0.12)' }}
            >
              {/* Modal header */}
              <div className="px-7 pt-7 pb-5 flex items-start justify-between"
                style={{ borderBottom: '1px solid #F0F1F5' }}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-2xl flex items-center justify-center"
                    style={{ background: 'linear-gradient(135deg,rgba(249,115,22,0.15),rgba(249,115,22,0.06))', border: '1px solid rgba(249,115,22,0.22)' }}>
                    <Upload style={{ width: '17px', height: '17px', color: '#F97316' }} />
                  </div>
                  <div>
                    <h3 className="text-[16px] font-black" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>Import Sessions</h3>
                    <p className="text-[11px] mt-0.5" style={{ color: '#94a3b8' }}>Load past chat history from a JSON file</p>
                  </div>
                </div>
                <button onClick={() => setShowImport(false)} className="p-1.5 rounded-xl"
                  style={{ color: '#94a3b8', background: '#F7F8FB', border: '1px solid #EEF0F5' }}>
                  <X style={{ width: '14px', height: '14px' }} />
                </button>
              </div>

              <div className="px-7 py-6 space-y-5">
                {/* Drop zone */}
                <div
                  onDragOver={e => { e.preventDefault(); setImportDrag(true); }}
                  onDragLeave={() => setImportDrag(false)}
                  onDrop={e => {
                    e.preventDefault(); setImportDrag(false);
                    const file = e.dataTransfer.files[0];
                    if (file) handleImportFile(file);
                  }}
                  onClick={() => importFileRef.current?.click()}
                  className="cursor-pointer rounded-2xl flex flex-col items-center justify-center py-10 px-6 transition-all"
                  style={{
                    border: importDrag
                      ? '2px dashed #F97316'
                      : importPreview
                        ? '2px dashed #10b981'
                        : '2px dashed #E2E5EB',
                    background: importDrag
                      ? 'rgba(249,115,22,0.04)'
                      : importPreview
                        ? 'rgba(16,185,129,0.04)'
                        : '#FAFBFC',
                  }}
                >
                  <input ref={importFileRef} type="file" accept=".json" className="hidden"
                    onChange={e => { const f = e.target.files?.[0]; if (f) handleImportFile(f); e.target.value = ''; }} />

                  {importPreview ? (
                    <>
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                        style={{ background: 'rgba(16,185,129,0.1)', border: '1.5px solid rgba(16,185,129,0.25)' }}>
                        <CheckCheck style={{ width: '22px', height: '22px', color: '#10b981' }} />
                      </div>
                      <p className="text-[14px] font-black" style={{ color: '#0f172a' }}>
                        {importPreview.length} session{importPreview.length !== 1 ? 's' : ''} ready to import
                      </p>
                      <p className="text-[11px] mt-1.5 text-center" style={{ color: '#64748b' }}>
                        {importPreview.map(s => s.title).slice(0, 3).join(', ')}
                        {importPreview.length > 3 ? ` +${importPreview.length - 3} more` : ''}
                      </p>
                      <button className="mt-3 text-[11px] font-semibold" style={{ color: '#94a3b8' }}
                        onClick={e => { e.stopPropagation(); setImportPreview(null); }}>
                        Choose different file
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="w-14 h-14 rounded-2xl flex items-center justify-center mb-4"
                        style={{ background: importDrag ? 'rgba(249,115,22,0.1)' : 'rgba(249,115,22,0.07)', border: `1.5px solid ${importDrag ? 'rgba(249,115,22,0.35)' : 'rgba(249,115,22,0.15)'}` }}>
                        <FileJson style={{ width: '22px', height: '22px', color: '#F97316' }} />
                      </div>
                      <p className="text-[14px] font-bold" style={{ color: '#1e293b' }}>
                        {importDrag ? 'Drop it here' : 'Drag & drop your JSON file'}
                      </p>
                      <p className="text-[11px] mt-1.5" style={{ color: '#94a3b8' }}>or <span style={{ color: '#F97316', fontWeight: 700 }}>browse files</span> · .json only</p>
                      <div className="mt-5 px-4 py-2.5 rounded-xl text-[11px] leading-relaxed text-center" style={{ background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.12)', color: '#78350f', maxWidth: '320px' }}>
                        Accepts exported session files from this dashboard, or any JSON matching the session format: <code style={{ fontFamily: 'monospace', fontSize: '10px' }}>&#123; id, title, messages[ ] &#125;</code>
                      </div>
                    </>
                  )}
                </div>

                {/* Error */}
                {importError && (
                  <div className="flex items-start gap-2.5 px-4 py-3 rounded-2xl"
                    style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.18)' }}>
                    <AlertTriangle style={{ width: '14px', height: '14px', color: '#dc2626', flexShrink: 0, marginTop: '1px' }} />
                    <p className="text-[12px]" style={{ color: '#dc2626' }}>{importError}</p>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="px-7 pb-7 flex items-center gap-3">
                <button onClick={() => setShowImport(false)}
                  className="flex-1 py-3 rounded-2xl text-[13px] font-semibold transition-all"
                  style={{ background: '#F7F8FB', border: '1px solid #EEF0F5', color: '#64748b' }}
                  onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#F0F1F5'; }}
                  onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#F7F8FB'; }}>
                  Cancel
                </button>
                <button
                  onClick={confirmImport}
                  disabled={!importPreview}
                  className="flex-1 py-3 rounded-2xl text-[13px] font-bold transition-all flex items-center justify-center gap-2"
                  style={{
                    background: importPreview ? 'linear-gradient(135deg,#F97316,#fb923c)' : '#F0F1F5',
                    color: importPreview ? '#fff' : '#b0b8c4',
                    boxShadow: importPreview ? '0 4px 16px rgba(249,115,22,0.35)' : 'none',
                    cursor: importPreview ? 'pointer' : 'default',
                  }}
                  onMouseEnter={e => { if (importPreview) (e.currentTarget as HTMLElement).style.boxShadow = '0 6px 22px rgba(249,115,22,0.45)'; }}
                  onMouseLeave={e => { if (importPreview) (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(249,115,22,0.35)'; }}
                >
                  <Upload style={{ width: '13px', height: '13px' }} />
                  Import {importPreview ? `${importPreview.length} Session${importPreview.length !== 1 ? 's' : ''}` : ''}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Import Toast ── */}
      <AnimatePresence>
        {importToast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl"
            style={{
              transform: 'translateX(-50%)',
              background: importToast.type === 'ok' ? 'linear-gradient(135deg,#0f172a,#1e293b)' : '#dc2626',
              boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
              color: '#fff',
            }}
          >
            {importToast.type === 'ok'
              ? <CheckCheck style={{ width: '15px', height: '15px', color: '#34d399', flexShrink: 0 }} />
              : <AlertTriangle style={{ width: '15px', height: '15px', color: '#fbbf24', flexShrink: 0 }} />
            }
            <span className="text-[13px] font-semibold">{importToast.msg}</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Header */}
      <div className="shrink-0 px-7 py-4 flex items-center gap-4"
        style={{ background: 'white', borderBottom: '1px solid #F0F1F5', boxShadow: '0 1px 6px rgba(0,0,0,0.04)' }}>
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.2)' }}>
            <CheckCircle style={{ width: '15px', height: '15px', color: '#F97316' }} />
          </div>
          <div>
            <p className="text-[13px] font-black" style={{ color: '#0f172a', letterSpacing: '-0.01em' }}>
              {sessions.length} Session{sessions.length !== 1 ? 's' : ''}
            </p>
            <p className="text-[10px]" style={{ color: '#94a3b8' }}>Tap a card to view chat</p>
          </div>
        </div>

        {/* Search */}
        <div className="relative flex-1 max-w-sm">
          <Search style={{ width: '13px', height: '13px', position: 'absolute', left: '11px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search sessions…"
            className="w-full rounded-xl py-2.5 text-[12px] outline-none transition-all"
            style={{ paddingLeft: '32px', paddingRight: search ? '28px' : '12px', background: '#F7F8FB', border: '1px solid #EEF0F5', color: '#374151' }}
            onFocus={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.38)'; e.currentTarget.style.boxShadow = '0 0 0 3px rgba(249,115,22,0.07)'; e.currentTarget.style.background = '#fff'; }}
            onBlur={e => { e.currentTarget.style.borderColor = '#EEF0F5'; e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.background = '#F7F8FB'; }}
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: '#94a3b8' }}><X style={{ width: '12px', height: '12px' }} /></button>}
        </div>

        {/* Global Eval Review button */}
        <button
          onClick={() => setScreen('globalEval')}
          disabled={totalEvalCount === 0}
          className="flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold text-[12px] transition-all shrink-0"
          style={{
            background: totalEvalCount > 0
              ? 'linear-gradient(135deg, #F97316 0%, #fb923c 100%)'
              : '#F7F8FB',
            color: totalEvalCount > 0 ? '#fff' : '#94a3b8',
            border: totalEvalCount > 0 ? '1.5px solid rgba(249,115,22,0.3)' : '1px solid #EEF0F5',
            boxShadow: totalEvalCount > 0 ? '0 3px 14px rgba(249,115,22,0.35)' : '0 1px 3px rgba(0,0,0,0.06)',
            cursor: totalEvalCount === 0 ? 'default' : 'pointer',
            marginLeft: 'auto',
          }}
          onMouseEnter={e => { if (totalEvalCount > 0) (e.currentTarget as HTMLElement).style.boxShadow = '0 5px 20px rgba(249,115,22,0.45)'; }}
          onMouseLeave={e => { if (totalEvalCount > 0) (e.currentTarget as HTMLElement).style.boxShadow = '0 3px 14px rgba(249,115,22,0.35)'; }}
        >
          <BarChart2 style={{ width: '14px', height: '14px' }} />
          Eval Review
          {totalEvalCount > 0 && (
            <span className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9.5px] font-black"
              style={{ background: 'rgba(255,255,255,0.25)', color: '#fff' }}>
              {totalFailCount > 0 && <span style={{ background: '#ef4444', width: '6px', height: '6px', borderRadius: '50%', display: 'inline-block' }} />}
              {totalEvalCount}
            </span>
          )}
        </button>

        {/* Import button */}
        <button onClick={() => { setShowImport(true); setImportPreview(null); setImportError(null); }} style={iconBtn} title="Import sessions"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
          <Upload style={{ width: '14px', height: '14px' }} />
        </button>

        {/* Export all */}
        {sessions.length > 0 && (
          <button onClick={handleExportAll} style={iconBtn} title="Export all sessions as JSON"
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
            <Download style={{ width: '14px', height: '14px' }} />
          </button>
        )}

        <button onClick={loadSessions} disabled={isLoading} style={iconBtn} title="Refresh"
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
          <RefreshCw style={{ width: '14px', height: '14px' }} className={isLoading ? 'animate-spin' : ''} />
        </button>
      </div>

      {error && (
        <div className="mx-7 mt-4 px-4 py-3 rounded-xl flex items-center gap-3"
          style={{ background: 'rgba(220,38,38,0.06)', border: '1px solid rgba(220,38,38,0.2)' }}>
          <AlertCircle style={{ width: '15px', height: '15px', color: '#dc2626', flexShrink: 0 }} />
          <p className="text-[12px] flex-1" style={{ color: '#dc2626' }}>{error}</p>
          <button onClick={loadSessions} className="text-[11px] font-semibold px-3 py-1 rounded-lg"
            style={{ background: 'rgba(249,115,22,0.1)', color: '#ea580c' }}>Retry</button>
        </div>
      )}

      {/* Grid */}
      <div className="flex-1 overflow-y-auto px-7 py-6">
        {isLoading ? (
          <div className="flex items-center justify-center py-24">
            <Loader2 style={{ width: '28px', height: '28px', color: '#F97316' }} className="animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5"
              style={{ background: 'white', border: '1px solid #EEF0F5', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
              <MessageSquare style={{ width: '30px', height: '30px', color: '#F97316', opacity: 0.4 }} />
            </div>
            <p className="text-[16px] font-bold" style={{ color: '#1e293b' }}>
              {search ? 'No results found' : 'No sessions yet'}
            </p>
            <p className="text-[12px] mt-2" style={{ color: '#94a3b8' }}>
              {search ? 'Try a different term.' : 'Sessions from Live Chat appear here.'}
            </p>
          </div>
        ) : (
          <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))' }}>
            <AnimatePresence>
              {filtered.map((s, i) => (
                <GridCard key={s.id} session={s} index={i}
                  onSelect={() => openSession(s.id)}
                  onDelete={() => deleteSession(s.id)} />
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
};

export default ChatHistoryView;
