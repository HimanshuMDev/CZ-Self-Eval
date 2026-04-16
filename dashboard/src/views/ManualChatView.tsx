import React, { useState, useEffect, useRef } from 'react';
import {
  Send, Bot, User, Clock, Trash2,
  MapPin, Shield, Zap, Terminal,
  ChevronRight, ArrowRight, Wallet,
  LocateFixed, MessageSquare, Navigation,
  MessageSquareText, CheckCircle2, XCircle, Bug, Timer,
  Download, CloudUpload
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Config ──────────────────────────────────────────────────────────────────
const SIMULATE_URL = 'https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate';

// ─── API helpers — talks directly to live server ──────────────────────────────
const SESSIONS_API = '/api/arena/chat-sessions';

async function apiSaveSession(session: ChatSession): Promise<void> {
  const res = await fetch(SESSIONS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`);
}
const DEFAULT_FROM = '918000363019';
const DEFAULT_NAME = 'Self-Eval Test User';

interface QuickReplyButton {
  id: string;
  title: string;
  payload?: string;
}

interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: Date;
  isButtonTap?: boolean;
  comment?: string;
  flag?: 'pass' | 'fail' | 'bug' | 'slow' | null;
  metadata?: {
    agentType?: string;
    responseTimeMs?: number;
    thought?: string;
    suggestedActions?: any[];
    buttons?: QuickReplyButton[];
    data?: any;
  };
}

interface ChatSessionRecord {
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
  messages: ChatSessionRecord[];
  summary?: string;
}

// ─── Helper: call /api/whatsapp/simulate ─────────────────────────────────────

async function sendToAgent(params: {
  message?: string;
  buttonReplyId?: string;
  buttonTitle?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  from?: string;
  name?: string;
}) {
  const res = await fetch(SIMULATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: params.from ?? DEFAULT_FROM,
      message: params.message,
      buttonReplyId: params.buttonReplyId,
      buttonTitle: params.buttonTitle,
      location: params.location,
      name: params.name ?? DEFAULT_NAME,
    }),
  });
  if (!res.ok) throw new Error(`Agent returned ${res.status}: ${res.statusText}`);
  return await res.json();
}

// ─── Simple WhatsApp Markdown Renderer ───────────────────────────────────────

function renderWhatsAppText(text: string, isUser = false) {
  return text.split('\n').map((line, lineIdx) => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let partKey = 0;

    const regex = /(\*([^*]+)\*)|(_([^_]+)_)|(~([^~]+)~)|(```([^`]+)```)/g;
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(remaining)) !== null) {
      if (match.index > lastIndex) {
        parts.push(<span key={partKey++}>{remaining.slice(lastIndex, match.index)}</span>);
      }
      if (match[2]) {
        parts.push(<strong key={partKey++} className={`font-bold ${isUser ? 'text-white' : 'text-slate-900'}`}>{match[2]}</strong>);
      } else if (match[4]) {
        parts.push(<em key={partKey++} className={`italic ${isUser ? 'text-orange-100' : 'text-slate-500'}`}>{match[4]}</em>);
      } else if (match[6]) {
        parts.push(<span key={partKey++} className="line-through opacity-60">{match[6]}</span>);
      } else if (match[8]) {
        parts.push(<code key={partKey++} className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${isUser ? 'bg-white/20 text-orange-50' : 'bg-slate-100 text-emerald-700'}`}>{match[8]}</code>);
      }
      lastIndex = match.index + match[0].length;
    }

    if (lastIndex < remaining.length) {
      parts.push(<span key={partKey++}>{remaining.slice(lastIndex)}</span>);
    }
    if (parts.length === 0) parts.push(<span key={0}>{line}</span>);

    return (
      <React.Fragment key={lineIdx}>
        {lineIdx > 0 && <br />}
        {parts}
      </React.Fragment>
    );
  });
}

// ─── Component ───────────────────────────────────────────────────────────────

const ManualChatView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [systemContext, setSystemContext] = useState<any>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionSummary, setSessionSummary] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef(`chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  useEffect(() => {
    if (messages.length > 0 && !sessionTitle) {
      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      setSessionTitle(`Manual Test - ${date}`);
    }
  }, [messages, sessionTitle]);

  const processResponse = (data: any): Message => ({
    id: (Date.now() + 1).toString(),
    role: 'agent',
    content: data.response.content,
    timestamp: new Date(),
    metadata: {
      agentType: data.agentType,
      responseTimeMs: data.processingTimeMs,
      buttons: data.response.buttons,
      data: data.response.data,
    }
  });

  const doSend = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    try {
      const data = await sendToAgent({ message: text });
      if (data.success && data.response) {
        setMessages(prev => [...prev, processResponse(data)]);
        if (data.response.data?.verifiedUser) setSystemContext(data.response.data.verifiedUser);
      } else throw new Error(data.error || 'Failed to get response');
    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'agent',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}. Is the agent server running?`,
        timestamp: new Date(), metadata: { agentType: 'error' }
      }]);
    } finally { setIsLoading(false); }
  };

  const doButtonTap = async (buttonId: string, buttonLabel: string) => {
    if (isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: buttonLabel, timestamp: new Date(), isButtonTap: true };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    try {
      const data = await sendToAgent({ buttonReplyId: buttonId, buttonTitle: buttonLabel });
      if (data.success && data.response) {
        setMessages(prev => [...prev, processResponse(data)]);
        if (data.response.data?.verifiedUser) setSystemContext(data.response.data.verifiedUser);
      } else throw new Error(data.error || 'Button tap failed');
    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'agent',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(), metadata: { agentType: 'error' }
      }]);
    } finally { setIsLoading(false); }
  };

  const doShareLocation = async (city: string, lat: number, lng: number) => {
    if (isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: `📍 Shared location: ${city}`, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    try {
      const data = await sendToAgent({ message: '', location: { latitude: lat, longitude: lng, name: city, address: city } });
      if (data.success && data.response) {
        setMessages(prev => [...prev, processResponse(data)]);
        if (data.response.data?.verifiedUser) setSystemContext(data.response.data.verifiedUser);
      } else throw new Error(data.error || 'Location share failed');
    } catch (error) {
      setMessages(prev => [...prev, {
        id: (Date.now() + 1).toString(), role: 'agent',
        content: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        timestamp: new Date(), metadata: { agentType: 'error' }
      }]);
    } finally { setIsLoading(false); }
  };

  const handleSend = () => doSend(inputValue);

  const handleReset = async () => {
    if (!confirm('Clear chat and reset session context?')) return;
    try {
      await fetch('https://api.aiagent.dev.chargecloud.net/api/arena/chat/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: DEFAULT_FROM, sessionId: `whatsapp:${DEFAULT_FROM}` })
      });
      setMessages([]);
      setSystemContext(null);
    } catch (err) { console.error('Reset failed:', err); }
  };

  const isLocationRequest = (msg: Message) => {
    if (msg.role !== 'agent') return false;
    const lower = msg.content.toLowerCase();
    return lower.includes('share your current location') || lower.includes('share your location') ||
           lower.includes('📎') || msg.metadata?.data?.requestLocationShare === true ||
           msg.metadata?.data?.suggestLocationShare === true;
  };

  const getFlagCounts = () => messages.reduce(
    (acc, msg) => {
      if (msg.flag === 'pass') acc.pass++;
      else if (msg.flag === 'fail') acc.fail++;
      else if (msg.flag === 'bug') acc.bug++;
      else if (msg.flag === 'slow') acc.slow++;
      return acc;
    }, { pass: 0, fail: 0, bug: 0, slow: 0 }
  );

  const getCommentCount = () => messages.filter(msg => msg.comment && msg.comment.trim()).length;

  const toggleFlag = (messageId: string, newFlag: 'pass' | 'fail' | 'bug' | 'slow') => {
    setMessages(prev => prev.map(msg =>
      msg.id === messageId ? { ...msg, flag: msg.flag === newFlag ? null : newFlag } : msg
    ));
  };

  const saveComment = (messageId: string, commentText: string) => {
    setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, comment: commentText } : msg));
    setEditingComment(null);
    setCommentInput('');
  };

  const buildSessionPayload = (msgs: Message[], title: string, summary: string): ChatSession => {
    const agentMessages = msgs.filter(m => m.role === 'agent');
    const responseTimes = agentMessages.map(m => m.metadata?.responseTimeMs || 0).filter(t => t > 0);
    const avgResponseTime = responseTimes.length
      ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : 0;
    const agentTypesUsed = Array.from(new Set(agentMessages.map(m => m.metadata?.agentType).filter(Boolean))) as string[];
    const flags = msgs.reduce(
      (acc, msg) => {
        if (msg.flag === 'pass') acc.pass++;
        else if (msg.flag === 'fail') acc.fail++;
        else if (msg.flag === 'bug') acc.bug++;
        else if (msg.flag === 'slow') acc.slow++;
        return acc;
      }, { pass: 0, fail: 0, bug: 0, slow: 0 }
    );
    return {
      id: sessionIdRef.current,
      title: title || `Manual Test - ${new Date().toLocaleDateString()}`,
      createdAt: new Date(msgs[0]?.timestamp || Date.now()).toISOString(),
      updatedAt: new Date().toISOString(),
      from: DEFAULT_FROM, totalMessages: msgs.length, totalAgentMessages: agentMessages.length,
      avgResponseTimeMs: avgResponseTime, agentTypesUsed, flags,
      messages: msgs.map(msg => ({
        id: msg.id, role: msg.role, content: msg.content,
        timestamp: msg.timestamp.toISOString(), isButtonTap: msg.isButtonTap,
        metadata: msg.metadata, comment: msg.comment, flag: msg.flag || null,
      })),
      summary: summary || undefined,
    };
  };

  // ── Auto-save to MongoDB after every agent response ───────────────────────
  useEffect(() => {
    if (isLoading || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'agent') return;
    const payload = buildSessionPayload(messages, sessionTitle, sessionSummary);
    setAutoSaveStatus('saving');
    apiSaveSession(payload)
      .then(() => {
        setAutoSaveStatus('saved');
        setTimeout(() => setAutoSaveStatus('idle'), 2000);
      })
      .catch(err => {
        console.error('[AutoSave] failed:', err);
        setAutoSaveStatus('error');
        setTimeout(() => setAutoSaveStatus('idle'), 3000);
      });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading]);

  const getFlagInfo = (flag?: string | null) => {
    switch (flag) {
      case 'pass': return { bg: 'bg-emerald-50 border-emerald-200 text-emerald-700', icon: '✅', label: 'Pass' };
      case 'fail': return { bg: 'bg-red-50 border-red-200 text-red-700', icon: '❌', label: 'Fail' };
      case 'bug':  return { bg: 'bg-purple-50 border-purple-200 text-purple-700', icon: '🐛', label: 'Bug' };
      case 'slow': return { bg: 'bg-amber-50 border-amber-200 text-amber-700', icon: '🐌', label: 'Slow' };
      default: return null;
    }
  };

  const getAgentDisplayInfo = (agentType?: string) => {
    switch (agentType?.toLowerCase()) {
      case 'discovery':    return { icon: '🔍', label: 'Discovery', bg: 'bg-sky-50 border-sky-200 text-sky-700' };
      case 'session':      return { icon: '⚡', label: 'Session', bg: 'bg-amber-50 border-amber-200 text-amber-700' };
      case 'payment':      return { icon: '💳', label: 'Payment', bg: 'bg-emerald-50 border-emerald-200 text-emerald-700' };
      case 'support':      return { icon: '🎧', label: 'Support', bg: 'bg-violet-50 border-violet-200 text-violet-700' };
      case 'faq':          return { icon: '📖', label: 'FAQ', bg: 'bg-orange-50 border-orange-200 text-orange-700' };
      case 'registration': return { icon: '👤', label: 'Registration', bg: 'bg-cyan-50 border-cyan-200 text-cyan-700' };
      case 'error':        return { icon: '❌', label: 'Error', bg: 'bg-red-50 border-red-200 text-red-700' };
      default:             return { icon: '🤖', label: 'Agent', bg: 'bg-slate-100 border-slate-200 text-slate-600' };
    }
  };

  const exportAsMarkdown = () => {
    if (messages.length === 0) { alert('No messages to export'); return; }
    const flags = getFlagCounts();
    const date = new Date().toLocaleDateString();
    const title = sessionTitle || `Manual Test - ${date}`;
    let md = `# ${title}\n\n**Phone:** +${DEFAULT_FROM}\n**Date:** ${date}\n**Total Messages:** ${messages.length}\n\n`;
    md += `## Flag Summary\n- ✅ Pass: ${flags.pass}\n- ❌ Fail: ${flags.fail}\n- 🐛 Bug: ${flags.bug}\n- 🐌 Slow: ${flags.slow}\n\n## Transcript\n\n`;
    messages.forEach(msg => {
      if (msg.role === 'user') {
        md += `**[USER]** ${msg.isButtonTap ? '(Button Tap)' : ''}\n${msg.content}\n\n`;
      } else {
        const agentLabel = msg.metadata?.agentType ? `[AGENT: ${msg.metadata.agentType}]` : '[AGENT]';
        md += `**${agentLabel}**\n${msg.content}\n`;
        if (msg.metadata?.responseTimeMs) md += `> ⏱️ Response Time: ${(msg.metadata.responseTimeMs / 1000).toFixed(2)}s\n`;
        if (msg.metadata?.buttons?.length) md += `> Buttons: ${msg.metadata.buttons.map(b => `[${b.title}]`).join(' ')}\n`;
        if (msg.comment) md += `> 💬 Comment: ${msg.comment}\n`;
        if (msg.flag) { const fi = getFlagInfo(msg.flag); if (fi) md += `> 🏷️ Flag: ${fi.label.toUpperCase()}\n`; }
        md += '\n';
      }
    });
    if (sessionSummary) md += `## Session Notes\n\n${sessionSummary}\n`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `chat-session-${Date.now()}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportAsJSON = () => {
    if (messages.length === 0) { alert('No messages to export'); return; }
    const session = buildSessionPayload(messages, sessionTitle, sessionSummary);
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `chat-session-${Date.now()}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const MOCK_LOCATIONS = [
    { city: 'Jaipur', lat: 26.9124, lng: 75.7873 },
    { city: 'Delhi', lat: 28.6139, lng: 77.2090 },
    { city: 'Mumbai', lat: 19.0760, lng: 72.8777 },
    { city: 'Pune', lat: 18.5204, lng: 73.8567 },
    { city: 'Jodhpur', lat: 26.2389, lng: 73.0243 },
    { city: 'Bangalore', lat: 12.9716, lng: 77.5946 },
  ];

  return (
    <div className="flex-1 flex overflow-hidden bg-slate-50">
      {/* ── Chat Main Area ── */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-200 bg-white z-10">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3 flex-1">
              <div className="w-9 h-9 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-slate-800">Live Chat</h2>
                <p className="text-[10px] text-slate-400 font-mono">WhatsApp Simulate · +{DEFAULT_FROM}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setShowLocationPicker(!showLocationPicker)}
                className={`p-2 rounded-lg border text-xs font-semibold transition-all ${
                  showLocationPicker
                    ? 'bg-sky-50 border-sky-200 text-sky-700'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-200'
                }`}
                title="Share Mock Location"
              >
                <LocateFixed className="w-4 h-4" />
              </button>
              <div className="relative group">
                <button className="p-2 rounded-lg bg-slate-50 hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 border border-slate-200 hover:border-emerald-200 transition-all" title="Export Session">
                  <Download className="w-4 h-4" />
                </button>
                <div className="absolute right-0 mt-2 hidden group-hover:block bg-white border border-slate-200 rounded-xl py-2 whitespace-nowrap z-50 shadow-card-md">
                  <button onClick={exportAsMarkdown} className="w-full text-left px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all">📄 Markdown</button>
                  <button onClick={exportAsJSON} className="w-full text-left px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-all">📋 JSON</button>
                </div>
              </div>
              {/* Auto-save status */}
              {messages.length > 0 && (
                <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${
                  autoSaveStatus === 'saving' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                  autoSaveStatus === 'saved'  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                  autoSaveStatus === 'error'  ? 'bg-red-50 border-red-200 text-red-700' :
                  'bg-slate-50 border-slate-200 text-slate-400'
                }`}>
                  <CloudUpload className="w-3.5 h-3.5" />
                  {autoSaveStatus === 'saving' ? 'Saving...' :
                   autoSaveStatus === 'saved'  ? 'Saved' :
                   autoSaveStatus === 'error'  ? 'Save failed' : 'Auto-saved'}
                </div>
              )}
              <button onClick={handleReset} className="p-2 rounded-lg bg-slate-50 hover:bg-red-50 text-slate-400 hover:text-red-500 border border-slate-200 hover:border-red-200 transition-all" title="Reset Context">
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Session title */}
          {messages.length > 0 && (
            <input
              type="text"
              value={sessionTitle}
              onChange={(e) => setSessionTitle(e.target.value)}
              placeholder="Session Title"
              className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
          )}

          {/* Flag summary */}
          {messages.length > 0 && (() => {
            const flags = getFlagCounts();
            const hasAny = flags.pass > 0 || flags.fail > 0 || flags.bug > 0 || flags.slow > 0;
            const commentCount = getCommentCount();
            return hasAny || commentCount > 0 ? (
              <div className="flex items-center gap-3 mt-2">
                {flags.pass > 0 && <span className="text-[10px] font-semibold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">✅ {flags.pass} Pass</span>}
                {flags.fail > 0 && <span className="text-[10px] font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">❌ {flags.fail} Fail</span>}
                {flags.bug > 0 && <span className="text-[10px] font-semibold text-purple-600 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">🐛 {flags.bug} Bug</span>}
                {flags.slow > 0 && <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">🐌 {flags.slow} Slow</span>}
                {commentCount > 0 && <span className="text-[10px] font-semibold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">💬 {commentCount} Notes</span>}
              </div>
            ) : null;
          })()}
        </div>

        {/* Location Picker */}
        <AnimatePresence>
          {showLocationPicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-slate-200 bg-sky-50"
            >
              <div className="p-4 flex items-center gap-2 flex-wrap">
                <span className="text-[10px] font-bold text-sky-600 mr-2 flex items-center gap-1">
                  <MapPin className="w-3 h-3" /> Share Location:
                </span>
                {MOCK_LOCATIONS.map(loc => (
                  <button
                    key={loc.city}
                    onClick={() => { doShareLocation(loc.city, loc.lat, loc.lng); setShowLocationPicker(false); }}
                    disabled={isLoading}
                    className="px-3 py-1.5 rounded-lg bg-white border border-sky-200 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 active:scale-95 transition-all disabled:opacity-40 shadow-sm"
                  >
                    <Navigation className="w-2.5 h-2.5 inline mr-1" />
                    {loc.city}
                  </button>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Messages */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-6 space-y-5 custom-scrollbar">
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center select-none">
              <div className="w-16 h-16 rounded-2xl bg-orange-50 border border-orange-200 flex items-center justify-center mb-4">
                <Terminal className="w-8 h-8 text-primary opacity-50" />
              </div>
              <p className="text-sm font-semibold text-slate-500 mb-1">Live Chat Simulator</p>
              <p className="text-xs text-slate-400 text-center max-w-xs leading-relaxed mb-8">
                Chat directly with your CZ-AI agent via WhatsApp simulate. Same pipeline as real users.
              </p>
              <div className="grid grid-cols-2 gap-3 max-w-md w-full">
                {[
                  { icon: MapPin, text: 'Show me chargers near Jaipur', color: 'border-sky-200 hover:bg-sky-50 text-sky-700', iconColor: 'text-sky-500' },
                  { icon: Zap, text: 'I want to start a charging session', color: 'border-amber-200 hover:bg-amber-50 text-amber-700', iconColor: 'text-amber-500' },
                  { icon: Wallet, text: 'What is my wallet balance?', color: 'border-emerald-200 hover:bg-emerald-50 text-emerald-700', iconColor: 'text-emerald-500' },
                  { icon: Shield, text: 'There is smoke from the charger!', color: 'border-red-200 hover:bg-red-50 text-red-700', iconColor: 'text-red-500' },
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => doSend(prompt.text)}
                    className={`p-4 rounded-xl border bg-white text-left transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm ${prompt.color}`}
                  >
                    <prompt.icon className={`w-4 h-4 mb-2 ${prompt.iconColor}`} />
                    <p className="text-[11px] font-medium leading-relaxed">{prompt.text}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const agentDisplayInfo = getAgentDisplayInfo(msg.metadata?.agentType);
              const flagInfo = getFlagInfo(msg.flag);
              const isAgent = msg.role === 'agent';
              const responseTimeMs = msg.metadata?.responseTimeMs || 0;
              let timingColor = 'bg-slate-200';
              if (responseTimeMs < 2000) timingColor = 'bg-emerald-400';
              else if (responseTimeMs < 4000) timingColor = 'bg-amber-400';
              else if (responseTimeMs < 6000) timingColor = 'bg-orange-400';
              else timingColor = 'bg-red-400';
              const timingWidth = Math.min((responseTimeMs / 10000) * 100, 100);

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className={`flex gap-3 group ${msg.role === 'agent' ? 'flex-row' : 'flex-row-reverse'}`}
                >
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border ${
                    msg.role === 'agent'
                      ? `${agentDisplayInfo.bg}`
                      : 'bg-primary border-orange-300 text-white'
                  }`}>
                    {msg.role === 'agent'
                      ? <span className="text-sm">{agentDisplayInfo.icon}</span>
                      : <User className="w-4 h-4 text-white" />}
                  </div>

                  <div className={`max-w-[75%] space-y-2 ${msg.role === 'user' ? 'items-end flex flex-col' : ''}`}>
                    {/* Agent type badge */}
                    {isAgent && msg.metadata?.agentType && msg.metadata.agentType !== 'error' && (
                      <div className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border inline-flex items-center gap-1 ${agentDisplayInfo.bg}`}>
                        {agentDisplayInfo.label} Agent
                      </div>
                    )}

                    {/* Meta row */}
                    <div className={`flex items-center gap-2 ${msg.role === 'agent' ? '' : 'flex-row-reverse'}`}>
                      {msg.role === 'user' && (
                        <span className="text-[10px] font-medium text-slate-400">You</span>
                      )}
                      {isAgent && responseTimeMs > 0 && (
                        <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded flex items-center gap-1 ${
                          responseTimeMs > 6000 ? 'bg-red-50 text-red-600 border border-red-200' : 'text-slate-400'
                        }`}>
                          <Clock className="w-2.5 h-2.5" /> {(responseTimeMs / 1000).toFixed(1)}s
                        </span>
                      )}
                      {msg.isButtonTap && (
                        <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-primary border border-orange-200">
                          Button Tap
                        </span>
                      )}
                    </div>

                    {/* Message bubble */}
                    <div className={`p-4 rounded-2xl relative ${
                      msg.role === 'user'
                        ? 'bg-primary text-white rounded-tr-sm shadow-orange'
                        : 'bg-white border border-slate-200 rounded-tl-sm shadow-card text-slate-800'
                    }`}>
                      <div className="text-sm leading-relaxed">
                        {renderWhatsAppText(msg.content, msg.role === 'user')}
                      </div>

                      {/* Response time bar */}
                      {isAgent && responseTimeMs > 0 && (
                        <div className="mt-3 h-1 bg-slate-100 rounded-full overflow-hidden">
                          <div className={`h-full rounded-full transition-all ${timingColor}`} style={{ width: `${timingWidth}%` }} />
                        </div>
                      )}

                      {/* Quick Reply Buttons */}
                      {msg.metadata?.buttons && msg.metadata.buttons.length > 0 && (
                        <div className="mt-4 pt-3 border-t border-slate-100 space-y-2">
                          {msg.metadata.buttons.map((btn, i) => (
                            <button
                              key={i}
                              onClick={() => !isLoading && doButtonTap(btn.id, btn.title)}
                              disabled={isLoading}
                              className="w-full py-2.5 px-4 rounded-xl bg-orange-50 border border-orange-200 text-sm font-semibold text-primary hover:bg-orange-100 hover:border-primary active:scale-[0.98] transition-all cursor-pointer disabled:opacity-30 flex items-center justify-center gap-2"
                            >
                              <ChevronRight className="w-3.5 h-3.5" />
                              {btn.title}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Suggested Actions */}
                      {msg.metadata?.suggestedActions && msg.metadata.suggestedActions.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-2">
                          {msg.metadata.suggestedActions.map((action: any, i: number) => {
                            const label = action.label || action.action || action.text || String(action);
                            return (
                              <button
                                key={i}
                                onClick={() => !isLoading && doSend(label)}
                                disabled={isLoading}
                                className="px-3 py-1.5 rounded-full bg-slate-50 border border-slate-200 text-[10px] text-slate-600 font-semibold hover:bg-slate-100 active:scale-95 transition-all disabled:opacity-30"
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Location Share Prompt */}
                      {isLocationRequest(msg) && (
                        <div className="mt-4 pt-3 border-t border-slate-100">
                          <p className="text-[10px] font-semibold text-sky-600 mb-2 flex items-center gap-1.5">
                            <LocateFixed className="w-3 h-3" /> Quick Location Share
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {MOCK_LOCATIONS.map(loc => (
                              <button
                                key={loc.city}
                                onClick={() => !isLoading && doShareLocation(loc.city, loc.lat, loc.lng)}
                                disabled={isLoading}
                                className="px-3 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-[10px] font-semibold text-sky-700 hover:bg-sky-100 active:scale-95 transition-all disabled:opacity-30"
                              >
                                📍 {loc.city}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Flag badge */}
                    {flagInfo && (
                      <div className={`text-[10px] font-semibold px-2.5 py-1 rounded-full border inline-flex items-center gap-1 ${flagInfo.bg}`}>
                        {flagInfo.icon} {flagInfo.label}
                      </div>
                    )}

                    {/* Hover action toolbar */}
                    <div className={`flex items-start gap-1 opacity-0 group-hover:opacity-100 transition-opacity ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}>
                      {isAgent && (
                        <div className="flex items-center gap-1 bg-white border border-slate-200 rounded-xl px-2 py-1.5 shadow-card">
                          <button
                            onClick={() => setEditingComment(msg.id === editingComment ? null : msg.id)}
                            className="p-1 rounded-lg hover:bg-sky-50 text-slate-400 hover:text-sky-600 transition-all"
                            title="Add/edit comment"
                          >
                            <MessageSquareText className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleFlag(msg.id, 'pass')}
                            className={`p-1 rounded-lg transition-all ${msg.flag === 'pass' ? 'bg-emerald-50 text-emerald-600' : 'text-slate-400 hover:bg-emerald-50 hover:text-emerald-600'}`}
                            title="Mark as Pass"
                          >
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleFlag(msg.id, 'fail')}
                            className={`p-1 rounded-lg transition-all ${msg.flag === 'fail' ? 'bg-red-50 text-red-600' : 'text-slate-400 hover:bg-red-50 hover:text-red-600'}`}
                            title="Mark as Fail"
                          >
                            <XCircle className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleFlag(msg.id, 'bug')}
                            className={`p-1 rounded-lg transition-all ${msg.flag === 'bug' ? 'bg-purple-50 text-purple-600' : 'text-slate-400 hover:bg-purple-50 hover:text-purple-600'}`}
                            title="Mark as Bug"
                          >
                            <Bug className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => toggleFlag(msg.id, 'slow')}
                            className={`p-1 rounded-lg transition-all ${msg.flag === 'slow' ? 'bg-amber-50 text-amber-600' : 'text-slate-400 hover:bg-amber-50 hover:text-amber-600'}`}
                            title="Mark as Slow"
                          >
                            <Timer className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Comment edit / display */}
                    {editingComment === msg.id ? (
                      <div className="mt-1 flex gap-1.5">
                        <input
                          type="text" autoFocus value={commentInput}
                          onChange={(e) => setCommentInput(e.target.value)}
                          placeholder="Add comment..."
                          className="flex-1 bg-amber-50 border border-amber-200 rounded-lg px-3 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-300"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveComment(msg.id, commentInput);
                            else if (e.key === 'Escape') setEditingComment(null);
                          }}
                        />
                        <button onClick={() => saveComment(msg.id, commentInput)} className="px-2.5 py-1.5 rounded-lg bg-amber-100 hover:bg-amber-200 text-amber-700 border border-amber-200 text-xs font-bold">
                          ✓
                        </button>
                      </div>
                    ) : msg.comment ? (
                      <div className="mt-1 p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-xs text-amber-800">
                        💬 {msg.comment}
                      </div>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Loading indicator */}
          {isLoading && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex gap-3">
              <div className="w-8 h-8 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
                <Bot className="w-4 h-4 text-emerald-500 animate-pulse" />
              </div>
              <div className="flex items-center gap-2 py-2 px-4 bg-white rounded-2xl rounded-tl-sm border border-slate-200 shadow-card">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      animate={{ y: [0, -4, 0] }}
                      transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.12 }}
                      className="w-1.5 h-1.5 rounded-full bg-primary"
                    />
                  ))}
                </div>
                <span className="text-[11px] text-slate-400 italic">Agent is thinking...</span>
              </div>
            </motion.div>
          )}

          {/* Session notes */}
          {messages.length >= 2 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
              className="mt-6 p-4 rounded-2xl bg-white border border-slate-200 shadow-card"
            >
              <p className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2 flex items-center gap-1.5">
                📝 Session Notes
              </p>
              <textarea
                value={sessionSummary}
                onChange={(e) => setSessionSummary(e.target.value)}
                placeholder="Write your observations, notes, or summary of this session..."
                className="w-full bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all resize-none"
                rows={4}
              />
            </motion.div>
          )}
        </div>

        {/* Input Area */}
        <div className="p-4 border-t border-slate-200 bg-white">
          <div className="max-w-4xl mx-auto relative">
            <input
              type="text" value={inputValue}
              onChange={e => setInputValue(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleSend()}
              placeholder="Type a message..."
              className="w-full bg-slate-50 border border-slate-200 rounded-2xl py-3.5 pl-5 pr-14 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary transition-all"
            />
            <button
              onClick={handleSend} disabled={!inputValue.trim() || isLoading}
              className={`absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 rounded-xl flex items-center justify-center transition-all ${
                inputValue.trim() && !isLoading
                  ? 'bg-primary text-white shadow-orange hover:scale-105 active:scale-95'
                  : 'bg-slate-100 text-slate-400'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ── System Context Sidebar ── */}
      <div className="w-72 border-l border-slate-200 bg-slate-50 hidden xl:flex flex-col overflow-hidden">
        <div className="p-5 border-b border-slate-200 bg-white">
          <h3 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-4 flex items-center gap-2">
            <Shield className="w-3.5 h-3.5" /> Session Info
          </h3>
          <div className="space-y-3">
            <div className="p-3.5 rounded-xl bg-orange-50 border border-orange-200">
              <p className="text-[9px] font-semibold text-slate-500 uppercase mb-1">Simulated User</p>
              <p className="text-sm font-bold text-slate-800">{systemContext?.name || DEFAULT_NAME}</p>
              <div className="mt-2 flex items-center gap-2">
                <div className="px-2 py-0.5 rounded-full bg-emerald-100 border border-emerald-200 text-[9px] font-bold text-emerald-700">ACTIVE</div>
                <div className="text-[9px] text-slate-400 font-mono">+{DEFAULT_FROM}</div>
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-sm">
              <p className="text-[9px] font-semibold text-slate-500 uppercase mb-1">Wallet Balance</p>
              <div className="flex items-end gap-2">
                <p className="text-xl font-black text-primary">₹{systemContext?.walletBalance ?? '—'}</p>
                <Wallet className="w-4 h-4 text-orange-300 mb-1" />
              </div>
            </div>
            <div className="p-3.5 rounded-xl bg-white border border-slate-200 shadow-sm">
              <p className="text-[9px] font-semibold text-slate-500 uppercase mb-2">Vehicles</p>
              <div className="space-y-2">
                {(systemContext?.vehicles || []).map((v: any) => (
                  <div key={v.id} className="flex items-center justify-between group cursor-default">
                    <div className="flex items-center gap-2">
                      <Zap className="w-3 h-3 text-emerald-400" />
                      <span className="text-xs text-slate-700 font-medium">{v.nickname || v.model}</span>
                    </div>
                    <ArrowRight className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-all" />
                  </div>
                ))}
                {!systemContext?.vehicles?.length && <p className="text-[10px] italic text-slate-400">None registered</p>}
              </div>
            </div>
          </div>
        </div>
        <div className="flex-1 p-5 overflow-y-auto custom-scrollbar">
          <h4 className="text-[10px] font-bold uppercase tracking-widest text-slate-500 mb-3">Message Stats</h4>
          <div className="space-y-2">
            {[
              { label: 'Total Messages', value: messages.length },
              { label: 'Agent Responses', value: messages.filter(m => m.role === 'agent').length },
              { label: 'Avg Response', value: (() => {
                const times = messages.filter(m => m.metadata?.responseTimeMs).map(m => m.metadata!.responseTimeMs!);
                return times.length ? `${(times.reduce((a, b) => a + b, 0) / times.length / 1000).toFixed(1)}s` : '—';
              })() },
            ].map(stat => (
              <div key={stat.label} className="flex items-center justify-between p-3 rounded-xl bg-white border border-slate-200 shadow-sm">
                <span className="text-[10px] text-slate-500">{stat.label}</span>
                <span className="text-xs font-bold text-slate-800">{stat.value}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

export default ManualChatView;
