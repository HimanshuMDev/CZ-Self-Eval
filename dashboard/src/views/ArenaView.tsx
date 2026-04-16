import React, { useState, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  Play, User, Bot, Terminal, CheckCircle2, AlertCircle,
  Brain, Square, X, Zap, CreditCard, Headphones,
  BookOpen, MapPin, ChevronRight, PenLine, Clock, Shield, Globe
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { fetchPersonas, fetchEvidence, type Persona } from '../api';
import { useDashboard } from '../store/DashboardContext';

// ─── Agent Config ─────────────────────────────────────────────────────────────

const AGENTS = [
  {
    id: 'discovery',
    label: 'Discovery',
    icon: MapPin,
    color: 'text-blue-600',
    bg: 'bg-blue-50 border-blue-200',
    activeBg: 'bg-blue-100 border-blue-300',
    desc: 'Find chargers, route planning, station details',
    tags: ['discovery']
  },
  {
    id: 'session',
    label: 'Session',
    icon: Zap,
    color: 'text-amber-600',
    bg: 'bg-amber-50 border-amber-200',
    activeBg: 'bg-amber-100 border-amber-300',
    desc: 'Book, start, stop & monitor charging sessions',
    tags: ['session', 'booking-flow']
  },
  {
    id: 'payment',
    label: 'Payment',
    icon: CreditCard,
    color: 'text-emerald-600',
    bg: 'bg-emerald-50 border-emerald-200',
    activeBg: 'bg-emerald-100 border-emerald-300',
    desc: 'Wallet, invoices, top-up, spending summary',
    tags: ['payment', 'wallet']
  },
  {
    id: 'support',
    label: 'Support',
    icon: Headphones,
    color: 'text-violet-600',
    bg: 'bg-violet-50 border-violet-200',
    activeBg: 'bg-violet-100 border-violet-300',
    desc: 'RFID, safety incidents, troubleshooting, escalation',
    tags: ['support', 'safety', 'rfid']
  },
  {
    id: 'faq',
    label: 'FAQ / Loyalty',
    icon: BookOpen,
    color: 'text-orange-600',
    bg: 'bg-orange-50 border-orange-200',
    activeBg: 'bg-orange-100 border-orange-300',
    desc: 'ChargeCoins, tiers, general app questions',
    tags: ['faq', 'loyalty']
  },
  {
    id: 'regression',
    label: 'Regression',
    icon: Shield,
    color: 'text-red-600',
    bg: 'bg-red-50 border-red-200',
    activeBg: 'bg-red-100 border-red-300',
    desc: 'Must-pass scenarios from real failure traces',
    tags: ['regression', 'routing', 'context-memory', 'hinglish']
  }
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface EvidenceScenario {
  persona: Persona & { primaryGoal?: any };
  goal: { id: string; objective: string; tags?: string[]; mustPass?: boolean };
}

// ─── Run Duel Dialog ─────────────────────────────────────────────────────────

interface RunDuelDialogProps {
  onClose: () => void;
  onStart: (personaId: string, customScenario?: string, language?: string) => void;
}

const RunDuelDialog: React.FC<RunDuelDialogProps> = ({ onClose, onStart }) => {
  const [step, setStep] = useState<'agent' | 'scenario'>('agent');
  const [selectedAgent, setSelectedAgent] = useState<string>('');
  const [selectedPersonaId, setSelectedPersonaId] = useState<string>('');
  const [customScenario, setCustomScenario] = useState<string>('');
  const [useCustom, setUseCustom] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>('English');
  const [allPersonas, setAllPersonas] = useState<Persona[]>([]);
  const [evidenceScenarios, setEvidenceScenarios] = useState<EvidenceScenario[]>([]);

  useEffect(() => {
    fetchPersonas().then(setAllPersonas);
    fetchEvidence().then(setEvidenceScenarios);
  }, []);

  // Filter evidence scenarios by selected agent tags
  const filteredScenarios = evidenceScenarios.filter(s => {
    const agentConfig = AGENTS.find(a => a.id === selectedAgent);
    if (!agentConfig) return false;
    const goalTags: string[] = s.goal.tags ?? [];
    return agentConfig.tags.some(t => goalTags.includes(t));
  });

  // Also include standard personas that match the agent
  const agentPersonaMap: Record<string, string[]> = {
    discovery: ['p1_route_traveler', 'p5_discovery_seeker', 'p8_impatient_platinum', 'p10_jodhpur_traveler'],
    session:   ['p6_qr_user', 'p9_zero_wallet'],
    payment:   ['p2_payment_disputer', 'p7_hinglish_user'],
    support:   ['p3_2w_rider', 'p4_coin_collector'],
    faq:       ['p4_coin_collector'],
    regression: []
  };

  const standardPersonas = allPersonas.filter(p =>
    (agentPersonaMap[selectedAgent] ?? []).includes(p.id)
  );

  const canStart = useCustom
    ? customScenario.trim().length > 10
    : selectedPersonaId !== '';

  const agentConfig = AGENTS.find(a => a.id === selectedAgent);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Dialog */}
      <motion.div
        initial={{ opacity: 0, scale: 0.92, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.92, y: 20 }}
        transition={{ type: 'spring', damping: 20, stiffness: 300 }}
        className="relative w-full max-w-2xl max-h-[90vh] flex flex-col bg-white rounded-3xl border border-slate-200 shadow-card overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-slate-200 shrink-0">
          <div>
            <h2 className="text-sm font-black uppercase tracking-[0.3em] text-primary">Run Duel</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              {step === 'agent' ? 'Select which agent to test' : `${agentConfig?.label} Agent — pick a scenario`}
            </p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors">
            <X className="w-4 h-4 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">

          {/* ── Step 1: Agent Selection ── */}
          {step === 'agent' && (
            <div className="grid grid-cols-2 gap-3">
              {AGENTS.map(agent => {
                const Icon = agent.icon;
                const isSelected = selectedAgent === agent.id;
                return (
                  <button
                    key={agent.id}
                    onClick={() => { setSelectedAgent(agent.id); setSelectedPersonaId(''); setUseCustom(false); }}
                    className={`p-4 rounded-2xl border text-left transition-all group ${
                      isSelected ? agent.activeBg : agent.bg + ' hover:opacity-80'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-2">
                      <div className={`w-8 h-8 rounded-xl flex items-center justify-center bg-slate-100`}>
                        <Icon className={`w-4 h-4 ${agent.color}`} />
                      </div>
                      <span className={`text-sm font-black ${isSelected ? 'text-slate-800' : 'text-slate-600'}`}>
                        {agent.label}
                      </span>
                      {isSelected && <ChevronRight className="w-4 h-4 text-slate-400 ml-auto" />}
                    </div>
                    <p className="text-[11px] text-slate-500 leading-relaxed">{agent.desc}</p>
                  </button>
                );
              })}
            </div>
          )}

          {/* ── Step 2: Scenario Selection ── */}
          {step === 'scenario' && (
            <div className="space-y-4">

              {/* Pre-built Evidence Scenarios */}
              {filteredScenarios.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                    <Shield className="w-3 h-3" /> Real Failure Scenarios
                  </p>
                  {filteredScenarios.map(s => (
                    <button
                      key={s.persona.id}
                      onClick={() => { setSelectedPersonaId(s.persona.id); setUseCustom(false); }}
                      className={`w-full p-4 rounded-2xl border text-left transition-all ${
                        selectedPersonaId === s.persona.id && !useCustom
                          ? 'bg-orange-50 border-orange-200'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-bold text-slate-800">{s.persona.name}</p>
                          <p className="text-[11px] text-slate-600 mt-1 leading-relaxed">{s.goal.objective}</p>
                        </div>
                        <div className="flex flex-col items-end gap-1 shrink-0">
                          {s.goal.mustPass && (
                            <span className="text-[8px] bg-red-50 text-red-600 px-1.5 py-0.5 rounded border border-red-200 font-bold uppercase">MUST PASS</span>
                          )}
                          {(s.goal.tags ?? []).slice(0, 2).map(tag => (
                            <span key={tag} className="text-[8px] bg-slate-100 text-slate-600 px-1.5 py-0.5 rounded font-bold uppercase">{tag}</span>
                          ))}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Language Selection */}
              <div className="space-y-2 mt-4 bg-slate-50 border border-slate-200 rounded-2xl p-4">
                <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                  <Globe className="w-3 h-3" /> Customer Language
                </p>
                <div className="flex gap-2">
                  {['English', 'Hindi', 'Hinglish'].map((lang) => (
                    <button
                      key={lang}
                      onClick={() => setSelectedLanguage(lang)}
                      className={`flex-1 py-2 rounded-xl text-xs font-bold transition-all border ${
                        selectedLanguage === lang
                          ? 'bg-orange-50 border-orange-200 text-slate-800'
                          : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
              </div>

              {/* Standard Personas for this agent */}
              {standardPersonas.length > 0 && (
                <div className="space-y-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 flex items-center gap-2">
                    <User className="w-3 h-3" /> Standard Personas
                  </p>
                  {standardPersonas.map(p => (
                    <button
                      key={p.id}
                      onClick={() => { setSelectedPersonaId(p.id); setUseCustom(false); }}
                      className={`w-full p-4 rounded-2xl border text-left transition-all ${
                        selectedPersonaId === p.id && !useCustom
                          ? 'bg-orange-50 border-orange-200'
                          : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                      }`}
                    >
                      <p className="text-sm font-bold text-slate-800">{p.name}</p>
                      <p className="text-[11px] text-slate-600 mt-1">{p.description}</p>
                    </button>
                  ))}
                </div>
              )}

              {/* Custom Scenario Input */}
              <div className="space-y-2">
                <button
                  onClick={() => { setUseCustom(!useCustom); setSelectedPersonaId(''); }}
                  className={`w-full p-4 rounded-2xl border text-left transition-all flex items-center gap-3 ${
                    useCustom
                      ? 'bg-orange-50 border-orange-200'
                      : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                  }`}
                >
                  <div className="w-8 h-8 rounded-xl bg-slate-100 flex items-center justify-center shrink-0">
                    <PenLine className="w-4 h-4 text-primary" />
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-800">Write Your Own Scenario</p>
                    <p className="text-[11px] text-slate-600">Describe what the customer wants — the TesterAgent will simulate it</p>
                  </div>
                </button>

                <AnimatePresence>
                  {useCustom && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      className="overflow-hidden"
                    >
                      <textarea
                        autoFocus
                        value={customScenario}
                        onChange={e => setCustomScenario(e.target.value)}
                        placeholder={`Example: A user in Jaipur wants to check their loyalty points and understand how to reach Gold tier. They are currently at Silver with 650 coins.`}
                        className="w-full h-32 p-4 bg-slate-50 border border-slate-200 rounded-2xl text-sm text-slate-800 placeholder:text-slate-400 resize-none focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary leading-relaxed"
                      />
                      <p className="text-[10px] text-slate-500 mt-1 px-1">
                        Tip: Be specific — mention the customer's situation, what they want to achieve, and any edge cases to test.
                      </p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="p-6 border-t border-slate-200 flex items-center justify-between shrink-0">
          {step === 'scenario' && (
            <button
              onClick={() => setStep('agent')}
              className="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-600 text-sm font-bold transition-colors"
            >
              ← Back
            </button>
          )}
          {step === 'agent' && <div />}

          <button
            disabled={step === 'agent' ? !selectedAgent : !canStart}
            onClick={() => {
              if (step === 'agent') {
                setStep('scenario');
              } else {
                onStart(selectedPersonaId, useCustom ? customScenario : undefined, selectedLanguage);
              }
            }}
            className="px-6 py-3 bg-primary hover:bg-primary/90 disabled:bg-slate-200 disabled:text-slate-400 rounded-2xl flex items-center gap-2 font-black uppercase text-sm tracking-widest transition-all text-white"
          >
            {step === 'agent' ? (
              <><ChevronRight className="w-4 h-4" /> Next</>
            ) : (
              <><Play className="w-4 h-4 fill-current" /> Start Duel</>
            )}
          </button>
        </div>
      </motion.div>
    </div>
  );
};

// ─── Main Arena View ──────────────────────────────────────────────────────────

export interface ArenaViewRef {
  handleCustomLaunch: (scenarioCtx: string) => void;
}

const ArenaView = forwardRef<ArenaViewRef>((_props, ref) => {
  const { isStreaming, setIsStreaming, setLastSimResult } = useDashboard();
  const [showDialog, setShowDialog] = useState(false);
  const [transcript, setTranscript] = useState<any[]>([]);
  const [currentStatus, setCurrentStatus] = useState<string>('');
  const [activePersonaName, setActivePersonaName] = useState<string>('');
  const [finalResult, setFinalResult] = useState<any | null>(null);
  const [allPersonas, setAllPersonas] = useState<Persona[]>([]);
  const [evidenceScenarios, setEvidenceScenarios] = useState<EvidenceScenario[]>([]);
  
  const eventSourceRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(ref, () => ({
    handleCustomLaunch: (scenarioCtx: string) => {
      startStreaming('custom', scenarioCtx, 'English');
    }
  }));

  useEffect(() => {
    fetchPersonas().then(setAllPersonas);
    fetchEvidence().then(setEvidenceScenarios);
  }, []);

  useEffect(() => () => { eventSourceRef.current?.close(); }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcript, currentStatus]);

  const stopSimulation = () => {
    eventSourceRef.current?.close();
    eventSourceRef.current = null;
    setIsStreaming(false);
    setCurrentStatus('Simulation stopped.');
  };

  const startStreaming = (personaId: string, customScenario?: string, language?: string) => {
    setShowDialog(false);

    // Resolve persona name for display
    if (personaId === 'custom') {
      setActivePersonaName('Custom Scenario');
    } else {
      const allEvidence = evidenceScenarios.map(s => s.persona);
      const found = [...allPersonas, ...allEvidence].find(p => p.id === personaId);
      setActivePersonaName(found?.name ?? personaId);
    }

    setIsStreaming(true);
    setTranscript([]);
    setFinalResult(null);
    setCurrentStatus('Initializing simulation...');

    const params = new URLSearchParams({ personaId });
    if (customScenario) params.set('evidenceContext', customScenario);
    if (language) params.set('language', language);

    const url = `https://api.aiagent.dev.chargecloud.net/api/arena/stream?${params.toString()}`;
    const eventSource = new EventSource(url);
    eventSourceRef.current = eventSource;

    const parse = (dataStr: string) => {
      try { return JSON.parse(dataStr); } catch { return null; }
    };

    eventSource.addEventListener('status', e => {
      const data = parse((e as MessageEvent).data);
      if (data?.message) setCurrentStatus(data.message);
    });

    eventSource.addEventListener('turn', e => {
      const data = parse((e as MessageEvent).data);
      if (data && 'role' in data && 'content' in data) {
        setTranscript(prev => [...prev, data]);
        setCurrentStatus('');
      }
    });

    eventSource.addEventListener('error', e => {
      parse((e as MessageEvent).data);
      setCurrentStatus('Simulation failed. Check logs.');
      setIsStreaming(false);
      eventSource.close();
      eventSourceRef.current = null;
    });

    eventSource.addEventListener('result', e => {
      const data = parse((e as MessageEvent).data);
      if (data) {
        setFinalResult(data);
        setLastSimResult(data);
        setIsStreaming(false);
        setCurrentStatus('');
        eventSource.close();
        eventSourceRef.current = null;
      }
    });
  };

  // Custom scenario → use special 'custom' personaId which the backend
  // resolves dynamically from the evidenceContext text.
  const handleStart = (personaId: string, customScenario?: string, language?: string) => {
    if (customScenario) {
      startStreaming('custom', customScenario, language);
    } else {
      startStreaming(personaId, undefined, language);
    }
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden relative bg-slate-50">

      {/* ── Dialog ── */}
      <AnimatePresence>
        {showDialog && (
          <RunDuelDialog
            onClose={() => setShowDialog(false)}
            onStart={handleStart}
          />
        )}
      </AnimatePresence>

      {/* ── Top Bar ── */}
      <div className="shrink-0 px-8 py-4 border-b border-slate-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-3">
          {activePersonaName && (
            <>
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span className="text-xs font-bold text-slate-500 uppercase tracking-widest">{activePersonaName}</span>
            </>
          )}
        </div>
        <div className="flex items-center gap-3">
          {isStreaming ? (
            <button
              onClick={stopSimulation}
              className="px-5 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 rounded-xl flex items-center gap-2 font-black uppercase text-xs tracking-widest transition-all"
            >
              <Square className="w-3.5 h-3.5 fill-current" /> Stop
            </button>
          ) : (
            <button
              onClick={() => setShowDialog(true)}
              className="px-5 py-2.5 bg-primary hover:bg-primary/90 rounded-xl flex items-center gap-2 font-black uppercase text-xs tracking-widest transition-all text-white"
            >
              <Play className="w-3.5 h-3.5 fill-current" /> Run Duel
            </button>
          )}
        </div>
      </div>

      {/* ── Transcript ── */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-10 space-y-8 custom-scrollbar">

        {/* Empty state */}
        {transcript.length === 0 && !isStreaming && !finalResult && (
          <div className="flex flex-col items-center justify-center h-full gap-6 opacity-40">
            <div className="w-20 h-20 rounded-3xl bg-orange-50 border border-orange-200 flex items-center justify-center">
              <Play className="w-8 h-8 text-primary" />
            </div>
            <div className="text-center">
              <p className="text-sm font-black uppercase tracking-widest text-slate-600">Arena Ready</p>
              <p className="text-xs text-slate-500 mt-1">Click Run Duel to select an agent and start a simulation</p>
            </div>
          </div>
        )}

        <AnimatePresence>
          {transcript.map((turn, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className={`flex gap-5 ${turn.role === 'agent' ? 'flex-row-reverse' : ''}`}
            >
              <div className={`w-10 h-10 rounded-2xl flex items-center justify-center shrink-0 border ${
                turn.role === 'agent'
                  ? 'bg-emerald-50 border-emerald-200'
                  : 'bg-orange-50 border-orange-200'
              }`}>
                {turn.role === 'agent'
                  ? <Bot className="w-5 h-5 text-emerald-600" />
                  : <User className="w-5 h-5 text-primary" />}
              </div>

              <div className="max-w-lg space-y-2">
                <div className={`flex items-center gap-2 ${turn.role === 'agent' ? 'flex-row-reverse' : ''}`}>
                  <span className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                    {turn.role === 'agent' ? 'CZ Agent' : 'Customer'}
                  </span>
                  {turn.metadata?.agentType && (
                    <span className="text-[9px] font-bold px-2 py-0.5 bg-emerald-50 text-emerald-600 border border-emerald-200 rounded uppercase">
                      {turn.metadata.agentType}
                    </span>
                  )}
                  {turn.metadata?.responseTimeMs && (
                    <span className={`text-[9px] font-bold px-2 py-0.5 rounded uppercase flex items-center gap-1 ${
                      turn.metadata.responseTimeMs > 6000
                        ? 'bg-red-50 text-red-600 border border-red-200'
                        : 'bg-slate-100 text-slate-600'
                    }`}>
                      <Clock className="w-2.5 h-2.5" />
                      {(turn.metadata.responseTimeMs / 1000).toFixed(1)}s
                    </span>
                  )}
                  {turn.metadata?.satisfiedWithResponse === false && (
                    <span className="text-[9px] font-bold px-2 py-0.5 bg-amber-50 text-amber-600 border border-amber-200 rounded uppercase">
                      Unsatisfied
                    </span>
                  )}
                </div>

                <div className={`p-4 rounded-2xl bg-white border ${
                  turn.role === 'agent'
                    ? 'rounded-tr-none border-emerald-200'
                    : 'rounded-tl-none border-orange-200'
                }`}>
                  <p className="text-sm leading-relaxed text-slate-800">{turn.content}</p>

                  {/* Suggested Actions (Buttons) */}
                  {turn.metadata?.suggestedActions && turn.metadata.suggestedActions.length > 0 && (
                    <div className="mt-4 flex flex-wrap gap-2">
                      {turn.metadata.suggestedActions.map((action: any, idx: number) => (
                        <button
                          key={idx}
                          disabled={isStreaming}
                          className="px-4 py-1.5 bg-slate-100 border border-slate-200 hover:bg-slate-200 rounded-full text-[11px] font-bold text-slate-700 transition-all"
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Special: Location Share Request */}
                  {turn.metadata?.data?.requestLocationShare && (
                    <div className="mt-4 border-t border-slate-200 pt-4">
                      <button
                        disabled={isStreaming}
                        className="w-full flex items-center justify-between p-3 rounded-2xl bg-blue-50 border border-blue-200 hover:bg-blue-100 transition-all text-left"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                            <MapPin className="w-4 h-4 text-blue-600" />
                          </div>
                          <div>
                            <p className="text-xs font-bold text-blue-600">Share Live Location</p>
                            <p className="text-[10px] text-slate-500 uppercase tracking-widest mt-0.5">Mock GPS available</p>
                          </div>
                        </div>
                        <ChevronRight className="w-4 h-4 text-blue-400" />
                      </button>
                    </div>
                  )}

                  {turn.metadata?.thought && (
                    <div className="mt-3 pt-3 border-t border-slate-200">
                      <div className="flex items-center gap-1.5 mb-1.5">
                        <Brain className="w-3 h-3 text-primary/60" />
                        <span className="text-[9px] font-black uppercase tracking-widest text-slate-500">Thought</span>
                      </div>
                      <p className="text-[11px] text-slate-600 italic leading-relaxed">{turn.metadata.thought}</p>
                    </div>
                  )}
                </div>
              </div>
            </motion.div>
          ))}

          {/* Loading indicator */}
          {isStreaming && currentStatus && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex items-center gap-3 py-4 px-2"
            >
              <div className="flex gap-1">
                {[0, 1, 2].map(i => (
                  <motion.div
                    key={i}
                    animate={{ y: [0, -5, 0] }}
                    transition={{ repeat: Infinity, duration: 0.5, delay: i * 0.1 }}
                    className="w-1.5 h-1.5 rounded-full bg-primary"
                  />
                ))}
              </div>
              <span className="text-xs text-primary/70 italic">{currentStatus}</span>
            </motion.div>
          )}

          {/* Final Result */}
          {finalResult && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-6 pt-6 border-t border-slate-200"
            >
              <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-xs font-black uppercase tracking-widest text-primary flex items-center gap-2">
                    <Terminal className="w-4 h-4" /> Judge Report
                    {finalResult.agentVersion && (
                      <span className="ml-2 px-2 py-0.5 bg-orange-50 border border-orange-200 rounded uppercase text-[8px] text-primary tracking-widest">
                        v{finalResult.agentVersion}
                      </span>
                    )}
                  </h3>
                  <div className={`px-3 py-1 rounded-full text-xs font-black tracking-widest border ${
                    finalResult.success
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                      : 'bg-red-50 border-red-200 text-red-600'
                  }`}>
                    {finalResult.success ? 'PASSED' : 'FAILED'}
                  </div>
                </div>

                <div className="flex gap-3 mb-4">
                  {finalResult.success
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    : <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />}
                  <p className="text-sm text-slate-700 leading-relaxed italic">"{finalResult.judgeReasoning}"</p>
                </div>

                {/* Scores */}
                <div className="flex gap-6 pt-4 border-t border-slate-200">
                  <div>
                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Score</p>
                    <p className="text-2xl font-black text-primary">{finalResult.score ?? 0}</p>
                  </div>
                  {finalResult.llmScore !== undefined && finalResult.llmScore !== finalResult.score && (
                    <div>
                      <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">LLM Raw</p>
                      <p className="text-2xl font-black text-slate-500">{finalResult.llmScore}</p>
                    </div>
                  )}
                  <div>
                    <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Turns</p>
                    <p className="text-2xl font-black text-slate-600">{finalResult.totalTurns ?? 0}</p>
                  </div>
                  {finalResult.deterministicChecks?.avgResponseTimeMs > 0 && (
                    <div>
                      <p className="text-[9px] font-bold text-slate-500 uppercase mb-1">Avg Time</p>
                      <p className={`text-2xl font-black ${finalResult.deterministicChecks.avgResponseTimeMs > 6000 ? 'text-red-600' : 'text-slate-600'}`}>
                        {(finalResult.deterministicChecks.avgResponseTimeMs / 1000).toFixed(1)}s
                      </p>
                    </div>
                  )}
                </div>

                {/* Penalties */}
                {finalResult.deterministicChecks?.penalties?.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-slate-200 space-y-1">
                    {finalResult.deterministicChecks.penalties.map((p: string, i: number) => (
                      <div key={i} className="flex items-start gap-2 text-[11px] text-red-600">
                        <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
                        <span>{p}</span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Regression Alert */}
                {finalResult.regressionAlert?.triggered && (
                  <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 font-bold">
                    ⚠️ {finalResult.regressionAlert.message}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
});

export default ArenaView;
