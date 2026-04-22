import React, { useState, useEffect, useRef } from 'react';
import {
  Send, Bot, User,
  MapPin, Shield, Zap,
  ChevronRight, ArrowRight, Wallet,
  LocateFixed, MessageSquare, Navigation,
  MessageSquareText, CheckCircle2, XCircle, Bug, Timer,
  Download, CloudUpload, X, FileText, Code2, RefreshCw,
  Activity, Sparkles, BookOpen, Search, FlaskConical,
  Copy, Check, ChevronDown, AlertTriangle,
  Layers, PlayCircle, Hash, PanelRight, Tag, Star, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useDashboard } from '../store/DashboardContext';
import { fetchQuestionBank, type QuestionBankItem } from '../api';

// ─── Config ──────────────────────────────────────────────────────────────────
const SIMULATE_URL = 'https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate';
const SESSIONS_API = '/api/arena/chat-sessions';

// ─── User Profiles ────────────────────────────────────────────────────────────
const USER_PROFILES = {
  default:    { name: 'Test QA User',   from: '918000363019', label: 'Default Tester',      desc: 'Standard test account',          badge: '🧪', colorKey: 'orange'  },
  registered: { name: 'Riya Sharma',    from: '919876543210', label: 'Registered User',     desc: 'Has wallet & EV registered',     badge: '✅', colorKey: 'emerald' },
  newUser:    { name: 'Arjun Mehta',    from: '919111222333', label: 'New / Unregistered',  desc: 'No account, first-time user',    badge: '🆕', colorKey: 'sky'     },
  midSession: { name: 'Vikram Patel',   from: '919444555666', label: 'Mid-Session User',    desc: 'Has an active charging session', badge: '⚡', colorKey: 'amber'   },
  custom:     { name: '',               from: '',             label: 'Custom',              desc: 'Enter your own name & number',   badge: '✏️', colorKey: 'purple'  },
} as const;
type ProfileKey = keyof typeof USER_PROFILES;

const PROFILE_PALETTE: Record<string, { bg: string; border: string; text: string; pill: string; ring: string }> = {
  orange:  { bg: 'bg-orange-50',  border: 'border-orange-200', text: 'text-orange-700',  pill: 'bg-orange-100 text-orange-700 border-orange-200',  ring: 'ring-orange-300'  },
  emerald: { bg: 'bg-emerald-50', border: 'border-emerald-200',text: 'text-emerald-700', pill: 'bg-emerald-100 text-emerald-700 border-emerald-200',ring: 'ring-emerald-300' },
  sky:     { bg: 'bg-sky-50',     border: 'border-sky-200',    text: 'text-sky-700',     pill: 'bg-sky-100 text-sky-700 border-sky-200',            ring: 'ring-sky-300'     },
  amber:   { bg: 'bg-amber-50',   border: 'border-amber-200',  text: 'text-amber-700',   pill: 'bg-amber-100 text-amber-700 border-amber-200',      ring: 'ring-amber-300'   },
  purple:  { bg: 'bg-purple-50',  border: 'border-purple-200', text: 'text-purple-700',  pill: 'bg-purple-100 text-purple-700 border-purple-200',   ring: 'ring-purple-300'  },
};

// ─── Scenario Tags ────────────────────────────────────────────────────────────
const SCENARIO_TAGS = [
  'Happy Path', 'Wallet Flow', 'Emergency / Fault', 'Location Discovery',
  'New User Registration', 'Session Start / Stop', 'RFID / QR Code',
  'Refund Flow', 'Edge Case', 'Regression',
];

// ─── API helpers ──────────────────────────────────────────────────────────────
async function apiSaveSession(session: ChatSession): Promise<void> {
  const res = await fetch(SESSIONS_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(session),
  });
  if (!res.ok) throw new Error(`Save failed: ${res.status} ${await res.text()}`);
}

// ─── Interfaces ───────────────────────────────────────────────────────────────
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
  scenarioTag?: string;
  testerProfile?: string;
}

// ─── sendToAgent ──────────────────────────────────────────────────────────────
async function sendToAgent(params: {
  message?: string;
  buttonReplyId?: string;
  buttonTitle?: string;
  location?: { latitude: number; longitude: number; name?: string; address?: string };
  from: string;
  name: string;
}) {
  const res = await fetch(SIMULATE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from: params.from,
      message: params.message,
      buttonReplyId: params.buttonReplyId,
      buttonTitle: params.buttonTitle,
      location: params.location,
      name: params.name,
    }),
  });
  if (!res.ok) throw new Error(`Agent returned ${res.status}: ${res.statusText}`);
  return await res.json();
}

