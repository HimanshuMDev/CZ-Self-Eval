import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  BarChart2, Download, Flag, Loader2,
  ChevronDown, ChevronRight, Clock, X,
  CheckCheck
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

// ─── API helpers — talks directly to live server ──────────────────────────────
const SESSIONS_API = '/api/arena/chat-sessions';

const FLAG_META = {
  pass: { label: 'Pass', emoji: '✅', color: '#059669', bg: 'rgba(5,150,105,0.09)',   border: 'rgba(5,150,105,0.22)',  bar: '#10b981' },
  fail: { label: 'Fail', emoji: '❌', color: '#dc2626', bg: 'rgba(220,38,38,0.08)',   border: 'rgba(220,38,38,0.2)',   bar: '#ef4444' },
  bug:  { label: 'Bug',  emoji: '🐛', color: '#7c3aed', bg: 'rgba(124,58,237,0.08)', border: 'rgba(124,58,237,0.2)',  bar: '#8b5cf6' },
  slow: { label: 'Slow', emoji: '🐌', color: '#d97706', bg: 'rgba(217,119,6,0.09)',   border: 'rgba(217,119,6,0.22)', bar: '#f59e0b' },
} as const;

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function buildExportRow(item: EvalItem) {
  return {
    Asked:     item.question?.content ?? '',
    Agent:     item.answer.content,
    Comment:   item.answer.comment ?? '',
    Flag:      item.flag ? FLAG_META[item.flag].label : '',
    Time:      item.answer.metadata?.responseTimeMs
                 ? `${(item.answer.metadata.responseTimeMs / 1000).toFixed(2)}s`
                 : '',
    AgentType: item.answer.metadata?.agentType ?? '',
    Session:   item.sessionTitle,
    Timestamp: item.answer.timestamp,
  };
}

// ─── Main View ────────────────────────────────────────────────────────────────

