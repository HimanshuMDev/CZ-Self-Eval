import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart2, Download, Flag, Loader2, Clock,
  ChevronDown, ChevronRight, Search, X, RefreshCw,
  CheckCheck, AlertCircle, MessageSquare, Zap
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

interface EvalItem {
  question: ChatMessageRecord | null;
  answer: ChatMessageRecord;
  flag: 'pass' | 'fail' | 'bug' | 'slow' | null;
  hasComment: boolean;
  sessionId: string;
  sessionTitle: string;
}

type FilterType = 'all' | 'pass' | 'fail' | 'bug' | 'slow' | 'comment';

// ─── Constants ────────────────────────────────────────────────────────────────

const SESSIONS_API = '/api/arena/chat-sessions';

const FLAG_META = {
  pass: { label: 'Pass', emoji: '✅', color: '#059669', bg: 'rgba(5,150,105,0.09)',   border: 'rgba(5,150,105,0.22)',  bar: '#10b981', light: 'rgba(5,150,105,0.06)'  },
  fail: { label: 'Fail', emoji: '❌', color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.2)',   bar: '#ef4444', light: 'rgba(220,38,38,0.04)'  },
  bug:  { label: 'Bug',  emoji: '🐛', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)',  bar: '#8b5cf6', light: 'rgba(124,58,237,0.04)' },
  slow: { label: 'Slow', emoji: '🐌', color: '#d97706', bg: 'rgba(217,119,6,0.09)',   border: 'rgba(217,119,6,0.22)', bar: '#f59e0b', light: 'rgba(217,119,6,0.04)'  },
} as const;

const AGENT_META: Record<string, { emoji: string; color: string; bg: string; border: string }> = {
  discovery:    { emoji: '🔍', color: '#c2410c', bg: 'rgba(194,65,12,0.08)',  border: 'rgba(194,65,12,0.2)'  },
  session:      { emoji: '⚡', color: '#b45309', bg: 'rgba(180,83,9,0.08)',   border: 'rgba(180,83,9,0.2)'   },
  payment:      { emoji: '💳', color: '#d97706', bg: 'rgba(217,119,6,0.08)',  border: 'rgba(217,119,6,0.2)'  },
  support:      { emoji: '🎧', color: '#ea580c', bg: 'rgba(234,88,12,0.08)',  border: 'rgba(234,88,12,0.2)'  },
  faq:          { emoji: '📖', color: '#9a3412', bg: 'rgba(154,52,18,0.08)',  border: 'rgba(154,52,18,0.2)'  },
  registration: { emoji: '👤', color: '#7c2d12', bg: 'rgba(124,45,18,0.08)', border: 'rgba(124,45,18,0.2)'  },
  error:        { emoji: '⚠️', color: '#dc2626', bg: 'rgba(220,38,38,0.07)', border: 'rgba(220,38,38,0.18)' },
};