// ─── WhatsApp Markdown Renderer ───────────────────────────────────────────────
function renderWhatsAppText(text: string, isUser = false) {
  return text.split('\n').map((line, lineIdx) => {
    const parts: React.ReactNode[] = [];
    let remaining = line;
    let partKey = 0;
    const regex = /(\*([^*]+)\*)|(_([^_]+)_)|(~([^~]+)~)|(```([^`]+)```)/g;
    let lastIndex = 0;
    let match;
    while ((match = regex.exec(remaining)) !== null) {
      if (match.index > lastIndex) parts.push(<span key={partKey++}>{remaining.slice(lastIndex, match.index)}</span>);
      if (match[2]) parts.push(<strong key={partKey++} className={`font-bold ${isUser ? 'text-white' : 'text-slate-900'}`}>{match[2]}</strong>);
      else if (match[4]) parts.push(<em key={partKey++} className={`italic ${isUser ? 'text-orange-100' : 'text-slate-500'}`}>{match[4]}</em>);
      else if (match[6]) parts.push(<span key={partKey++} className="line-through opacity-60">{match[6]}</span>);
      else if (match[8]) parts.push(<code key={partKey++} className={`px-1.5 py-0.5 rounded text-[11px] font-mono ${isUser ? 'bg-white/20 text-orange-50' : 'bg-slate-100 text-emerald-700'}`}>{match[8]}</code>);
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < remaining.length) parts.push(<span key={partKey++}>{remaining.slice(lastIndex)}</span>);
    if (parts.length === 0) parts.push(<span key={0}>{line}</span>);
    return (
      <React.Fragment key={lineIdx}>
        {lineIdx > 0 && <br />}
        {parts}
      </React.Fragment>
    );
  });
}

// ─── Agent type metadata ──────────────────────────────────────────────────────
const AGENT_META: Record<string, { icon: string; label: string; color: string; dot: string }> = {
  discovery:    { icon: '🔍', label: 'Discovery',    color: 'bg-sky-50 border-sky-200 text-sky-700',       dot: 'bg-sky-400' },
  session:      { icon: '⚡', label: 'Session',      color: 'bg-amber-50 border-amber-200 text-amber-700',  dot: 'bg-amber-400' },
  payment:      { icon: '💳', label: 'Payment',      color: 'bg-emerald-50 border-emerald-200 text-emerald-700', dot: 'bg-emerald-400' },
  support:      { icon: '🎧', label: 'Support',      color: 'bg-violet-50 border-violet-200 text-violet-700', dot: 'bg-violet-400' },
  faq:          { icon: '📖', label: 'FAQ',          color: 'bg-orange-50 border-orange-200 text-orange-700', dot: 'bg-orange-400' },
  registration: { icon: '👤', label: 'Registration', color: 'bg-cyan-50 border-cyan-200 text-cyan-700',     dot: 'bg-cyan-400' },
  error:        { icon: '❌', label: 'Error',        color: 'bg-red-50 border-red-200 text-red-700',        dot: 'bg-red-400' },
};

function getAgentMeta(agentType?: string) {
  if (!agentType) return { icon: '🤖', label: 'Agent', color: 'bg-slate-100 border-slate-200 text-slate-600', dot: 'bg-slate-400' };
  return AGENT_META[agentType.toLowerCase()] ?? { icon: '🤖', label: agentType, color: 'bg-slate-100 border-slate-200 text-slate-600', dot: 'bg-slate-400' };
}

const ALL_AGENT_TYPES = Object.keys(AGENT_META).filter(k => k !== 'error');

// ─── Question category ────────────────────────────────────────────────────────
const QCAT: Record<string, { bg: string; text: string; dot: string }> = {
  charging:     { bg: 'bg-amber-50',   text: 'text-amber-700',  dot: 'bg-amber-400' },
  payment:      { bg: 'bg-emerald-50', text: 'text-emerald-700',dot: 'bg-emerald-400' },
  registration: { bg: 'bg-cyan-50',    text: 'text-cyan-700',   dot: 'bg-cyan-400' },
  fault:        { bg: 'bg-red-50',     text: 'text-red-700',    dot: 'bg-red-400' },
  support:      { bg: 'bg-violet-50',  text: 'text-violet-700', dot: 'bg-violet-400' },
  account:      { bg: 'bg-blue-50',    text: 'text-blue-700',   dot: 'bg-blue-400' },
  general:      { bg: 'bg-slate-50',   text: 'text-slate-600',  dot: 'bg-slate-400' },
};

function qCat(q: string) {
  const t = q.toLowerCase();
  if (/charg|session|kwh|ac\b|dc\b|plug|ev station/i.test(t)) return 'charging';
  if (/pay|wallet|money|refund|bill|invoice|transaction|₹/i.test(t)) return 'payment';
  if (/register|sign.?up|account|creat|onboard/i.test(t)) return 'registration';
  if (/fault|error|smoke|smell|damage|broken|not.work/i.test(t)) return 'fault';
  if (/help|support|contact|number|24.7|helpline/i.test(t)) return 'support';
  if (/profile|phone|name|password|login|otp/i.test(t)) return 'account';
  return 'general';
}

// ─── Built-in Questions ───────────────────────────────────────────────────────
const BUILTIN_QUESTIONS = [
  { text: 'Show me ChargeZone stations near Jaipur', icon: '📍' },
  { text: 'How do I start a charging session?', icon: '⚡' },
  { text: 'What is my current wallet balance?', icon: '💳' },
  { text: 'My RFID card is not working at the charger', icon: '🔴' },
  { text: 'The charger stopped automatically before my car was full', icon: '⚠️' },
  { text: 'I paid but charging did not start. Where is my money?', icon: '🆘' },
  { text: 'How do I add ₹500 to my ChargeZone wallet?', icon: '💰' },
  { text: 'Can I get an invoice for my last charging session?', icon: '🧾' },
  { text: 'How do I register my Nexon EV on the app?', icon: '🚗' },
  { text: 'There is a burning smell from the charger near me', icon: '🔥' },
  { text: 'How long will it take to charge from 20% to 80%?', icon: '🕐' },
  { text: 'Does ChargeZone have stations on Delhi-Jaipur highway?', icon: '🛣️' },
  { text: 'The QR code on the charger is damaged and not scanning', icon: '📷' },
  { text: 'How do I update my registered mobile number?', icon: '📱' },
  { text: 'Can I share my ChargeZone account with my wife?', icon: '👥' },
  { text: 'What is the per unit electricity rate at your DC chargers?', icon: '💡' },
  { text: 'My session shows completed but my car battery is at 30%', icon: '🔋' },
  { text: 'I need a refund for a failed transaction from yesterday', icon: '↩️' },
  { text: 'The app shows charger is available but someone is using it', icon: '🔄' },
  { text: 'How do I report a damaged or vandalized charger?', icon: '📢' },
];

// ─── Agent Timeline sub-component ─────────────────────────────────────────────
const AgentTimeline: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const relevant = messages.filter(m => m.role === 'agent' && m.metadata?.agentType && m.metadata.agentType !== 'error');
  if (!relevant.length) return (
    <p className="text-[10px] italic text-slate-400 px-1">No agent turns yet</p>
  );

  // Collapse consecutive same-type runs
  const seq: { type: string; count: number }[] = [];
  for (const m of relevant) {
    const t = m.metadata!.agentType!.toLowerCase();
    if (!seq.length || seq[seq.length - 1].type !== t) seq.push({ type: t, count: 1 });
    else seq[seq.length - 1].count++;
  }

  return (
    <div className="flex items-center gap-1 flex-wrap">
      {seq.map((item, i) => {
        const meta = getAgentMeta(item.type);
        return (
          <React.Fragment key={i}>
            <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-[9px] font-bold ${meta.color}`}>
              <span>{meta.icon}</span>
              <span>{meta.label}</span>
              {item.count > 1 && <span className="opacity-60">×{item.count}</span>}
            </div>
            {i < seq.length - 1 && <ChevronRight className="w-2.5 h-2.5 text-slate-300 shrink-0" />}
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ─── Test Coverage sub-component ─────────────────────────────────────────────
const TestCoverage: React.FC<{ messages: Message[] }> = ({ messages }) => {
  const hit = new Set(
    messages
      .filter(m => m.role === 'agent' && m.metadata?.agentType)
      .map(m => m.metadata!.agentType!.toLowerCase())
  );
  const hitCount = ALL_AGENT_TYPES.filter(t => hit.has(t)).length;
  const pct = Math.round((hitCount / ALL_AGENT_TYPES.length) * 100);

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[9px] text-slate-400 font-semibold uppercase tracking-wider">Agent coverage</span>
        <span className="text-[10px] font-black text-slate-700">{hitCount}/{ALL_AGENT_TYPES.length} <span className="font-normal text-slate-400">({pct}%)</span></span>
      </div>
      <div className="flex items-center gap-1 flex-wrap">
        {ALL_AGENT_TYPES.map(t => {
          const meta = getAgentMeta(t);
          const active = hit.has(t);
          return (
            <div
              key={t}
              title={`${meta.label}${active ? ' — triggered' : ' — not yet triggered'}`}
              className={`flex items-center gap-1 px-1.5 py-0.5 rounded-md border text-[9px] font-semibold transition-all ${
                active ? meta.color : 'bg-slate-50 border-slate-200 text-slate-300'
              }`}
            >
              <span className={`text-[10px] ${active ? '' : 'grayscale opacity-40'}`}>{meta.icon}</span>
              <span>{meta.label}</span>
            </div>
          );
        })}
      </div>
      <div className="mt-2 h-1.5 rounded-full bg-slate-100 overflow-hidden">
        <div
          className="h-full rounded-full bg-gradient-to-r from-orange-400 to-orange-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
};

// ─── Profile Picker sub-component ─────────────────────────────────────────────
const ProfilePickerModal: React.FC<{
  profileKey: ProfileKey;
  customFrom: string;
  customName: string;
  onSelect: (key: ProfileKey) => void;
  onCustomChange: (from: string, name: string) => void;
  onClose: () => void;
}> = ({ profileKey, customFrom, customName, onSelect, onCustomChange, onClose }) => (
  <motion.div
    initial={{ opacity: 0, y: -8, scale: 0.96 }}
    animate={{ opacity: 1, y: 0, scale: 1 }}
    exit={{ opacity: 0, y: -8, scale: 0.96 }}
    transition={{ type: 'spring', stiffness: 400, damping: 30 }}
    className="absolute left-0 top-full mt-2 bg-white border border-slate-200 rounded-2xl shadow-xl py-2 z-50 w-72"
    role="dialog"
    aria-label="Select test user profile"
  >
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 px-4 pt-1 pb-2">Test User Profile</p>
    {(Object.keys(USER_PROFILES) as ProfileKey[]).map(key => {
      const p = USER_PROFILES[key];
      const active = profileKey === key;
      return (
        <button
          key={key}
          onClick={() => { onSelect(key); if (key !== 'custom') onClose(); }}
          className={`w-full flex items-center gap-3 px-4 py-2.5 text-left transition-all hover:bg-slate-50 ${active ? 'bg-slate-50' : ''}`}
        >
          <span className="text-base shrink-0 w-6 text-center">{p.badge}</span>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold text-slate-800">{p.label}</p>
            <p className="text-[10px] text-slate-400 truncate">{p.desc}</p>
          </div>
          {active && <Check className="w-3.5 h-3.5 text-orange-500 shrink-0" />}
        </button>
      );
    })}
    {profileKey === 'custom' && (
      <div className="px-4 pt-2 pb-1 space-y-2 border-t border-slate-100 mt-1">
        <input
          type="text"
          value={customName}
          onChange={e => onCustomChange(customFrom, e.target.value)}
          placeholder="Display name…"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-200 transition-all"
        />
        <input
          type="text"
          value={customFrom}
          onChange={e => onCustomChange(e.target.value, customName)}
          placeholder="Phone number (e.g. 919876543210)…"
          className="w-full bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-mono text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-purple-200 transition-all"
        />
        <button
          onClick={onClose}
          className="w-full py-2 rounded-xl bg-purple-100 text-purple-700 text-xs font-bold border border-purple-200 hover:bg-purple-200 transition-all"
        >
          Use Custom Profile
        </button>
      </div>
    )}
  </motion.div>
);

// ─── Reset Confirmation Modal ─────────────────────────────────────────────────
const ResetModal: React.FC<{
  messageCount: number;
  autoSaveStatus: string;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({ messageCount, autoSaveStatus, onConfirm, onCancel }) => (
  <motion.div
    initial={{ opacity: 0 }}
    animate={{ opacity: 1 }}
    exit={{ opacity: 0 }}
    className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    onClick={onCancel}
  >
    <motion.div
      initial={{ scale: 0.9, y: 20 }}
      animate={{ scale: 1, y: 0 }}
      exit={{ scale: 0.9, y: 20 }}
      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
      onClick={e => e.stopPropagation()}
      className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full"
      role="dialog"
      aria-label="Confirm reset"
    >
      <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6 text-red-500" />
      </div>
      <h3 className="text-sm font-bold text-slate-800 mb-1.5">Reset this session?</h3>
      <p className="text-xs text-slate-500 leading-relaxed mb-1">
        This will clear <span className="font-semibold text-slate-700">{messageCount} message{messageCount !== 1 ? 's' : ''}</span> and reset the agent conversation context.
      </p>
      {autoSaveStatus !== 'saved' && autoSaveStatus !== 'idle' && (
        <p className="text-[10px] text-amber-600 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-3 mt-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3 h-3 shrink-0" /> Session may not be fully saved yet.
        </p>
      )}
      <div className="flex gap-2 mt-4">
        <button
          onClick={onCancel}
          className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 hover:bg-slate-200 transition-all"
        >
          Cancel
        </button>
        <button
          onClick={onConfirm}
          className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-all shadow-sm"
        >
          Reset Session
        </button>
      </div>
    </motion.div>
  </motion.div>
);

// ─── Main Component ───────────────────────────────────────────────────────────
const ManualChatView: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [systemContext, setSystemContext] = useState<any>(null);
  const [showLocationPicker, setShowLocationPicker] = useState(false);
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [sessionTitle, setSessionTitle] = useState('');
  const [sessionSummary, setSessionSummary] = useState('');
  const [autoSaveStatus, setAutoSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [editingComment, setEditingComment] = useState<string | null>(null);
  const [commentInput, setCommentInput] = useState('');
  const [rightPanel, setRightPanel] = useState<'session' | 'questions'>('session');
  const [questionSearch, setQuestionSearch] = useState('');
  const [bankQuestions, setBankQuestions] = useState<QuestionBankItem[]>([]);
  const [bankLoading, setBankLoading] = useState(false);

  // ── New state ─────────────────────────────────────────────────────────────
  const [profileKey, setProfileKey] = useState<ProfileKey>('default');
  const [customFrom, setCustomFrom] = useState('');
  const [customName, setCustomName] = useState('');
  const [showProfilePicker, setShowProfilePicker] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [scenarioTag, setScenarioTag] = useState('');
  const [showScenarioDropdown, setShowScenarioDropdown] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [inputHighlight, setInputHighlight] = useState(false);
  const [showSidePanel, setShowSidePanel] = useState(true);

  const { pinnedQuestions, setView } = useDashboard();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef(`chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`);
  const exportMenuRef = useRef<HTMLDivElement>(null);
  const profilePickerRef = useRef<HTMLDivElement>(null);
  const scenarioRef = useRef<HTMLDivElement>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Derived: active profile ───────────────────────────────────────────────
  const activeProfile = profileKey === 'custom'
    ? { from: customFrom || '918000363019', name: customName || 'QA Tester' }
    : { from: USER_PROFILES[profileKey].from, name: USER_PROFILES[profileKey].name };

  const profileMeta = USER_PROFILES[profileKey];
  const profilePal = PROFILE_PALETTE[profileMeta.colorKey];

  // ── Derived: stats ────────────────────────────────────────────────────────
  const agentMessages = messages.filter(m => m.role === 'agent');
  const errorMsgCount = agentMessages.filter(m => m.metadata?.agentType === 'error').length;
  const buttonTapCount = messages.filter(m => m.isButtonTap).length;
  const responseTimes = agentMessages.map(m => m.metadata?.responseTimeMs || 0).filter(t => t > 0);
  const avgResponseMs = responseTimes.length
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length : 0;
  const minResponseMs = responseTimes.length ? Math.min(...responseTimes) : 0;
  const maxResponseMs = responseTimes.length ? Math.max(...responseTimes) : 0;
  const flagCounts = messages.reduce(
    (acc, msg) => {
      if (msg.flag === 'pass') acc.pass++;
      else if (msg.flag === 'fail') acc.fail++;
      else if (msg.flag === 'bug') acc.bug++;
      else if (msg.flag === 'slow') acc.slow++;
      return acc;
    }, { pass: 0, fail: 0, bug: 0, slow: 0 }
  );
  const unreviewedCount = agentMessages.filter(m => !m.flag && m.metadata?.agentType !== 'error').length;
  const commentCount = messages.filter(msg => msg.comment && msg.comment.trim()).length;
  const hasFlagActivity = flagCounts.pass > 0 || flagCounts.fail > 0 || flagCounts.bug > 0 || flagCounts.slow > 0 || commentCount > 0;

  // ── Load question bank when panel opens ──────────────────────────────────
  useEffect(() => {
    if (rightPanel !== 'questions') return;
    setBankLoading(true);
    fetchQuestionBank()
      .then(items => setBankQuestions(items))
      .catch(() => setBankQuestions([]))
      .finally(() => setBankLoading(false));
  }, [rightPanel]);

  // ── Questions ─────────────────────────────────────────────────────────────
  // Merge: DB questions first, then fallback to built-ins if bank is empty
  const pinnedSet = new Set(pinnedQuestions);
  const baseQuestions: { text: string; icon: string; isPinned: boolean; source?: string }[] =
    bankQuestions.length > 0
      ? bankQuestions.map(q => ({ text: q.text, icon: '💬', isPinned: pinnedSet.has(q.text), source: q.source }))
      : BUILTIN_QUESTIONS.map(q => ({ ...q, isPinned: pinnedSet.has(q.text), source: 'builtin' }));

  // Sort: pinned first, then rest
  const sortedQuestions = [
    ...baseQuestions.filter(q => q.isPinned),
    ...baseQuestions.filter(q => !q.isPinned),
  ];

  const filteredQuestions = sortedQuestions.filter(q =>
    !questionSearch || q.text.toLowerCase().includes(questionSearch.toLowerCase())
  );

  // ── Scroll on new messages ────────────────────────────────────────────────
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, isLoading]);

  // ── Auto-set session title ────────────────────────────────────────────────
  useEffect(() => {
    if (messages.length > 0 && !sessionTitle) {
      const date = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      setSessionTitle(`${scenarioTag ? `[${scenarioTag}] ` : ''}Manual Test - ${date}`);
    }
  }, [messages, sessionTitle, scenarioTag]);

  // ── Close dropdowns on outside click ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (exportMenuRef.current && !exportMenuRef.current.contains(e.target as Node)) setShowExportMenu(false);
      if (profilePickerRef.current && !profilePickerRef.current.contains(e.target as Node)) setShowProfilePicker(false);
      if (scenarioRef.current && !scenarioRef.current.contains(e.target as Node)) setShowScenarioDropdown(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Debounced auto-save ────────────────────────────────────────────────────
  useEffect(() => {
    if (isLoading || messages.length === 0) return;
    const lastMsg = messages[messages.length - 1];
    if (lastMsg.role !== 'agent') return;

    if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = setTimeout(() => {
      const payload = buildSessionPayload(messages, sessionTitle, sessionSummary);
      setAutoSaveStatus('saving');
      apiSaveSession(payload)
        .then(() => {
          setAutoSaveStatus('saved');
          setTimeout(() => setAutoSaveStatus('idle'), 2500);
        })
        .catch(err => {
          console.error('[AutoSave] failed:', err);
          setAutoSaveStatus('error');
          // Keep the error visible — don't auto-clear so QA notices
        });
    }, 1500);

    return () => { if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isLoading]);

  // ── processResponse ───────────────────────────────────────────────────────
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

  // ── Send message ──────────────────────────────────────────────────────────
  const doSend = async (text: string) => {
    if (!text.trim() || isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    try {
      const data = await sendToAgent({ message: text, from: activeProfile.from, name: activeProfile.name });
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

  // ── Button tap ────────────────────────────────────────────────────────────
  const doButtonTap = async (buttonId: string, buttonLabel: string) => {
    if (isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: buttonLabel, timestamp: new Date(), isButtonTap: true };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    try {
      const data = await sendToAgent({ buttonReplyId: buttonId, buttonTitle: buttonLabel, from: activeProfile.from, name: activeProfile.name });
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

  // ── Location share ────────────────────────────────────────────────────────
  const doShareLocation = async (city: string, lat: number, lng: number) => {
    if (isLoading) return;
    const userMessage: Message = { id: Date.now().toString(), role: 'user', content: `📍 Shared location: ${city}`, timestamp: new Date() };
    setMessages(prev => [...prev, userMessage]);
    setShowLocationPicker(false);
    setIsLoading(true);
    try {
      const data = await sendToAgent({ message: '', location: { latitude: lat, longitude: lng, name: city, address: city }, from: activeProfile.from, name: activeProfile.name });
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

  // ── Reset ─────────────────────────────────────────────────────────────────
  const handleReset = async () => {
    try {
      await fetch('https://api.aiagent.dev.chargecloud.net/api/arena/chat/reset', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: activeProfile.from, sessionId: `whatsapp:${activeProfile.from}` })
      });
    } catch (err) { console.error('Reset failed:', err); }
    setMessages([]);
    setSystemContext(null);
    setSessionTitle('');
    setSessionSummary('');
    setScenarioTag('');
    setShowResetModal(false);
    sessionIdRef.current = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  };

  // ── Flag / comment helpers ────────────────────────────────────────────────
  const toggleFlag = (messageId: string, newFlag: 'pass' | 'fail' | 'bug' | 'slow') => {
    setMessages(prev => prev.map(msg =>
      msg.id === messageId ? { ...msg, flag: msg.flag === newFlag ? null : newFlag } : msg
    ));
  };

  const bulkMarkPass = () => {
    setMessages(prev => prev.map(msg =>
      msg.role === 'agent' && !msg.flag && msg.metadata?.agentType !== 'error'
        ? { ...msg, flag: 'pass' as const }
        : msg
    ));
  };

  const saveComment = (messageId: string, commentText: string) => {
    setMessages(prev => prev.map(msg => msg.id === messageId ? { ...msg, comment: commentText } : msg));
    setEditingComment(null);
    setCommentInput('');
  };

  // ── Copy message ──────────────────────────────────────────────────────────
  const copyMessage = async (msgId: string, content: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(msgId);
      setTimeout(() => setCopiedId(null), 2000);
    } catch {}
  };

  // ── isLocationRequest ─────────────────────────────────────────────────────
  const isLocationRequest = (msg: Message) => {
    if (msg.role !== 'agent') return false;
    const lower = msg.content.toLowerCase();
    return lower.includes('share your current location') || lower.includes('share your location') ||
           lower.includes('📎') || msg.metadata?.data?.requestLocationShare === true ||
           msg.metadata?.data?.suggestLocationShare === true;
  };

  // ── Build session payload ─────────────────────────────────────────────────
  const buildSessionPayload = (msgs: Message[], title: string, summary: string): ChatSession => {
    const aMessages = msgs.filter(m => m.role === 'agent');
    const rts = aMessages.map(m => m.metadata?.responseTimeMs || 0).filter(t => t > 0);
    const avgRt = rts.length ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
    const agentTypesUsed = Array.from(new Set(aMessages.map(m => m.metadata?.agentType).filter(Boolean))) as string[];
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
      from: activeProfile.from,
      totalMessages: msgs.length, totalAgentMessages: aMessages.length,
      avgResponseTimeMs: avgRt, agentTypesUsed, flags,
      messages: msgs.map(msg => ({
        id: msg.id, role: msg.role, content: msg.content,
        timestamp: msg.timestamp.toISOString(), isButtonTap: msg.isButtonTap,
        metadata: msg.metadata, comment: msg.comment, flag: msg.flag || null,
      })),
      summary: summary || undefined,
      scenarioTag: scenarioTag || undefined,
      testerProfile: profileKey,
    };
  };

  // ── Export ────────────────────────────────────────────────────────────────
  const exportAsMarkdown = () => {
    if (messages.length === 0) return;
    const date = new Date().toLocaleDateString();
    const title = sessionTitle || `Manual Test - ${date}`;
    let md = `# ${title}\n\n`;
    md += `**Session ID:** \`${sessionIdRef.current}\`\n`;
    md += `**Phone:** +${activeProfile.from}  **Tester:** ${activeProfile.name}\n`;
    if (scenarioTag) md += `**Scenario:** ${scenarioTag}\n`;
    md += `**Date:** ${date}  **Total Messages:** ${messages.length}\n\n`;
    md += `## Flag Summary\n- ✅ Pass: ${flagCounts.pass}\n- ❌ Fail: ${flagCounts.fail}\n- 🐛 Bug: ${flagCounts.bug}\n- 🐌 Slow: ${flagCounts.slow}\n\n## Transcript\n\n`;
    messages.forEach(msg => {
      const ts = msg.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      if (msg.role === 'user') {
        md += `**[USER ${ts}]** ${msg.isButtonTap ? '(Button Tap)' : ''}\n${msg.content}\n\n`;
      } else {
        const agentLabel = msg.metadata?.agentType ? `[AGENT:${msg.metadata.agentType} ${ts}]` : `[AGENT ${ts}]`;
        md += `**${agentLabel}**\n${msg.content}\n`;
        if (msg.metadata?.responseTimeMs) md += `> ⏱️ ${(msg.metadata.responseTimeMs / 1000).toFixed(2)}s\n`;
        if (msg.metadata?.buttons?.length) md += `> Buttons: ${msg.metadata.buttons.map(b => `[${b.title}]`).join(' ')}\n`;
        if (msg.comment) md += `> 💬 ${msg.comment}\n`;
        if (msg.flag) md += `> 🏷️ ${msg.flag.toUpperCase()}\n`;
        md += '\n';
      }
    });
    if (sessionSummary) md += `## Session Notes\n\n${sessionSummary}\n`;
    const blob = new Blob([md], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `chat-${sessionIdRef.current}.md`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  const exportAsJSON = () => {
    if (messages.length === 0) return;
    const session = buildSessionPayload(messages, sessionTitle, sessionSummary);
    const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `chat-${sessionIdRef.current}.json`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setShowExportMenu(false);
  };

  // ── Mock locations ────────────────────────────────────────────────────────
  const MOCK_LOCATIONS = [
    { city: 'Jaipur', lat: 26.9124, lng: 75.7873 },
    { city: 'Delhi', lat: 28.6139, lng: 77.2090 },
    { city: 'Mumbai', lat: 19.0760, lng: 72.8777 },
    { city: 'Pune', lat: 18.5204, lng: 73.8567 },
    { city: 'Jodhpur', lat: 26.2389, lng: 73.0243 },
    { city: 'Bangalore', lat: 12.9716, lng: 77.5946 },
  ];

  // ── Timing colour helper ──────────────────────────────────────────────────
  const timingColor = (ms: number) => {
    if (ms < 2000) return 'bg-emerald-400';
    if (ms < 4000) return 'bg-amber-400';
    if (ms < 6000) return 'bg-orange-400';
    return 'bg-red-400';
  };

  const shortId = sessionIdRef.current.slice(-8);

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex-1 flex overflow-hidden bg-slate-50 relative">

      {/* ══════════════════════════════════════════════════
          RESET MODAL
      ══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showResetModal && (
          <ResetModal
            messageCount={messages.length}
            autoSaveStatus={autoSaveStatus}
            onConfirm={handleReset}
            onCancel={() => setShowResetModal(false)}
          />
        )}
      </AnimatePresence>

      {/* ══════════════════════════════════════════════════
          CHAT MAIN AREA
      ══════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0">

        {/* ── Header ───────────────────────────────────── */}
        <div className="bg-white border-b border-slate-200 z-10">

          {/* Top bar */}
          <div className="px-4 py-2.5 flex items-center gap-2.5">

            {/* Profile picker */}
            <div className="relative" ref={profilePickerRef}>
              <button
                onClick={() => setShowProfilePicker(v => !v)}
                aria-label={`Current test profile: ${profileMeta.label}. Click to change.`}
                className={`flex items-center gap-2 px-2.5 py-2 rounded-xl border transition-all hover:shadow-sm ${profilePal.bg} ${profilePal.border} ${showProfilePicker ? 'ring-2 ' + profilePal.ring : ''}`}
              >
                <span className="text-base leading-none">{profileMeta.badge}</span>
                <div className="hidden sm:block text-left">
                  <p className={`text-[10px] font-black ${profilePal.text} leading-tight`}>{profileMeta.label}</p>
                  <p className="text-[9px] text-slate-400 font-mono leading-tight">+{activeProfile.from.slice(-10)}</p>
                </div>
                <ChevronDown className={`w-3 h-3 ${profilePal.text} transition-transform ${showProfilePicker ? 'rotate-180' : ''}`} />
              </button>
              <AnimatePresence>
                {showProfilePicker && (
                  <ProfilePickerModal
                    profileKey={profileKey}
                    customFrom={customFrom}
                    customName={customName}
                    onSelect={setProfileKey}
                    onCustomChange={(f, n) => { setCustomFrom(f); setCustomName(n); }}
                    onClose={() => setShowProfilePicker(false)}
                  />
                )}
              </AnimatePresence>
            </div>

            {/* Session identity */}
            <div className="flex items-center gap-2 flex-1 min-w-0">
              <div className="relative shrink-0">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center shadow-sm">
                  <MessageSquare className="w-3.5 h-3.5 text-white" />
                </div>
                <div className="absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full bg-emerald-400 border-2 border-white" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-bold text-slate-800">Live Chat</h2>
                  <span className="px-1.5 py-0.5 rounded-full bg-orange-50 border border-orange-200 text-[9px] font-bold text-primary">WA Simulate</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Hash className="w-2.5 h-2.5 text-slate-400" />
                  <span className="text-[9px] text-slate-400 font-mono">{shortId}</span>
                </div>
              </div>
            </div>

            {/* Action buttons */}
            <div className="flex items-center gap-1.5 shrink-0">
              {/* Auto-save pill */}
              <AnimatePresence>
                {(messages.length > 0 || autoSaveStatus === 'error') && (
                  <motion.button
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    onClick={autoSaveStatus === 'error' ? () => setAutoSaveStatus('idle') : undefined}
                    aria-label={`Auto-save status: ${autoSaveStatus}${autoSaveStatus === 'error' ? '. Click to dismiss.' : ''}`}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg border text-[10px] font-semibold transition-colors cursor-default ${
                      autoSaveStatus === 'saving' ? 'bg-amber-50 border-amber-200 text-amber-700' :
                      autoSaveStatus === 'saved'  ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                      autoSaveStatus === 'error'  ? 'bg-red-50 border-red-200 text-red-600 cursor-pointer' :
                      'bg-slate-50 border-slate-200 text-slate-400'
                    }`}
                  >
                    <CloudUpload className={`w-3 h-3 ${autoSaveStatus === 'saving' ? 'animate-pulse' : ''}`} />
                    <span className="hidden sm:inline">
                      {autoSaveStatus === 'saving' ? 'Saving…' :
                       autoSaveStatus === 'saved'  ? 'Saved' :
                       autoSaveStatus === 'error'  ? 'Save failed ×' : 'Auto-save'}
                    </span>
                  </motion.button>
                )}
              </AnimatePresence>

              {/* Location */}
              <button
                onClick={() => setShowLocationPicker(v => !v)}
                aria-label="Share mock location"
                title="Share Mock Location"
                className={`p-2 rounded-lg border text-xs font-semibold transition-all ${
                  showLocationPicker
                    ? 'bg-sky-100 border-sky-300 text-sky-700'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-sky-50 hover:text-sky-600 hover:border-sky-200'
                }`}
              >
                <LocateFixed className="w-4 h-4" />
              </button>

              {/* Export */}
              <div className="relative" ref={exportMenuRef}>
                <button
                  onClick={() => setShowExportMenu(v => !v)}
                  aria-label="Export session"
                  title="Export Session"
                  className={`p-2 rounded-lg border transition-all ${
                    showExportMenu
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                      : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-emerald-50 hover:text-emerald-600 hover:border-emerald-200'
                  }`}
                >
                  <Download className="w-4 h-4" />
                </button>
                <AnimatePresence>
                  {showExportMenu && (
                    <motion.div
                      initial={{ opacity: 0, y: -4, scale: 0.97 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -4, scale: 0.97 }}
                      className="absolute right-0 mt-2 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-50 min-w-[140px]"
                      role="menu"
                    >
                      <button onClick={exportAsMarkdown} role="menuitem"
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors">
                        <FileText className="w-3.5 h-3.5 text-slate-400" /> Markdown
                      </button>
                      <button onClick={exportAsJSON} role="menuitem"
                        className="w-full flex items-center gap-2.5 px-4 py-2 text-xs font-medium text-slate-600 hover:text-slate-900 hover:bg-slate-50 transition-colors">
                        <Code2 className="w-3.5 h-3.5 text-slate-400" /> JSON
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Questions toggle */}
              <button
                onClick={() => setRightPanel(p => p === 'questions' ? 'session' : 'questions')}
                aria-label="Toggle question bank"
                title="Question Bank"
                className={`flex items-center gap-1.5 px-2.5 py-2 rounded-lg border text-xs font-semibold transition-all ${
                  rightPanel === 'questions'
                    ? 'bg-orange-100 border-orange-300 text-orange-700'
                    : 'bg-slate-50 border-slate-200 text-slate-500 hover:bg-orange-50 hover:text-orange-600 hover:border-orange-200'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                <span className="hidden sm:inline">Questions</span>
              </button>

              {/* Side panel toggle (all screen sizes) */}
              <button
                onClick={() => setShowSidePanel(v => !v)}
                aria-label={showSidePanel ? 'Hide session panel' : 'Show session panel'}
                title={showSidePanel ? 'Hide Panel' : 'Show Panel'}
                className={`p-2 rounded-lg border transition-all ${
                  showSidePanel
                    ? 'bg-slate-100 border-slate-300 text-slate-600'
                    : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-slate-100 hover:text-slate-600'
                }`}
              >
                <PanelRight className="w-4 h-4" />
              </button>

              {/* Reset */}
              <button
                onClick={() => setShowResetModal(true)}
                aria-label="Reset session"
                title="Reset Session"
                className="p-2 rounded-lg bg-slate-50 border border-slate-200 text-slate-400 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all"
              >
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Session title + scenario tag */}
          <AnimatePresence>
            {messages.length > 0 && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden px-4 pb-2.5 flex gap-2"
              >
                <input
                  type="text"
                  value={sessionTitle}
                  onChange={(e) => setSessionTitle(e.target.value)}
                  placeholder="Session title…"
                  aria-label="Session title"
                  className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2 text-xs font-semibold text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all"
                />
                {/* Scenario tag picker */}
                <div className="relative shrink-0" ref={scenarioRef}>
                  <button
                    onClick={() => setShowScenarioDropdown(v => !v)}
                    aria-label={scenarioTag ? `Scenario: ${scenarioTag}. Click to change.` : 'Pick scenario tag'}
                    className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold transition-all ${
                      scenarioTag
                        ? 'bg-violet-50 border-violet-200 text-violet-700'
                        : 'bg-slate-50 border-slate-200 text-slate-400 hover:text-violet-600 hover:border-violet-200 hover:bg-violet-50'
                    }`}
                  >
                    <Tag className="w-3 h-3" />
                    <span className="hidden sm:inline max-w-[100px] truncate">{scenarioTag || 'Scenario'}</span>
                  </button>
                  <AnimatePresence>
                    {showScenarioDropdown && (
                      <motion.div
                        initial={{ opacity: 0, y: -4, scale: 0.97 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: -4, scale: 0.97 }}
                        className="absolute right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg py-1.5 z-50 w-52"
                        role="menu"
                      >
                        {scenarioTag && (
                          <button onClick={() => { setScenarioTag(''); setShowScenarioDropdown(false); }}
                            className="w-full flex items-center gap-2 px-3 py-2 text-[10px] text-red-500 hover:bg-red-50 font-semibold transition-colors">
                            <X className="w-3 h-3" /> Clear tag
                          </button>
                        )}
                        {SCENARIO_TAGS.map(tag => (
                          <button key={tag} onClick={() => { setScenarioTag(tag); setShowScenarioDropdown(false); }}
                            role="menuitem"
                            className={`w-full flex items-center gap-2 px-3 py-2 text-xs font-medium text-left transition-colors hover:bg-violet-50 hover:text-violet-700 ${scenarioTag === tag ? 'text-violet-700 bg-violet-50 font-bold' : 'text-slate-600'}`}>
                            {scenarioTag === tag && <Check className="w-3 h-3 shrink-0" />}
                            <span>{tag}</span>
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Flag + review summary strip */}
          <AnimatePresence>
            {hasFlagActivity && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden border-t border-slate-100 bg-slate-50/50 px-4 py-1.5 flex items-center gap-1.5 flex-wrap"
              >
                <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mr-1">Flags:</span>
                {flagCounts.pass > 0  && <span className="text-[9px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">✅ {flagCounts.pass} Pass</span>}
                {flagCounts.fail > 0  && <span className="text-[9px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">❌ {flagCounts.fail} Fail</span>}
                {flagCounts.bug > 0   && <span className="text-[9px] font-bold text-purple-700 bg-purple-50 px-2 py-0.5 rounded-full border border-purple-200">🐛 {flagCounts.bug} Bug</span>}
                {flagCounts.slow > 0  && <span className="text-[9px] font-bold text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">🐌 {flagCounts.slow} Slow</span>}
                {commentCount > 0     && <span className="text-[9px] font-bold text-sky-700 bg-sky-50 px-2 py-0.5 rounded-full border border-sky-200">💬 {commentCount} Notes</span>}
                {unreviewedCount > 0 && (
                  <span className="text-[9px] font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full border border-slate-300 ml-auto">
                    {unreviewedCount} unreviewed
                  </span>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* ── Location Picker ───────────────────────────── */}
        <AnimatePresence>
          {showLocationPicker && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="overflow-hidden border-b border-sky-200 bg-sky-50"
            >
              <div className="px-4 py-2.5 flex items-center gap-2 flex-wrap">
                <div className="flex items-center gap-1.5 text-[11px] font-bold text-sky-700 mr-1">
                  <MapPin className="w-3.5 h-3.5" /> Share location:
                </div>
                {MOCK_LOCATIONS.map(loc => (
                  <button
                    key={loc.city}
                    onClick={() => doShareLocation(loc.city, loc.lat, loc.lng)}
                    disabled={isLoading}
                    aria-label={`Share location: ${loc.city}`}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white border border-sky-200 text-[11px] font-semibold text-sky-700 hover:bg-sky-100 hover:border-sky-300 active:scale-95 transition-all disabled:opacity-40 shadow-sm"
                  >
                    <Navigation className="w-2.5 h-2.5" /> {loc.city}
                  </button>
                ))}
                <button onClick={() => setShowLocationPicker(false)} aria-label="Close location picker"
                  className="ml-auto p-1.5 rounded-lg text-sky-400 hover:text-sky-700 hover:bg-sky-100 transition-colors">
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Messages ──────────────────────────────────── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-5 space-y-4 custom-scrollbar">

          {/* Empty state */}
          {messages.length === 0 && (
            <div className="h-full flex flex-col items-center justify-center select-none py-10">
              <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center mb-5 shadow-orange">
                <Sparkles className="w-9 h-9 text-white" />
              </div>
              <h3 className="text-base font-bold text-slate-700 mb-1.5">CZ-AI Live Chat</h3>
              <p className="text-xs text-slate-400 text-center max-w-xs leading-relaxed mb-2">
                Chat with your CZ-AI agent through the WhatsApp simulate pipeline — same flow as real users.
              </p>
              {/* Profile hint */}
              <div className={`flex items-center gap-2 px-3 py-2 rounded-xl border mb-6 ${profilePal.bg} ${profilePal.border}`}>
                <span className="text-sm">{profileMeta.badge}</span>
                <span className={`text-[10px] font-semibold ${profilePal.text}`}>Testing as: {activeProfile.name} (+{activeProfile.from.slice(-10)})</span>
              </div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-3">Try a prompt</p>
              <div className="grid grid-cols-2 gap-2 max-w-sm w-full">
                {[
                  { icon: '📍', text: 'Show me chargers near Jaipur', color: 'border-sky-200 hover:border-sky-300 hover:bg-sky-50 text-sky-800' },
                  { icon: '⚡', text: 'I want to start a charging session', color: 'border-amber-200 hover:border-amber-300 hover:bg-amber-50 text-amber-800' },
                  { icon: '💳', text: 'What is my wallet balance?', color: 'border-emerald-200 hover:border-emerald-300 hover:bg-emerald-50 text-emerald-800' },
                  { icon: '🆘', text: 'There is smoke from the charger!', color: 'border-red-200 hover:border-red-300 hover:bg-red-50 text-red-800' },
                ].map((prompt, i) => (
                  <button
                    key={i}
                    onClick={() => doSend(prompt.text)}
                    className={`p-3.5 rounded-xl border bg-white text-left transition-all hover:scale-[1.02] active:scale-[0.98] shadow-sm ${prompt.color}`}
                  >
                    <span className="text-base mb-1.5 block">{prompt.icon}</span>
                    <p className="text-[11px] font-medium leading-relaxed">{prompt.text}</p>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Message list */}
          <AnimatePresence initial={false}>
            {messages.map((msg) => {
              const agentMeta = getAgentMeta(msg.metadata?.agentType);
              const isAgent = msg.role === 'agent';
              const responseTimeMs = msg.metadata?.responseTimeMs || 0;
              const msgTime = msg.timestamp.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });

              return (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 300, damping: 30 }}
                  className={`flex gap-3 group ${isAgent ? 'flex-row' : 'flex-row-reverse'}`}
                >
                  {/* Avatar */}
                  <div className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 border text-sm ${
                    isAgent
                      ? agentMeta.color
                      : 'bg-gradient-to-br from-orange-400 to-orange-600 border-orange-300 text-white'
                  }`}>
                    {isAgent ? <span>{agentMeta.icon}</span> : <User className="w-3.5 h-3.5 text-white" />}
                  </div>

                  {/* Content column */}
                  <div className={`max-w-[76%] space-y-1 ${!isAgent ? 'items-end flex flex-col' : ''}`}>

                    {/* Agent type badge */}
                    {isAgent && msg.metadata?.agentType && msg.metadata.agentType !== 'error' && (
                      <div className={`inline-flex items-center gap-1.5 text-[10px] font-bold px-2.5 py-1 rounded-full border ${agentMeta.color}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${agentMeta.dot}`} />
                        {agentMeta.label}
                        <span className="opacity-50 font-normal ml-0.5">{msgTime}</span>
                      </div>
                    )}

                    {/* User message meta */}
                    {!isAgent && (
                      <div className="flex items-center gap-1.5 justify-end">
                        {msg.isButtonTap && (
                          <span className="text-[9px] font-semibold px-1.5 py-0.5 rounded-full bg-orange-50 text-primary border border-orange-200">Button Tap</span>
                        )}
                        <span className="text-[9px] text-slate-400">{msgTime}</span>
                      </div>
                    )}

                    {/* Message bubble */}
                    <div className={`relative rounded-2xl px-4 py-3 ${
                      !isAgent
                        ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white rounded-tr-sm shadow-sm'
                        : msg.metadata?.agentType === 'error'
                          ? 'bg-red-50 border border-red-200 rounded-tl-sm text-red-800'
                          : 'bg-white border border-slate-200 rounded-tl-sm shadow-sm text-slate-800'
                    }`}>
                      <div className="text-sm leading-relaxed">
                        {renderWhatsAppText(msg.content, !isAgent)}
                      </div>

                      {/* Response time bar */}
                      {isAgent && responseTimeMs > 0 && (
                        <div className="mt-3 flex items-center gap-2">
                          <div className="flex-1 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${timingColor(responseTimeMs)}`}
                              style={{ width: `${Math.min((responseTimeMs / 10000) * 100, 100)}%` }}
                            />
                          </div>
                          <span className={`text-[10px] font-semibold shrink-0 ${
                            responseTimeMs > 6000 ? 'text-red-500' : responseTimeMs > 3000 ? 'text-amber-500' : 'text-slate-400'
                          }`}>{(responseTimeMs / 1000).toFixed(1)}s</span>
                        </div>
                      )}

                      {/* Quick Reply Buttons */}
                      {msg.metadata?.buttons && msg.metadata.buttons.length > 0 && (
                        <div className="mt-3.5 pt-3 border-t border-slate-100 space-y-2">
                          {msg.metadata.buttons.map((btn, i) => (
                            <button
                              key={i}
                              onClick={() => !isLoading && doButtonTap(btn.id, btn.title)}
                              disabled={isLoading}
                              aria-label={`Quick reply: ${btn.title}`}
                              className="w-full py-2.5 px-4 rounded-xl bg-orange-50 border border-orange-200 text-sm font-semibold text-primary hover:bg-orange-100 hover:border-orange-300 active:scale-[0.98] transition-all disabled:opacity-30 flex items-center justify-center gap-2"
                            >
                              <ChevronRight className="w-3.5 h-3.5 shrink-0" />
                              {btn.title}
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Suggested Actions */}
                      {msg.metadata?.suggestedActions && msg.metadata.suggestedActions.length > 0 && (
                        <div className="mt-3 flex flex-wrap gap-1.5">
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
                        <div className="mt-3.5 pt-3 border-t border-slate-100">
                          <p className="text-[10px] font-bold text-sky-600 mb-2 flex items-center gap-1.5">
                            <LocateFixed className="w-3 h-3" /> Quick Share:
                          </p>
                          <div className="flex flex-wrap gap-1.5">
                            {MOCK_LOCATIONS.map(loc => (
                              <button
                                key={loc.city}
                                onClick={() => !isLoading && doShareLocation(loc.city, loc.lat, loc.lng)}
                                disabled={isLoading}
                                aria-label={`Share location: ${loc.city}`}
                                className="px-2.5 py-1.5 rounded-lg bg-sky-50 border border-sky-200 text-[10px] font-semibold text-sky-700 hover:bg-sky-100 active:scale-95 transition-all disabled:opacity-30"
                              >
                                📍 {loc.city}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Flag badge */}
                    {msg.flag && (
                      <div className={`inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${
                        msg.flag === 'pass' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' :
                        msg.flag === 'fail' ? 'bg-red-50 border-red-200 text-red-700' :
                        msg.flag === 'bug'  ? 'bg-purple-50 border-purple-200 text-purple-700' :
                                              'bg-amber-50 border-amber-200 text-amber-700'
                      }`}>
                        {msg.flag === 'pass' ? '✅ Pass' : msg.flag === 'fail' ? '❌ Fail' : msg.flag === 'bug' ? '🐛 Bug' : '🐌 Slow'}
                      </div>
                    )}

                    {/* Flag / comment toolbar — agent messages only, visible on hover OR focus-within */}
                    {isAgent && (
                      <div
                        className={`flex items-center gap-1 opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity`}
                        role="toolbar"
                        aria-label="Message actions"
                      >
                        <div className="flex items-center bg-white border border-slate-200 rounded-xl px-2 py-1.5 shadow-sm gap-0.5">
                          {/* Comment */}
                          <button
                            onClick={() => { setEditingComment(msg.id === editingComment ? null : msg.id); setCommentInput(msg.comment || ''); }}
                            aria-label={msg.comment ? 'Edit comment' : 'Add comment'}
                            title="Add comment"
                            className={`p-1.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-sky-300 ${editingComment === msg.id ? 'bg-sky-50 text-sky-600' : 'text-slate-400 hover:text-sky-600 hover:bg-sky-50'}`}
                          >
                            <MessageSquareText className="w-3.5 h-3.5" />
                          </button>

                          {/* Copy */}
                          <button
                            onClick={() => copyMessage(msg.id, msg.content)}
                            aria-label="Copy message"
                            title="Copy"
                            className={`p-1.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-slate-300 ${copiedId === msg.id ? 'text-emerald-600 bg-emerald-50' : 'text-slate-400 hover:text-slate-600 hover:bg-slate-50'}`}
                          >
                            {copiedId === msg.id ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                          </button>

                          <div className="w-px h-4 bg-slate-200 mx-0.5" />

                          {/* Flag buttons */}
                          {([
                            ['pass', CheckCircle2, 'emerald', 'Mark as pass'],
                            ['fail', XCircle, 'red', 'Mark as fail'],
                            ['bug', Bug, 'purple', 'Mark as bug'],
                            ['slow', Timer, 'amber', 'Mark as slow'],
                          ] as [string, any, string, string][]).map(([f, Icon, c, label]) => (
                            <button
                              key={f}
                              onClick={() => toggleFlag(msg.id, f as any)}
                              aria-label={label}
                              aria-pressed={msg.flag === f}
                              title={label}
                              className={`p-1.5 rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-${c}-300 ${msg.flag === f ? `bg-${c}-50 text-${c}-600` : `text-slate-400 hover:text-${c}-600 hover:bg-${c}-50`}`}
                            >
                              <Icon className="w-3.5 h-3.5" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Comment box */}
                    {editingComment === msg.id ? (
                      <div className="flex gap-1.5 mt-1">
                        <input
                          type="text" autoFocus value={commentInput}
                          onChange={(e) => setCommentInput(e.target.value)}
                          placeholder="Add a comment…"
                          aria-label="Message comment"
                          className="flex-1 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-amber-300 transition-all"
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') saveComment(msg.id, commentInput);
                            else if (e.key === 'Escape') { setEditingComment(null); }
                          }}
                        />
                        <button onClick={() => saveComment(msg.id, commentInput)} aria-label="Save comment"
                          className="px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-800 border border-amber-200 text-xs font-bold transition-colors">✓</button>
                        <button onClick={() => setEditingComment(null)} aria-label="Cancel comment"
                          className="px-2 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-500 border border-slate-200 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    ) : msg.comment ? (
                      <button
                        onClick={() => { setEditingComment(msg.id); setCommentInput(msg.comment || ''); }}
                        aria-label={`Edit comment: ${msg.comment}`}
                        className="mt-1 flex items-start gap-2 p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-800 text-left hover:bg-amber-100 transition-colors w-full"
                      >
                        <MessageSquareText className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
                        <span>{msg.comment}</span>
                      </button>
                    ) : null}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>

          {/* Typing indicator */}
          {isLoading && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="flex gap-3" aria-live="polite" aria-label="Agent is responding">
              <div className="w-8 h-8 rounded-xl bg-slate-100 border border-slate-200 flex items-center justify-center">
                <Bot className="w-4 h-4 text-slate-400 animate-pulse" />
              </div>
              <div className="flex items-center gap-2.5 px-4 py-3 bg-white rounded-2xl rounded-tl-sm border border-slate-200 shadow-sm">
                <div className="flex gap-1">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      animate={{ y: [0, -5, 0] }}
                      transition={{ repeat: Infinity, duration: 0.6, delay: i * 0.15 }}
                      className="w-2 h-2 rounded-full bg-orange-400"
                    />
                  ))}
                </div>
                <span className="text-[11px] text-slate-400">Agent is responding…</span>
              </div>
            </motion.div>
          )}
        </div>

        {/* ── Input Area ────────────────────────────────── */}
        <div className="p-3.5 bg-white border-t border-slate-200">
          <div className="flex items-end gap-2">
            <div className="flex-1 relative">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && !e.shiftKey && doSend(inputValue)}
                placeholder={isLoading ? 'Agent is responding…' : 'Type a message… (Enter to send)'}
                disabled={isLoading}
                aria-label="Message input"
                className={`w-full bg-slate-50 border rounded-2xl py-3.5 pl-5 pr-5 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all disabled:opacity-60 disabled:cursor-not-allowed ${
                  inputHighlight ? 'border-orange-400 ring-2 ring-orange-200 bg-orange-50' : 'border-slate-200'
                }`}
              />
            </div>
            <button
              onClick={() => doSend(inputValue)}
              disabled={!inputValue.trim() || isLoading}
              aria-label="Send message"
              className={`shrink-0 w-11 h-11 rounded-2xl flex items-center justify-center transition-all ${
                inputValue.trim() && !isLoading
                  ? 'bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-sm hover:scale-105 active:scale-95'
                  : 'bg-slate-100 text-slate-400 cursor-not-allowed'
              }`}
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════
          RIGHT SIDEBAR
      ══════════════════════════════════════════════════ */}
      <AnimatePresence>
        {showSidePanel && (
          <motion.div
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 280, opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 35 }}
            className="border-l border-slate-200 bg-white flex flex-col overflow-hidden shrink-0"
          >

            {/* Panel toggle tabs */}
            <div className="flex border-b border-slate-200 shrink-0">
              <button
                onClick={() => setRightPanel('session')}
                aria-selected={rightPanel === 'session'}
                role="tab"
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[11px] font-bold transition-all border-b-2 ${
                  rightPanel === 'session'
                    ? 'border-orange-400 text-orange-600 bg-orange-50/50'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <Shield className="w-3.5 h-3.5" /> Session
              </button>
              <button
                onClick={() => setRightPanel('questions')}
                aria-selected={rightPanel === 'questions'}
                role="tab"
                className={`flex-1 flex items-center justify-center gap-1.5 py-3 text-[11px] font-bold transition-all border-b-2 ${
                  rightPanel === 'questions'
                    ? 'border-orange-400 text-orange-600 bg-orange-50/50'
                    : 'border-transparent text-slate-400 hover:text-slate-600'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" /> Questions
                {pinnedSet.size > 0 && (
                  <span className="ml-1 px-1.5 py-0.5 rounded-full bg-orange-100 text-orange-600 text-[9px] font-black border border-orange-200">
                    {pinnedSet.size}
                  </span>
                )}
              </button>
            </div>

            {/* ── QUESTIONS PANEL ── */}
            {rightPanel === 'questions' && (
              <div className="flex-1 flex flex-col overflow-hidden">

                {/* Search + header */}
                <div className="p-3 border-b border-slate-100 shrink-0">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3 h-3 text-slate-400" />
                    <input
                      value={questionSearch}
                      onChange={e => setQuestionSearch(e.target.value)}
                      placeholder="Search questions…"
                      aria-label="Search questions"
                      className="w-full pl-8 pr-3 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-200 transition-all text-slate-700 placeholder:text-slate-400"
                    />
                  </div>
                  <div className="flex items-center justify-between mt-1.5 px-0.5">
                    <p className="text-[9px] text-slate-400">Click to fill · ▶ send now</p>
                    {pinnedSet.size > 0 && (
                      <span className="text-[9px] font-bold text-orange-500 flex items-center gap-0.5">
                        <Star className="w-2.5 h-2.5 fill-orange-400 text-orange-400" />
                        {pinnedSet.size} selected
                      </span>
                    )}
                  </div>
                </div>

                {/* Loading */}
                {bankLoading && (
                  <div className="flex items-center justify-center py-8 gap-2">
                    <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                    <span className="text-xs text-slate-400">Loading questions…</span>
                  </div>
                )}

                {/* Question list */}
                {!bankLoading && (
                  <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1 custom-scrollbar">

                    {/* Pinned section label */}
                    {pinnedSet.size > 0 && !questionSearch && (
                      <p className="text-[9px] font-bold uppercase tracking-widest text-orange-400 px-1 pt-1 pb-0.5 flex items-center gap-1">
                        <Star className="w-2.5 h-2.5 fill-orange-300 text-orange-400" /> Selected
                      </p>
                    )}

                    {filteredQuestions.length === 0 && (
                      <div className="flex flex-col items-center gap-2 py-8 text-center">
                        <FlaskConical className="w-8 h-8 text-slate-200" />
                        <p className="text-xs text-slate-400">No questions in bank yet</p>
                        <button
                          onClick={() => setView('sandbox')}
                          className="text-[10px] font-semibold text-orange-500 hover:text-orange-700 underline"
                        >
                          Go to Questions Lab →
                        </button>
                      </div>
                    )}

                    <AnimatePresence initial={false}>
                      {filteredQuestions.map((q, i) => {
                        const cat = qCat(q.text);
                        const style = QCAT[cat];
                        const isPinned = q.isPinned;
                        // Section divider between pinned and rest
                        const showDivider = !questionSearch && !isPinned && i > 0 && filteredQuestions[i - 1].isPinned;

                        return (
                          <React.Fragment key={q.text}>
                            {showDivider && (
                              <p className="text-[9px] font-bold uppercase tracking-widest text-slate-400 px-1 pt-2 pb-0.5">
                                All Questions
                              </p>
                            )}
                            <motion.div
                              initial={{ opacity: 0, x: 8 }}
                              animate={{ opacity: 1, x: 0 }}
                              transition={{ delay: Math.min(i * 0.012, 0.15) }}
                              className={`flex items-stretch gap-0 rounded-xl border transition-all overflow-hidden group ${
                                isPinned
                                  ? 'border-orange-200 bg-orange-50 hover:border-orange-300'
                                  : `border-transparent hover:border-orange-200 ${style.bg}`
                              }`}
                            >
                              {/* Fill input button */}
                              <button
                                onClick={() => {
                                  setInputValue(q.text);
                                  setInputHighlight(true);
                                  setTimeout(() => {
                                    inputRef.current?.focus();
                                    setInputHighlight(false);
                                  }, 1200);
                                }}
                                aria-label={`Fill input: ${q.text}`}
                                className="flex-1 text-left flex items-start gap-2 px-3 py-2.5"
                              >
                                {isPinned
                                  ? <Star className="w-3 h-3 shrink-0 mt-0.5 fill-orange-400 text-orange-400" />
                                  : <span className="text-sm shrink-0 leading-none mt-0.5">💬</span>
                                }
                                <div className="min-w-0">
                                  <p className={`text-[11px] font-medium leading-relaxed group-hover:text-slate-900 ${isPinned ? 'text-slate-800 font-semibold' : 'text-slate-700'}`}>
                                    {q.text}
                                  </p>
                                  <div className="flex items-center gap-1 mt-0.5">
                                    <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${style.dot}`} />
                                    <span className={`text-[9px] font-bold uppercase tracking-wider ${style.text}`}>{cat}</span>
                                    {q.source === 'ai' && <span className="text-[8px] text-slate-400 ml-0.5">· AI</span>}
                                    {q.source === 'custom' && <span className="text-[8px] text-slate-400 ml-0.5">· Custom</span>}
                                  </div>
                                </div>
                              </button>
                              {/* Send-now button */}
                              <button
                                onClick={() => doSend(q.text)}
                                disabled={isLoading}
                                aria-label={`Send now: ${q.text}`}
                                title="Send immediately"
                                className={`px-2 opacity-0 group-hover:opacity-100 transition-all hover:bg-orange-100 disabled:opacity-30 shrink-0 border-l ${
                                  isPinned ? 'text-orange-500 border-orange-200' : 'text-orange-400 border-orange-100'
                                }`}
                              >
                                <PlayCircle className="w-4 h-4" />
                              </button>
                            </motion.div>
                          </React.Fragment>
                        );
                      })}
                    </AnimatePresence>
                  </div>
                )}

                <div className="p-3 border-t border-slate-100 shrink-0">
                  <button
                    onClick={() => setView('sandbox')}
                    className="w-full flex items-center justify-center gap-2 py-2 text-[10px] font-semibold text-orange-500 hover:text-orange-700 border border-dashed border-orange-200 hover:border-orange-300 rounded-xl transition-all"
                  >
                    <FlaskConical className="w-3 h-3" /> Manage in Questions Lab
                  </button>
                </div>
              </div>
            )}

            {/* ── SESSION PANEL ── */}
            {rightPanel === 'session' && (
              <div className="flex-1 flex flex-col overflow-y-auto custom-scrollbar">

                {/* Simulated user card */}
                <div className="p-4 border-b border-slate-200 shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2.5 flex items-center gap-1.5">
                    <Shield className="w-3 h-3" /> Simulated User
                  </p>
                  <div className={`p-3.5 rounded-2xl border ${profilePal.bg} ${profilePal.border}`}>
                    <div className="flex items-center gap-2.5 mb-3">
                      <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-orange-400 to-orange-600 flex items-center justify-center text-white text-sm font-bold shadow-sm shrink-0">
                        {(systemContext?.name || activeProfile.name).charAt(0).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-bold text-slate-800 leading-tight truncate">{systemContext?.name || activeProfile.name}</p>
                        <p className="text-[10px] text-slate-500 font-mono">+{activeProfile.from}</p>
                      </div>
                      <div className={`px-1.5 py-0.5 rounded-full text-[9px] font-bold border ${profilePal.pill} shrink-0`}>{profileMeta.badge}</div>
                    </div>
                    <div className="flex items-center justify-between p-2.5 rounded-xl bg-white border border-slate-200/60">
                      <div className="flex items-center gap-2">
                        <Wallet className="w-4 h-4 text-orange-400" />
                        <span className="text-[10px] text-slate-500 font-semibold">Wallet</span>
                      </div>
                      <span className="text-sm font-black text-primary">₹{systemContext?.walletBalance ?? '—'}</span>
                    </div>
                  </div>
                </div>

                {/* Session ID */}
                <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5 flex items-center gap-1.5">
                    <Hash className="w-3 h-3" /> Session ID
                  </p>
                  <div className="flex items-center gap-2 p-2 rounded-xl bg-slate-50 border border-slate-200">
                    <code className="text-[9px] font-mono text-slate-600 flex-1 truncate">{sessionIdRef.current}</code>
                    <button
                      onClick={() => navigator.clipboard.writeText(sessionIdRef.current)}
                      aria-label="Copy session ID"
                      title="Copy session ID"
                      className="shrink-0 p-1 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition-colors"
                    >
                      <Copy className="w-3 h-3" />
                    </button>
                  </div>
                </div>

                {/* Vehicles */}
                <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                    <Zap className="w-3 h-3" /> Vehicles
                  </p>
                  <div className="space-y-1.5">
                    {(systemContext?.vehicles || []).map((v: any) => (
                      <div key={v.id} className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 border border-slate-200 group">
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-lg bg-emerald-100 flex items-center justify-center">
                            <Zap className="w-3 h-3 text-emerald-500" />
                          </div>
                          <span className="text-xs font-medium text-slate-700">{v.nickname || v.model}</span>
                        </div>
                        <ArrowRight className="w-3 h-3 text-slate-300 opacity-0 group-hover:opacity-100 transition-all" />
                      </div>
                    ))}
                    {!systemContext?.vehicles?.length && (
                      <p className="text-[10px] italic text-slate-400 px-1">No vehicles registered</p>
                    )}
                  </div>
                </div>

                {/* Enhanced Session Stats */}
                <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 flex items-center gap-1.5">
                      <Activity className="w-3 h-3" /> Session Stats
                    </p>
                    {unreviewedCount > 0 && (
                      <button
                        onClick={bulkMarkPass}
                        aria-label={`Mark all ${unreviewedCount} unreviewed messages as pass`}
                        title="Mark all unreviewed as Pass"
                        className="text-[9px] font-bold text-emerald-600 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-full hover:bg-emerald-100 transition-all"
                      >
                        ✅ Mark {unreviewedCount} as Pass
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {[
                      { label: 'Messages', value: messages.length, color: 'text-slate-800' },
                      { label: 'Agent turns', value: agentMessages.length, color: 'text-slate-800' },
                      { label: 'Button taps', value: buttonTapCount, color: 'text-slate-800' },
                      { label: 'Errors', value: errorMsgCount, color: errorMsgCount > 0 ? 'text-red-600' : 'text-slate-800' },
                      { label: 'Avg response', value: avgResponseMs > 0 ? `${(avgResponseMs / 1000).toFixed(1)}s` : '—', color: avgResponseMs > 6000 ? 'text-red-600' : avgResponseMs > 3000 ? 'text-amber-600' : 'text-emerald-600' },
                      { label: 'Min / Max', value: responseTimes.length ? `${(minResponseMs/1000).toFixed(1)}s / ${(maxResponseMs/1000).toFixed(1)}s` : '—', color: 'text-slate-600' },
                      { label: 'Flagged', value: flagCounts.pass + flagCounts.fail + flagCounts.bug + flagCounts.slow, color: 'text-slate-800' },
                      { label: 'Unreviewed', value: unreviewedCount, color: unreviewedCount > 0 ? 'text-amber-600' : 'text-emerald-600' },
                    ].map(s => (
                      <div key={s.label} className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                        <p className="text-[8px] text-slate-400 font-semibold uppercase tracking-wide mb-0.5 leading-tight">{s.label}</p>
                        <p className={`text-xs font-black ${s.color} leading-tight`}>{s.value}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Agent Handoff Timeline */}
                <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                    <Layers className="w-3 h-3" /> Agent Handoffs
                  </p>
                  <AgentTimeline messages={messages} />
                </div>

                {/* Test Coverage */}
                <div className="px-4 py-3 border-b border-slate-100 shrink-0">
                  <TestCoverage messages={messages} />
                </div>

                {/* Session Notes */}
                <div className="flex-1 px-4 py-3 flex flex-col min-h-[120px]">
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-2 flex items-center gap-1.5">
                    <MessageSquareText className="w-3 h-3" /> Session Notes
                  </p>
                  <textarea
                    value={sessionSummary}
                    onChange={(e) => setSessionSummary(e.target.value)}
                    placeholder={messages.length === 0 ? 'Notes appear once you start chatting…' : 'Write observations, bugs, or test notes…'}
                    disabled={messages.length === 0}
                    aria-label="Session notes"
                    className="flex-1 bg-slate-50 border border-slate-200 rounded-xl px-3 py-2.5 text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary transition-all resize-none disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed min-h-[100px]"
                  />
                </div>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default ManualChatView;