const EvalReviewView: React.FC = () => {
  const [items, setItems]               = useState<EvalItem[]>([]);
  const [isLoading, setIsLoading]       = useState(true);
  const [loadProgress, setLoadProgress] = useState('');
  const [filter, setFilter]             = useState<FilterType>('all');
  const [openId, setOpenId]             = useState<string | null>(null);
  const [toast, setToast]               = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const allItems: EvalItem[] = [];

    const load = async () => {
      const sessions = await apiLoadAllSessions();
      const withFlags = sessions.filter(
        s => s.flags.pass + s.flags.fail + s.flags.bug + s.flags.slow > 0
      );

      for (let i = 0; i < withFlags.length; i++) {
        if (cancelled) return;
        const session = withFlags[i];
        setLoadProgress(`${i + 1} / ${withFlags.length}`);

        session.messages.forEach((msg, idx) => {
          if (msg.role !== 'agent') return;
          const hasFlag    = !!msg.flag && msg.flag in FLAG_META;
          const hasComment = !!(msg.comment?.trim());
          if (!hasFlag && !hasComment) return;

          let question: ChatMessageRecord | null = null;
          for (let j = idx - 1; j >= 0; j--) {
            if (session.messages[j].role === 'user') { question = session.messages[j]; break; }
          }
          allItems.push({
            question, answer: msg,
            flag: hasFlag ? msg.flag as keyof typeof FLAG_META : null,
            hasComment, sessionId: session.id, sessionTitle: session.title,
          });
        });
      }

      if (!cancelled) {
        const order: Record<string, number> = { fail: 0, bug: 1, slow: 2, pass: 3 };
        allItems.sort((a, b) => (order[a.flag ?? ''] ?? 4) - (order[b.flag ?? ''] ?? 4));
        setItems(allItems);
        setIsLoading(false);
      }
    };

    load();
    return () => { cancelled = true; };
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
    const rows = (filter === 'all' ? items : filtered).map(buildExportRow);
    exportJson(`eval-review-${Date.now()}.json`, rows);
    setToast(`Downloaded ${rows.length} records as JSON`);
    setTimeout(() => setToast(null), 3000);
  };

  // ── Loading ────────────────────────────────────────────────────────────────
  if (isLoading) return (
    <div className="flex-1 flex flex-col items-center justify-center gap-4" style={{ background: '#F7F8FB' }}>
      <div className="w-16 h-16 rounded-2xl flex items-center justify-center"
        style={{ background: 'white', border: '1px solid #EEF0F5', boxShadow: '0 4px 24px rgba(0,0,0,0.08)' }}>
        <Loader2 style={{ width: '22px', height: '22px', color: '#F97316' }} className="animate-spin" />
      </div>
      <div className="text-center">
        <p className="text-[14px] font-bold" style={{ color: '#0f172a' }}>Loading eval history…</p>
        <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>{loadProgress}</p>
      </div>
    </div>
  );

  // ── Empty ──────────────────────────────────────────────────────────────────
  if (counts.all === 0) return (
    <div className="flex-1 flex items-center justify-center" style={{ background: '#F7F8FB' }}>
      <div className="text-center">
        <div className="w-20 h-20 rounded-3xl flex items-center justify-center mx-auto mb-5"
          style={{ background: 'white', border: '1px solid #EEF0F5', boxShadow: '0 4px 24px rgba(0,0,0,0.07)' }}>
          <Flag style={{ width: '28px', height: '28px', color: '#F97316', opacity: 0.4 }} />
        </div>
        <p className="text-[15px] font-bold" style={{ color: '#1e293b' }}>No eval items yet</p>
        <p className="text-[12px] mt-2" style={{ color: '#94a3b8' }}>
          Flag agent responses or add comments in Live Chat, then come back here.
        </p>
      </div>
    </div>
  );

  // ── Main layout ────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 flex overflow-hidden" style={{ background: '#F7F8FB' }}>

      {/* ── LEFT: Summary panel ── */}
      <div className="w-64 shrink-0 flex flex-col overflow-y-auto"
        style={{ background: 'white', borderRight: '1px solid #F0F1F5' }}>

        {/* Pass rate hero */}
        <div className="px-5 py-6" style={{ borderBottom: '1px solid #F0F1F5' }}>
          <p className="text-[9.5px] font-black uppercase tracking-widest mb-3" style={{ color: '#b0b8c4' }}>Overall Pass Rate</p>
          <div className="flex items-end gap-2 mb-3">
            <span className="text-[44px] font-black leading-none"
              style={{
                color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color,
                letterSpacing: '-0.04em',
              }}>
              {passRate}%
            </span>
          </div>
          <div className="h-2.5 rounded-full overflow-hidden mb-2" style={{ background: '#F0F1F5' }}>
            <div className="h-full rounded-full transition-all duration-700" style={{
              width: `${passRate}%`,
              background: passRate >= 70
                ? 'linear-gradient(90deg,#10b981,#34d399)'
                : passRate >= 40
                  ? 'linear-gradient(90deg,#f59e0b,#fbbf24)'
                  : 'linear-gradient(90deg,#ef4444,#f87171)',
            }} />
          </div>
          <p className="text-[10.5px] font-semibold"
            style={{ color: passRate >= 70 ? FLAG_META.pass.color : passRate >= 40 ? FLAG_META.slow.color : FLAG_META.fail.color }}>
            {passRate >= 70 ? '✅ Healthy' : passRate >= 40 ? '⚠️ Needs work' : '❌ Critical'}
          </p>
          <p className="text-[10px] mt-0.5" style={{ color: '#94a3b8' }}>
            {counts.all} flagged responses
          </p>
        </div>

        {/* Breakdown filters */}
        <div className="px-5 py-4 space-y-3">
          <p className="text-[9.5px] font-black uppercase tracking-widest mb-1" style={{ color: '#b0b8c4' }}>Filter</p>
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
        <div className="px-5 pb-6 mt-auto">
          <p className="text-[9.5px] font-black uppercase tracking-widest mb-2" style={{ color: '#b0b8c4' }}>Distribution</p>
          <div className="flex rounded-full overflow-hidden h-3" style={{ background: '#F0F1F5' }}>
            {counts.fail > 0 && <div style={{ width: `${(counts.fail / counts.all) * 100}%`, background: FLAG_META.fail.bar }} />}
            {counts.bug  > 0 && <div style={{ width: `${(counts.bug  / counts.all) * 100}%`, background: FLAG_META.bug.bar  }} />}
            {counts.slow > 0 && <div style={{ width: `${(counts.slow / counts.all) * 100}%`, background: FLAG_META.slow.bar }} />}
            {counts.pass > 0 && <div style={{ width: `${(counts.pass / counts.all) * 100}%`, background: FLAG_META.pass.bar }} />}
          </div>
          <div className="flex items-center justify-between mt-2">
            {counts.fail > 0 && <span className="text-[9px] font-bold" style={{ color: FLAG_META.fail.color }}>Fail {counts.fail}</span>}
            {counts.bug  > 0 && <span className="text-[9px] font-bold" style={{ color: FLAG_META.bug.color }}>Bug {counts.bug}</span>}
            {counts.slow > 0 && <span className="text-[9px] font-bold" style={{ color: FLAG_META.slow.color }}>Slow {counts.slow}</span>}
            {counts.pass > 0 && <span className="text-[9px] font-bold" style={{ color: FLAG_META.pass.color }}>Pass {counts.pass}</span>}
          </div>
        </div>
      </div>

      {/* ── RIGHT: Items list ── */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* List header */}
        <div className="px-6 py-3.5 shrink-0 flex items-center gap-2.5"
          style={{ background: 'white', borderBottom: '1px solid #F0F1F5', boxShadow: '0 1px 4px rgba(0,0,0,0.04)' }}>
          <BarChart2 style={{ width: '14px', height: '14px', color: '#F97316' }} />
          <span className="text-[13px] font-black" style={{ color: '#0f172a', letterSpacing: '-0.01em' }}>
            {filter === 'all' ? 'All Flagged Responses'
              : filter === 'comment' ? 'Comments & Notes'
              : `${FLAG_META[filter as keyof typeof FLAG_META].emoji} ${FLAG_META[filter as keyof typeof FLAG_META].label} Responses`}
          </span>
          <span className="text-[10.5px] px-2 py-0.5 rounded-full font-bold"
            style={{ background: 'rgba(249,115,22,0.1)', color: '#ea580c' }}>
            {filtered.length}
          </span>
          {filter !== 'all' && (
            <button onClick={() => setFilter('all')} className="flex items-center gap-1 text-[10.5px] font-semibold" style={{ color: '#94a3b8' }}>
              <X style={{ width: '11px', height: '11px' }} /> Clear
            </button>
          )}
          <div className="ml-auto flex items-center gap-2">
            {/* Export JSON */}
            <button
              onClick={doExport}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-[11px] font-bold transition-all"
              style={{ background: 'linear-gradient(135deg,#F97316,#fb923c)', color: '#fff', border: 'none', boxShadow: '0 2px 10px rgba(249,115,22,0.3)', cursor: 'pointer' }}
              onMouseEnter={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 16px rgba(249,115,22,0.45)'; }}
              onMouseLeave={e => { (e.currentTarget as HTMLElement).style.boxShadow = '0 2px 10px rgba(249,115,22,0.3)'; }}
            >
              <Download style={{ width: '12px', height: '12px' }} />
              Export JSON
            </button>
          </div>
        </div>

        {/* Items */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2.5" style={{ background: '#F7F8FB' }}>
          <AnimatePresence>
            {filtered.map((item, i) => {
              const rt     = item.answer.metadata?.responseTimeMs;
              const fm     = item.flag ? FLAG_META[item.flag] : null;
              const agType = item.answer.metadata?.agentType;
              const isOpen = openId === item.answer.id;

              return (
                <motion.div key={`${item.sessionId}-${item.answer.id}`}
                  initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }} transition={{ delay: Math.min(i * 0.018, 0.3) }}
                  className="rounded-2xl overflow-hidden"
                  style={{
                    background: 'white',
                    border: '1px solid #EEF0F5',
                    borderLeft: `4px solid ${fm ? fm.bar : 'rgba(249,115,22,0.45)'}`,
                    boxShadow: isOpen ? '0 6px 24px rgba(0,0,0,0.09)' : '0 1px 6px rgba(0,0,0,0.05)',
                  }}>

                  {/* Row */}
                  <button onClick={() => setOpenId(isOpen ? null : item.answer.id)}
                    className="w-full text-left px-5 py-4"
                    style={{ background: isOpen ? (fm ? fm.bg : 'rgba(249,115,22,0.03)') : 'transparent' }}>

                    {/* Badges */}
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

                      {agType && (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9px] font-semibold"
                          style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.15)', color: '#ea580c' }}>
                          🤖 {agType}
                        </span>
                      )}

                      {/* Session badge */}
                      <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full text-[9px] font-medium max-w-[160px] truncate"
                        style={{ background: '#F7F8FB', border: '1px solid #EEF0F5', color: '#64748b' }}
                        title={item.sessionTitle}>
                        📁 {item.sessionTitle}
                      </span>

                      {rt && (
                        <span className="flex items-center gap-0.5 text-[9.5px] font-medium"
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

                  {/* Accordion expand */}
                  <AnimatePresence>
                    {isOpen && (
                      <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.2 }}
                        style={{ overflow: 'hidden' }}>
                        <div className="px-5 pb-5 space-y-3" style={{ borderTop: '1px solid #F0F1F5' }}>

                          {/* Q box */}
                          {item.question && (
                            <div className="mt-3 p-4 rounded-2xl"
                              style={{ background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.12)' }}>
                              <p className="text-[9px] font-black uppercase tracking-widest mb-2" style={{ color: '#F97316' }}>
                                Asked
                              </p>
                              <p className="text-[13px] leading-relaxed" style={{ color: '#374151' }}>
                                {item.question.content}
                              </p>
                            </div>
                          )}

                          {/* A box */}
                          <div className="p-4 rounded-2xl"
                            style={{ background: fm ? fm.bg : '#F7F8FB', border: `1px solid ${fm ? fm.border : '#EEF0F5'}` }}>
                            <p className="text-[9px] font-black uppercase tracking-widest mb-2"
                              style={{ color: fm ? fm.color : '#94a3b8' }}>Agent</p>
                            <p className="text-[13px] leading-relaxed" style={{ color: '#1e293b' }}>
                              {renderText(item.answer.content)}
                            </p>
                          </div>

                          {/* Meta row */}
                          <div className="flex items-center gap-4 px-1">
                            {item.flag && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#b0b8c4' }}>Flag</span>
                                <span className="text-[11px] font-bold px-2 py-0.5 rounded-lg"
                                  style={{ background: fm?.bg, border: `1px solid ${fm?.border}`, color: fm?.color }}>
                                  {fm?.emoji} {fm?.label}
                                </span>
                              </div>
                            )}
                            {rt && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#b0b8c4' }}>Time</span>
                                <span className="text-[11px] font-bold" style={{ color: rt > 6000 ? FLAG_META.fail.color : rt > 3000 ? FLAG_META.slow.color : '#64748b' }}>
                                  {(rt / 1000).toFixed(2)}s
                                </span>
                              </div>
                            )}
                            {agType && (
                              <div className="flex items-center gap-1.5">
                                <span className="text-[9px] font-black uppercase tracking-widest" style={{ color: '#b0b8c4' }}>Agent</span>
                                <span className="text-[11px] font-semibold" style={{ color: '#ea580c' }}>🤖 {agType}</span>
                              </div>
                            )}
                          </div>

                          {/* Comment box */}
                          {item.answer.comment && (
                            <div className="px-4 py-3 rounded-xl flex items-start gap-2"
                              style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.16)', color: '#c2410c' }}>
                              <span className="text-[9px] font-black uppercase tracking-widest mt-0.5" style={{ color: '#F97316', flexShrink: 0 }}>Comment</span>
                              <span className="text-[12.5px] leading-relaxed ml-2">{item.answer.comment}</span>
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

      {/* Toast */}
      <AnimatePresence>
        {toast && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }} animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-6 left-1/2 z-50 flex items-center gap-3 px-5 py-3.5 rounded-2xl"
            style={{ transform: 'translateX(-50%)', background: 'linear-gradient(135deg,#0f172a,#1e293b)', boxShadow: '0 8px 32px rgba(0,0,0,0.25)', color: '#fff' }}
          >
            <CheckCheck style={{ width: '15px', height: '15px', color: '#34d399', flexShrink: 0 }} />
            <span className="text-[13px] font-semibold">{toast}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default EvalReviewView;