function getAgentMeta(t?: string) {
  return AGENT_META[t?.toLowerCase() ?? ''] ?? { emoji: '🤖', color: '#ea580c', bg: 'rgba(234,88,12,0.07)', border: 'rgba(234,88,12,0.18)' };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDate(iso: string) {
  try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
  catch { return iso; }
}
function fmtTime(iso: string) {
  try { return new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
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

async function apiLoadAllSessions(): Promise<ChatSession[]> {
  const res = await fetch(`${SESSIONS_API}/export/all`);
  if (!res.ok) throw new Error(`Server error: ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (data.sessions ?? []);
}

function exportJson(filename: string, data: unknown) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
}

// ─── EvalCard ─────────────────────────────────────────────────────────────────

const EvalCard: React.FC<{ item: EvalItem; index: number; isOpen: boolean; onToggle: () => void }> = ({ item, index, isOpen, onToggle }) => {
  const fm  = item.flag ? FLAG_META[item.flag] : null;
  const am  = getAgentMeta(item.answer.metadata?.agentType);
  const rt  = item.answer.metadata?.responseTimeMs;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ delay: Math.min(index * 0.02, 0.25), type: 'spring', stiffness: 340, damping: 28 }}
      className="rounded-2xl overflow-hidden"
      style={{
        background: 'white',
        border: '1px solid #EEF0F5',
        borderLeft: `4px solid ${fm ? fm.bar : '#F97316'}`,
        boxShadow: isOpen ? '0 8px 32px rgba(0,0,0,0.10)' : '0 1px 6px rgba(0,0,0,0.05)',
        transition: 'box-shadow 0.2s',
      }}>

      {/* ── Collapsed row ── */}
      <button onClick={onToggle} className="w-full text-left px-5 py-4 transition-colors"
        style={{ background: isOpen ? (fm ? fm.light : 'rgba(249,115,22,0.03)') : 'transparent' }}>

        {/* Badge row */}
        <div className="flex items-center gap-1.5 mb-2.5 flex-wrap">
          <span className="text-[9px] font-black tabular-nums" style={{ color: '#d1d9e0', minWidth: '22px' }}>#{index + 1}</span>

          {fm ? (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold"
              style={{ background: fm.bg, border: `1px solid ${fm.border}`, color: fm.color }}>
              {fm.emoji} {fm.label}
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9.5px] font-bold"
              style={{ background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', color: '#c2410c' }}>
              💬 Note
            </span>
          )}

          {item.answer.metadata?.agentType && (
            <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-medium"
              style={{ background: am.bg, border: `1px solid ${am.border}`, color: am.color }}>
              {am.emoji} {item.answer.metadata.agentType}
            </span>
          )}

          <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-medium max-w-[160px] truncate"
            style={{ background: '#F7F8FB', border: '1px solid #EEF0F5', color: '#64748b' }}
            title={item.sessionTitle}>
            📁 {item.sessionTitle}
          </span>

          {rt && (
            <span className="flex items-center gap-0.5 text-[9.5px] font-semibold"
              style={{ color: rt > 6000 ? FLAG_META.fail.color : rt > 3000 ? FLAG_META.slow.color : '#94a3b8' }}>
              <Clock style={{ width: '9px', height: '9px' }} />{(rt / 1000).toFixed(1)}s
            </span>
          )}

          <span className="ml-auto text-[9px] shrink-0" style={{ color: '#b0b8c4' }}>{fmtTime(item.answer.timestamp)}</span>
          {isOpen
            ? <ChevronDown style={{ width: '13px', height: '13px', color: '#F97316', flexShrink: 0 }} />
            : <ChevronRight style={{ width: '13px', height: '13px', color: '#d1d9e0', flexShrink: 0 }} />
          }
        </div>

        {/* Q preview */}
        {item.question && (
          <p className="text-[11px] mb-1.5 line-clamp-1" style={{ color: '#94a3b8' }}>
            <span className="font-black mr-1.5 text-[9px] uppercase tracking-widest" style={{ color: '#F97316' }}>Q</span>
            {item.question.content}
          </p>
        )}

        {/* A preview */}
        <p className="text-[13px] font-medium leading-snug line-clamp-2" style={{ color: '#1e293b' }}>
          {item.answer.content}
        </p>

        {/* Response time bar */}
        {rt && rt > 0 && (
          <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: '#F0F1F5' }}>
            <div className="h-full rounded-full transition-all duration-500"
              style={{ width: `${Math.min((rt / 10000) * 100, 100)}%`, background: fm?.bar ?? '#F97316', opacity: 0.5 }} />
          </div>
        )}
      </button>

      {/* ── Expanded detail ── */}
      <AnimatePresence>
        {isOpen && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
            style={{ overflow: 'hidden' }}>
            <div className="px-5 pb-5 pt-4 space-y-3" style={{ borderTop: '1px solid #F0F1F5' }}>

              {/* Question */}
              {item.question && (
                <div className="p-4 rounded-2xl"
                  style={{ background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.12)' }}>
                  <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: '#F97316' }}>User asked</p>
                  <p className="text-[13px] leading-relaxed" style={{ color: '#374151' }}>{item.question.content}</p>
                </div>
              )}

              {/* Agent response */}
              <div className="p-4 rounded-2xl"
                style={{ background: fm ? fm.bg : '#F7F8FB', border: `1px solid ${fm ? fm.border : '#EEF0F5'}` }}>
                <p className="text-[9px] font-black uppercase tracking-widest mb-2"
                  style={{ color: fm ? fm.color : '#94a3b8' }}>Agent response</p>
                <p className="text-[13px] leading-relaxed" style={{ color: '#1e293b' }}>
                  {renderText(item.answer.content)}
                </p>
              </div>

              {/* Meta pills */}
              <div className="flex items-center gap-2 flex-wrap pt-1">
                {item.flag && fm && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-bold"
                    style={{ background: fm.bg, border: `1px solid ${fm.border}`, color: fm.color }}>
                    {fm.emoji} {fm.label}
                  </span>
                )}
                {rt && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-semibold"
                    style={{ background: '#F7F8FB', border: '1px solid #EEF0F5', color: rt > 6000 ? FLAG_META.fail.color : rt > 3000 ? FLAG_META.slow.color : '#64748b' }}>
                    <Clock style={{ width: '10px', height: '10px' }} />{(rt / 1000).toFixed(2)}s
                  </span>
                )}
                {item.answer.metadata?.agentType && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-semibold"
                    style={{ background: am.bg, border: `1px solid ${am.border}`, color: am.color }}>
                    {am.emoji} {item.answer.metadata.agentType}
                  </span>
                )}
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10.5px] font-medium"
                  style={{ background: '#F7F8FB', border: '1px solid #EEF0F5', color: '#64748b' }}>
                  🕐 {fmtDate(item.answer.timestamp)}
                </span>
              </div>

              {/* Comment */}
              {item.answer.comment && (
                <div className="px-4 py-3 rounded-xl flex items-start gap-2.5"
                  style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.16)' }}>
                  <MessageSquare style={{ width: '13px', height: '13px', color: '#F97316', flexShrink: 0, marginTop: '2px' }} />
                  <p className="text-[12.5px] leading-relaxed" style={{ color: '#c2410c' }}>{item.answer.comment}</p>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
};

// ─── Main View ────────────────────────────────────────────────────────────────

const EvalReviewView: React.FC = () => {
  const [items, setItems]         = useState<EvalItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [filter, setFilter]       = useState<FilterType>('all');
  const [search, setSearch]       = useState('');
  const [openId, setOpenId]       = useState<string | null>(null);
  const [toast, setToast]         = useState<string | null>(null);
  const cancelRef                 = useRef(false);

  const load = async () => {
    cancelRef.current = false;
    setIsLoading(true);
    setLoadError(null);
    const allItems: EvalItem[] = [];

    try {
      const sessions = await apiLoadAllSessions();
      const withFlags = sessions.filter(
        s => s.flags.pass + s.flags.fail + s.flags.bug + s.flags.slow > 0
      );

      for (const session of withFlags) {
        if (cancelRef.current) return;
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
            hasComment, sessionId: session.id, sessionTitle: session.title,
          });
        });
      }

      if (!cancelRef.current) {
        const order: Record<string, number> = { fail: 0, bug: 1, slow: 2, pass: 3 };
        allItems.sort((a, b) => (order[a.flag ?? ''] ?? 4) - (order[b.flag ?? ''] ?? 4));
        setItems(allItems);
      }
    } catch (err) {
      if (!cancelRef.current) setLoadError(err instanceof Error ? err.message : 'Failed to load');
    } finally {
      if (!cancelRef.current) setIsLoading(false);
    }
  };

  useEffect(() => {
    load();
    return () => { cancelRef.current = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = {
    all:     items.length,
    pass:    items.filter(i => i.flag === 'pass').length,
    fail:    items.filter(i => i.flag === 'fail').length,
    bug:     items.filter(i => i.flag === 'bug').length,
    slow:    items.filter(i => i.flag === 'slow').length,
    comment: items.filter(i => i.hasComment).length,
  };

  const passRate = counts.pass + counts.fail > 0
    ? Math.round((counts.pass / (counts.pass + counts.fail)) * 100)
    : 0;

  const filtered = (filter === 'all' ? items
    : filter === 'comment' ? items.filter(i => i.hasComment)
    : items.filter(i => i.flag === filter)
  ).filter(i => !search || (
    i.answer.content.toLowerCase().includes(search.toLowerCase()) ||
    i.question?.content.toLowerCase().includes(search.toLowerCase()) ||
    i.sessionTitle.toLowerCase().includes(search.toLowerCase())
  ));

  const doExport = () => {
    const rows = filtered.map(item => ({
      Question: item.question?.content ?? '',
      Answer:   item.answer.content,
      Flag:     item.flag ? FLAG_META[item.flag].label : '',
      Comment:  item.answer.comment ?? '',
      Agent:    item.answer.metadata?.agentType ?? '',
      Time:     item.answer.metadata?.responseTimeMs ? `${(item.answer.metadata.responseTimeMs / 1000).toFixed(2)}s` : '',
      Session:  item.sessionTitle,
      Date:     item.answer.timestamp,
    }));
    exportJson(`eval-${Date.now()}.json`, rows);
    setToast(`${rows.length} records exported`);
    setTimeout(() => setToast(null), 2500);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-5" style={{ background: '#F7F8FB' }}>
      <div className="relative">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
          style={{ background: 'white', border: '1px solid #EEF0F5', boxShadow: '0 8px 32px rgba(0,0,0,0.08)' }}>
          <BarChart2 style={{ width: '30px', height: '30px', color: '#F97316', opacity: 0.3 }} />
        </div>
        <div className="absolute -bottom-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center"
          style={{ background: 'linear-gradient(135deg,#F97316,#fb923c)', boxShadow: '0 4px 14px rgba(249,115,22,0.4)' }}>
          <Loader2 style={{ width: '14px', height: '14px', color: '#fff' }} className="animate-spin" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-[15px] font-black" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>Loading Eval Review</p>
        <p className="text-[11.5px] mt-1" style={{ color: '#94a3b8' }}>Scanning flagged sessions…</p>
      </div>
    </div>
  );

  // ── Error ──────────────────────────────────────────────────────────────────
  if (loadError) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ background: '#F7F8FB' }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.18)' }}>
        <AlertCircle style={{ width: '24px', height: '24px', color: '#dc2626' }} />
      </div>
      <div className="text-center">
        <p className="text-[14px] font-bold mb-1" style={{ color: '#1e293b' }}>Could not load sessions</p>
        <p className="text-[11px] mb-4" style={{ color: '#94a3b8' }}>{loadError}</p>
        <button onClick={load}
          className="flex items-center gap-2 px-4 py-2 rounded-xl font-semibold text-[12px] mx-auto"
          style={{ background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.2)', color: '#ea580c' }}>
          <RefreshCw style={{ width: '13px', height: '13px' }} /> Retry
        </button>
      </div>
    </div>
  );

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (counts.all === 0) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ background: '#F7F8FB' }}>
      <div className="w-20 h-20 rounded-3xl flex items-center justify-center"
        style={{ background: 'white', border: '1px solid #EEF0F5', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
        <Flag style={{ width: '28px', height: '28px', color: '#F97316', opacity: 0.35 }} />
      </div>
      <div className="text-center">
        <p className="text-[16px] font-black mb-1" style={{ color: '#1e293b', letterSpacing: '-0.02em' }}>No Eval Data Yet</p>
        <p className="text-[12px] leading-relaxed" style={{ color: '#94a3b8', maxWidth: '240px' }}>
          Flag agent responses with ✅ ❌ 🐛 🐌 in Live Chat, then come back here.
        </p>
      </div>
    </div>
  );

  // ── Main ───────────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden" style={{ background: '#F7F8FB' }}>

      {/* ── Header ── */}
      <div className="shrink-0" style={{ background: 'white', borderBottom: '1px solid #F0F1F5', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
        <div className="px-6 py-4">

          {/* Title row */}
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
              style={{ background: 'linear-gradient(135deg,rgba(249,115,22,0.15),rgba(249,115,22,0.06))', border: '1px solid rgba(249,115,22,0.22)' }}>
              <BarChart2 style={{ width: '16px', height: '16px', color: '#F97316' }} />
            </div>
            <div className="flex-1">
              <h1 className="text-[16px] font-black leading-tight" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>Eval Review</h1>
              <p className="text-[11px]" style={{ color: '#94a3b8' }}>All flagged responses across sessions</p>
            </div>
            <button onClick={load}
              style={{ background: '#fff', border: '1px solid #EEF0F5', color: '#64748b', borderRadius: '10px', padding: '7px', display: 'flex', cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' }}
              title="Refresh"
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#FFF7ED'; (e.currentTarget as HTMLElement).style.borderColor = 'rgba(249,115,22,0.25)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = '#fff'; (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
              <RefreshCw style={{ width: '14px', height: '14px' }} />
            </button>
            <button onClick={doExport}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold transition-all"
              style={{ background: 'linear-gradient(135deg,#F97316,#fb923c)', color: '#fff', border: 'none', boxShadow: '0 3px 12px rgba(249,115,22,0.35)', cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 5px 18px rgba(249,115,22,0.48)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 3px 12px rgba(249,115,22,0.35)'; }}>
              <Download style={{ width: '12px', height: '12px' }} />
              Export
            </button>
          </div>

          {/* ── Stat cards row ── */}
          <div className="grid grid-cols-5 gap-3 mb-4">
            {/* Pass rate */}
            <div className="col-span-1 p-3.5 rounded-2xl flex flex-col justify-between"
              style={{
                background: passRate >= 70 ? FLAG_META.pass.bg : passRate >= 40 ? FLAG_META.slow.bg : FLAG_META.fail.bg,
                border: `1.5px solid ${passRate >= 70 ? FLAG_META.pass.border : passRate >= 40 ? FLAG_META.slow.border : FLAG_META.fail.border}`,
              }}>
              <p className="text-[8.5px] font-black uppercase tracking-widest mb-1"
                style={{ color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color, opacity: 0.7 }}>
                Pass Rate
              </p>
              <p className="text-[28px] font-black leading-none"
                style={{ color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color, letterSpacing: '-0.04em' }}>
                {passRate}%
              </p>
              <p className="text-[9.5px] font-semibold mt-1"
                style={{ color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color }}>
                {passRate >= 70 ? '✅ Healthy' : passRate >= 40 ? '⚠️ Needs work' : '❌ Critical'}
              </p>
              {/* Mini progress bar */}
              <div className="mt-2 h-1.5 rounded-full overflow-hidden" style={{ background: 'rgba(255,255,255,0.5)' }}>
                <div className="h-full rounded-full transition-all duration-700"
                  style={{ width: `${passRate}%`, background: passRate >= 70 ? FLAG_META.pass.bar : passRate >= 40 ? FLAG_META.slow.bar : FLAG_META.fail.bar }} />
              </div>
            </div>

            {/* Flag breakdown cards */}
            {([
              { key: 'fail' as const, label: 'Fail',  count: counts.fail,    meta: FLAG_META.fail },
              { key: 'bug'  as const, label: 'Bug',   count: counts.bug,     meta: FLAG_META.bug  },
              { key: 'slow' as const, label: 'Slow',  count: counts.slow,    meta: FLAG_META.slow },
              { key: 'pass' as const, label: 'Pass',  count: counts.pass,    meta: FLAG_META.pass },
            ]).map(({ key, label, count, meta }) => (
              <button key={key}
                onClick={() => setFilter(filter === key ? 'all' : key)}
                className="col-span-1 p-3.5 rounded-2xl text-left transition-all"
                style={{
                  background: filter === key ? meta.bg : 'white',
                  border: filter === key ? `1.5px solid ${meta.border}` : '1.5px solid #EEF0F5',
                  boxShadow: filter === key ? `0 4px 16px ${meta.bar}22` : '0 1px 4px rgba(0,0,0,0.04)',
                  cursor: 'pointer',
                }}
                onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = meta.border; }}
                onMouseLeave={e => { if (filter !== key) (e.currentTarget as HTMLElement).style.borderColor = '#EEF0F5'; }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[18px]">{meta.emoji}</span>
                  {filter === key && <div className="w-2 h-2 rounded-full" style={{ background: meta.bar, boxShadow: `0 0 6px ${meta.bar}` }} />}
                </div>
                <p className="text-[24px] font-black leading-none mb-1"
                  style={{ color: filter === key ? meta.color : '#0f172a', letterSpacing: '-0.03em' }}>
                  {count}
                </p>
                <p className="text-[9.5px] font-bold uppercase tracking-wide"
                  style={{ color: filter === key ? meta.color : '#94a3b8' }}>
                  {label}
                </p>
                {counts.all > 0 && (
                  <div className="mt-2 h-1 rounded-full overflow-hidden" style={{ background: '#F0F1F5' }}>
                    <div className="h-full rounded-full transition-all duration-500"
                      style={{ width: `${(count / counts.all) * 100}%`, background: meta.bar }} />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* ── Filter tabs + search row ── */}
          <div className="flex items-center gap-2">
            {/* Filter tabs */}
            <div className="flex items-center gap-1.5 p-1 rounded-xl" style={{ background: '#F7F8FB', border: '1px solid #EEF0F5' }}>
              {([
                { key: 'all'     as FilterType, label: 'All',      count: counts.all     },
                { key: 'fail'    as FilterType, label: 'Fail',     count: counts.fail,    color: FLAG_META.fail.color },
                { key: 'bug'     as FilterType, label: 'Bug',      count: counts.bug,     color: FLAG_META.bug.color  },
                { key: 'slow'    as FilterType, label: 'Slow',     count: counts.slow,    color: FLAG_META.slow.color },
                { key: 'pass'    as FilterType, label: 'Pass',     count: counts.pass,    color: FLAG_META.pass.color },
                { key: 'comment' as FilterType, label: 'Notes',    count: counts.comment, color: '#ea580c' },
              ]).filter(t => t.count > 0 || t.key === 'all').map(tab => {
                const active = filter === tab.key;
                return (
                  <button key={tab.key} onClick={() => setFilter(tab.key)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[11px] font-semibold transition-all"
                    style={{
                      background: active ? 'white' : 'transparent',
                      color:      active ? (tab.color ?? '#0f172a') : '#94a3b8',
                      boxShadow:  active ? '0 1px 4px rgba(0,0,0,0.08)' : 'none',
                    }}>
                    {tab.label}
                    {tab.count > 0 && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black"
                        style={{ background: active ? (tab.color ? `${tab.color}18` : 'rgba(249,115,22,0.1)') : 'rgba(0,0,0,0.06)', color: active ? (tab.color ?? '#F97316') : '#94a3b8' }}>
                        {tab.count}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Search */}
            <div className="relative flex-1 max-w-xs ml-auto">
              <Search style={{ width: '12px', height: '12px', position: 'absolute', left: '10px', top: '50%', transform: 'translateY(-50%)', color: '#94a3b8', pointerEvents: 'none' }} />
              <input value={search} onChange={e => setSearch(e.target.value)}
                placeholder="Search responses…"
                className="w-full rounded-xl py-2 text-[11.5px] outline-none transition-all"
                style={{ paddingLeft: '30px', paddingRight: search ? '28px' : '10px', background: '#F7F8FB', border: '1px solid #EEF0F5', color: '#374151' }}
                onFocus={e => { e.currentTarget.style.borderColor = 'rgba(249,115,22,0.38)'; e.currentTarget.style.background = '#fff'; }}
                onBlur={e => { e.currentTarget.style.borderColor = '#EEF0F5'; e.currentTarget.style.background = '#F7F8FB'; }}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2" style={{ color: '#94a3b8' }}>
                  <X style={{ width: '11px', height: '11px' }} />
                </button>
              )}
            </div>

            {/* Result count */}
            <span className="text-[11px] font-semibold shrink-0" style={{ color: '#94a3b8' }}>
              {filtered.length} result{filtered.length !== 1 ? 's' : ''}
            </span>
          </div>
        </div>
      </div>

      {/* ── Item list ── */}
      <div className="flex-1 overflow-y-auto px-6 py-5 space-y-3">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 gap-3">
            <div className="w-14 h-14 rounded-2xl flex items-center justify-center"
              style={{ background: 'white', border: '1px solid #EEF0F5' }}>
              <Zap style={{ width: '20px', height: '20px', color: '#F97316', opacity: 0.3 }} />
            </div>
            <p className="text-[13px] font-semibold" style={{ color: '#94a3b8' }}>
              {search ? 'No results match your search' : 'Nothing in this category'}
            </p>
            {(search || filter !== 'all') && (
              <button onClick={() => { setSearch(''); setFilter('all'); }}
                className="text-[11px] font-semibold flex items-center gap-1"
                style={{ color: '#F97316' }}>
                <X style={{ width: '11px', height: '11px' }} /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <AnimatePresence mode="popLayout">
            {filtered.map((item, i) => (
              <EvalCard
                key={`${item.sessionId}-${item.answer.id}`}
                item={item}
                index={i}
                isOpen={openId === item.answer.id}
                onToggle={() => setOpenId(openId === item.answer.id ? null : item.answer.id)}
              />
            ))}
          </AnimatePresence>
        )}
      </div>

      {/* ── Toast ── */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 20 }}
            className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 px-5 py-3 rounded-2xl"
            style={{ transform: 'translateX(-50%)', background: '#0f172a', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', color: '#fff' }}>
            <CheckCheck style={{ width: '14px', height: '14px', color: '#34d399' }} />
            <span className="text-[12.5px] font-semibold">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EvalReviewView;
