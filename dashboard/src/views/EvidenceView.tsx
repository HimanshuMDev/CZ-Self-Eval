import React, { useState, useEffect, useRef } from 'react';
import { fetchEvidence, runSimulation, type Persona, type Goal } from '../api';
import {
  Bug, ArrowRight, ShieldAlert, Cpu, Play, CheckCircle2, XCircle,
  Loader2, AlertTriangle, Zap, GitBranch, MessageSquare, Brain,
  RefreshCw, FlaskConical, ChevronDown, ChevronUp,
} from 'lucide-react';
import { useDashboard } from '../store/DashboardContext';
import localEvidence, { type LocalEvidence } from '../data/localEvidence';

// ─── Constants ────────────────────────────────────────────────────────────────

const BOT_URL    = 'https://api.aiagent.dev.chargecloud.net/api/whatsapp/simulate';
const TEST_FROM  = '919000000001'; // dedicated test number — won't clash with real users
const TEST_NAME  = 'EvalBot';

// ─── Bot caller ───────────────────────────────────────────────────────────────

async function callBot(message: string): Promise<string> {
  const res = await fetch(BOT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: TEST_FROM, name: TEST_NAME, message }),
  });
  if (!res.ok) throw new Error(`Bot returned ${res.status}: ${res.statusText}`);
  const data = await res.json();

  // Same parsing as ManualChatView: { success, response: { content, ... }, agentType }
  if (data?.success && data?.response?.content) return String(data.response.content);

  // Fallbacks for other shapes
  if (typeof data === 'string') return data;
  if (Array.isArray(data)) return data.map((m: any) => m?.content ?? m?.text ?? m?.body ?? String(m)).join('\n');
  if (data?.content)   return String(data.content);
  if (data?.text)      return String(data.text);
  if (data?.body)      return String(data.body);
  if (data?.message && typeof data.message === 'string') return data.message;

  // Last resort — stringify so evaluateResponse always gets a string
  return JSON.stringify(data);
}

// ─── Evaluator ────────────────────────────────────────────────────────────────

/** Extract the sentence/line in the response that contains a keyword */
function extractSnippet(text: string, keyword: string): string {
  // Split by sentence boundaries or newlines
  const sentences = text.split(/(?<=[.!?\n])\s+|[\n]/);
  const lower = keyword.toLowerCase();
  const hit = sentences.find(s => s.toLowerCase().includes(lower));
  if (!hit) return '';
  // Trim to max ~120 chars, centered around the keyword
  const idx = hit.toLowerCase().indexOf(lower);
  const start = Math.max(0, idx - 40);
  const end = Math.min(hit.length, idx + keyword.length + 80);
  const snippet = hit.slice(start, end).trim();
  return (start > 0 ? '…' : '') + snippet + (end < hit.length ? '…' : '');
}

function evaluateResponse(
  responseText: string,
  failKeywords: string[],
  passKeywords?: string[],
): { pass: boolean; reason: string; detail?: string } {
  const lower = responseText.toLowerCase();

  // Check fail keywords first
  for (const kw of failKeywords) {
    try {
      const regex = new RegExp(kw, 'i');
      if (regex.test(responseText)) {
        const snippet = extractSnippet(responseText, kw.replace(/[.*+?^${}()|[\]\\]/g, ''));
        return {
          pass: false,
          reason: `Bot gave a wrong/incomplete response — it ${kw.includes('.*') ? 'produced a contradictory answer' : `said something it shouldn't have`}.`,
          detail: snippet ? `Bot said: "${snippet}"` : undefined,
        };
      }
    } catch {
      if (lower.includes(kw.toLowerCase())) {
        const snippet = extractSnippet(responseText, kw);
        return {
          pass: false,
          reason: `Bot gave a wrong/incomplete response — it said something it shouldn't have.`,
          detail: snippet ? `Bot said: "${snippet}"` : undefined,
        };
      }
    }
  }

  // If passKeywords defined, ALL must be present
  if (passKeywords && passKeywords.length > 0) {
    const missing = passKeywords.filter(kw => !lower.includes(kw.toLowerCase()));
    if (missing.length > 0) {
      // Find what the bot DID say (first 120 chars as context)
      const botSaid = responseText.trim().slice(0, 150).replace(/\n+/g, ' ');
      return {
        pass: false,
        reason: `Bot didn't address the key points — expected to mention: ${missing.map(k => `"${k}"`).join(', ')}.`,
        detail: `Bot said: "${botSaid}${responseText.length > 150 ? '…' : ''}"`,
      };
    }
  }

  return { pass: true, reason: 'Response met all expected criteria — no failure patterns detected.' };
}

// ─── Category config ──────────────────────────────────────────────────────────

const CATEGORY_CONFIG: Record<LocalEvidence['category'], {
  label: string;
  icon: React.ReactNode;
  color: string;
  bg: string;
  border: string;
}> = {
  'knowledge-gap':    { label: 'Knowledge Gap',    icon: <Brain className="w-3 h-3" />,       color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200' },
  'missing-info':     { label: 'Missing Info',      icon: <AlertTriangle className="w-3 h-3" />, color: 'text-amber-600',  bg: 'bg-amber-50',  border: 'border-amber-200' },
  'routing-failure':  { label: 'Routing Failure',   icon: <GitBranch className="w-3 h-3" />,    color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200' },
  'conversation-flow':{ label: 'Flow Issue',        icon: <MessageSquare className="w-3 h-3" />, color: 'text-blue-600',   bg: 'bg-blue-50',   border: 'border-blue-200' },
  'wrong-behavior':   { label: 'Wrong Behavior',    icon: <Zap className="w-3 h-3" />,           color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
};

const SEVERITY_CONFIG: Record<LocalEvidence['severity'], { label: string; color: string; dot: string }> = {
  critical: { label: 'Critical', color: 'text-red-600',    dot: 'bg-red-500' },
  high:     { label: 'High',     color: 'text-orange-500', dot: 'bg-orange-400' },
  medium:   { label: 'Medium',   color: 'text-yellow-600', dot: 'bg-yellow-400' },
};

// ─── Types ────────────────────────────────────────────────────────────────────

type EvidenceItem =
  | { source: 'local';  data: LocalEvidence }
  | { source: 'remote'; data: { persona: Persona; goal: Goal } };

type FilterCategory = 'all' | LocalEvidence['category'];

interface ScenarioResult {
  pass: boolean;
  score?: number;
  reason?: string;
  detail?: string;   // exact quote / snippet from bot response showing the problem
  response?: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

const EvidenceView: React.FC = () => {
  const [remoteEvidence, setRemoteEvidence] = useState<{ persona: Persona; goal: Goal }[]>([]);
  const [isBatchRunning, setIsBatchRunning]  = useState(false);
  const [batchProgress, setBatchProgress]   = useState<{ current: number; total: number; name: string } | null>(null);
  const [batchSummary, setBatchSummary]     = useState<{ passed: number; total: number; results: { id: string; name: string; pass: boolean; reason?: string; detail?: string }[] } | null>(null);
  const [batchError, setBatchError]         = useState<string | null>(null);
  const [running, setRunning]               = useState<Set<string>>(new Set());
  const [results, setResults]               = useState<Record<string, ScenarioResult>>({});
  const [expanded, setExpanded]             = useState<Set<string>>(new Set());
  const [activeFilter, setActiveFilter]     = useState<FilterCategory>('all');
  const abortRef                            = useRef(false);
  const { setView: setCurrentView }         = useDashboard();

  useEffect(() => {
    fetchEvidence().then(setRemoteEvidence).catch(() => {});
  }, []);

  const allItems: EvidenceItem[] = [
    ...localEvidence.map(d => ({ source: 'local' as const, data: d })),
    ...remoteEvidence.map(d => ({ source: 'remote' as const, data: d })),
  ];

  const filteredItems = activeFilter === 'all'
    ? allItems
    : allItems.filter(i => i.source === 'local' && i.data.category === activeFilter);

  const categoryCounts = localEvidence.reduce((acc, e) => {
    acc[e.category] = (acc[e.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const toggleExpanded = (id: string) =>
    setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  // ── Run one local scenario against the real bot ───────────────────────────

  const runLocalScenario = async (ev: LocalEvidence): Promise<ScenarioResult> => {
    try {
      const responseText = await callBot(ev.testMessage);
      const { pass, reason, detail } = evaluateResponse(responseText, ev.failKeywords, ev.passKeywords);
      return { pass, reason, detail, response: responseText };
    } catch (e: any) {
      return { pass: false, reason: `Could not reach the bot: ${e?.message ?? 'Unknown error'}` };
    }
  };

  // ── Run one remote scenario via runSimulation ────────────────────────────

  const runRemoteScenario = async (personaId: string, goalId: string): Promise<ScenarioResult> => {
    try {
      const raw   = await runSimulation(personaId, goalId);
      const score = raw?.score ?? raw?.result?.score ?? raw?.evaluation?.score ?? null;
      const pass  = score !== null ? Number(score) >= 0.7 : Boolean(raw?.passed ?? raw?.result?.passed ?? raw?.success);
      return { pass, score: score !== null ? Number(score) : undefined };
    } catch (e: any) {
      return { pass: false, reason: `API error: ${e?.message ?? 'Unknown error'}` };
    }
  };

  // ── Per-card run button ───────────────────────────────────────────────────

  const handleRunOne = async (id: string, runner: () => Promise<ScenarioResult>) => {
    if (running.has(id)) return;
    setRunning(prev => new Set(prev).add(id));
    setResults(prev => { const n = { ...prev }; delete n[id]; return n; });
    const result = await runner();
    setResults(prev => ({ ...prev, [id]: result }));
    setRunning(prev => { const n = new Set(prev); n.delete(id); return n; });
    // Auto-expand to show response if failed
    if (!result.pass) setExpanded(prev => new Set(prev).add(id));
  };

  // ── Full batch suite ─────────────────────────────────────────────────────

  const handleRunBatch = async () => {
    if (isBatchRunning) return;
    abortRef.current = false;
    setIsBatchRunning(true);
    setBatchSummary(null);
    setBatchError(null);

    const items: { id: string; name: string; runner: () => Promise<ScenarioResult> }[] = [
      ...localEvidence.map(ev => ({
        id: ev.persona.id,
        name: ev.persona.name,
        runner: () => runLocalScenario(ev),
      })),
      ...remoteEvidence.map(item => ({
        id: item.persona?.id ?? '',
        name: item.persona?.name ?? 'Remote Scenario',
        runner: () => runRemoteScenario(item.persona?.id ?? '', item.goal?.id ?? ''),
      })).filter(x => x.id),
    ];

    const batchResults: { id: string; name: string; pass: boolean; reason?: string; detail?: string }[] = [];
    let passed = 0;

    for (let i = 0; i < items.length; i++) {
      if (abortRef.current) break;
      const item = items[i];
      setBatchProgress({ current: i + 1, total: items.length, name: item.name });
      setRunning(prev => new Set(prev).add(item.id));

      const result = await item.runner();
      setResults(prev => ({ ...prev, [item.id]: result }));
      setRunning(prev => { const n = new Set(prev); n.delete(item.id); return n; });
      batchResults.push({ id: item.id, name: item.name, pass: result.pass, reason: result.reason, detail: result.detail });
      if (result.pass) passed++;
    }

    setBatchSummary({ passed, total: batchResults.length, results: batchResults });
    setBatchProgress(null);
    setIsBatchRunning(false);
  };

  const handleStopBatch = () => {
    abortRef.current = true;
    setIsBatchRunning(false);
    setBatchProgress(null);
  };

  // ─── Render ───────────────────────────────────────────────────────────────

  const totalScenarios = localEvidence.length + remoteEvidence.length;
  const passCount  = Object.values(results).filter(r => r.pass).length;
  const failCount  = Object.values(results).filter(r => !r.pass).length;
  const ranCount   = Object.keys(results).length;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50">
      <div className="max-w-5xl mx-auto p-8 space-y-6">

        {/* ── Header ── */}
        <header className="space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center border border-red-200">
                <Bug className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Evidence Library</h1>
                <p className="text-xs text-slate-400">
                  {localEvidence.length} local traces · {remoteEvidence.length} LangSmith scenarios
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isBatchRunning && (
                <button
                  onClick={handleStopBatch}
                  className="px-3 py-2 text-xs font-semibold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-all"
                >
                  Stop
                </button>
              )}
              <button
                onClick={handleRunBatch}
                disabled={isBatchRunning}
                className={`flex items-center gap-2 px-5 py-2.5 border rounded-xl transition-all ${
                  isBatchRunning
                    ? 'bg-orange-50 border-orange-200 cursor-not-allowed'
                    : 'bg-red-50 hover:bg-red-100 border-red-200 cursor-pointer'
                }`}
              >
                {isBatchRunning
                  ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                  : <FlaskConical className="w-4 h-4 text-red-500" />
                }
                <span className="text-xs font-semibold text-red-600">
                  {isBatchRunning
                    ? `${batchProgress ? `${batchProgress.current}/${batchProgress.total}` : '…'} Running`
                    : `Run All (${totalScenarios})`}
                </span>
              </button>
            </div>
          </div>

          <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
            Scenarios extracted from real failing ChargeZone sessions. Each local trace sends a real message to the live bot and checks the response. Remote traces run via the LangSmith evaluation pipeline.
          </p>

          {/* Live stats strip */}
          {ranCount > 0 && (
            <div className="flex items-center gap-4 p-3 bg-white border border-slate-200 rounded-xl">
              <span className="text-xs text-slate-400 font-medium">Results so far</span>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                <span className="text-xs font-bold text-emerald-600">{passCount} passed</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-red-500" />
                <span className="text-xs font-bold text-red-500">{failCount} failed</span>
              </div>
              <span className="text-xs text-slate-300">·</span>
              <span className="text-xs text-slate-400">{ranCount} / {totalScenarios} tested</span>
              <button
                onClick={() => setResults({})}
                className="ml-auto text-[10px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
              >
                Clear results
              </button>
            </div>
          )}
        </header>

        {/* ── Category Filter ── */}
        <div className="flex flex-wrap gap-2">
          {(() => {
            type CfgEntry = [FilterCategory, string, typeof CATEGORY_CONFIG[LocalEvidence['category']] | null];
            const entries: CfgEntry[] = [
              ['all', 'All', null],
              ...(Object.entries(CATEGORY_CONFIG) as [LocalEvidence['category'], typeof CATEGORY_CONFIG[LocalEvidence['category']]][])
                .map(([cat, cfg]): CfgEntry => [cat, cfg.label, cfg]),
            ];
            return entries;
          })().map(([cat, label, cfg]) => {
            const count  = cat === 'all' ? allItems.length : (categoryCounts[cat] || 0);
            const active = activeFilter === cat;
            return (
              <button
                key={cat}
                onClick={() => setActiveFilter(cat as FilterCategory)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  active && cfg
                    ? `${cfg.bg} ${cfg.color} ${cfg.border}`
                    : active
                      ? 'bg-slate-800 text-white border-slate-800'
                      : 'bg-white text-slate-500 border-slate-200 hover:border-slate-300'
                }`}
              >
                {cfg && <span>{cfg.icon}</span>}
                {label}
                <span className={`px-1.5 py-0.5 rounded-md text-[10px] font-bold ${
                  active && cfg ? `${cfg.color} bg-white/60` : active ? 'bg-white/20 text-white' : 'bg-slate-100 text-slate-600'
                }`}>{count}</span>
              </button>
            );
          })}
        </div>

        {/* ── Batch Progress ── */}
        {isBatchRunning && batchProgress && (
          <div className="bg-white border border-orange-200 rounded-2xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-bold text-orange-600">Running test suite</p>
                <p className="text-xs text-slate-500 mt-0.5">
                  {batchProgress.current}/{batchProgress.total} — <span className="font-semibold text-slate-700">{batchProgress.name}</span>
                </p>
              </div>
              <span className="text-sm font-bold text-slate-700">
                {Math.round((batchProgress.current / batchProgress.total) * 100)}%
              </span>
            </div>
            <div className="w-full h-1.5 bg-orange-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-orange-500 transition-all duration-300 rounded-full"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }}
              />
            </div>
          </div>
        )}

        {/* ── Batch Error ── */}
        {batchError && (
          <div className="flex items-start gap-3 bg-red-50 border border-red-200 rounded-xl p-4">
            <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-red-700">Error</p>
              <p className="text-xs text-red-500 mt-0.5">{batchError}</p>
            </div>
            <button onClick={() => setBatchError(null)} className="text-red-400 hover:text-red-600 text-xs font-bold">✕</button>
          </div>
        )}

        {/* ── Batch Summary ── */}
        {batchSummary && !isBatchRunning && (
          <div className={`bg-white border rounded-2xl p-6 shadow-sm ${
            batchSummary.passed === batchSummary.total ? 'border-emerald-200' : 'border-red-200'
          }`}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center border ${
                  batchSummary.passed === batchSummary.total
                    ? 'bg-emerald-50 border-emerald-200'
                    : 'bg-red-50 border-red-200'
                }`}>
                  {batchSummary.passed === batchSummary.total
                    ? <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                    : <XCircle className="w-5 h-5 text-red-500" />
                  }
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-800">
                    {batchSummary.passed}/{batchSummary.total} passed
                  </p>
                  <p className="text-xs text-slate-400">
                    {batchSummary.total - batchSummary.passed} scenario{batchSummary.total - batchSummary.passed !== 1 ? 's' : ''} need attention
                  </p>
                </div>
              </div>
              <button onClick={() => setBatchSummary(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-600">
                Dismiss
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {batchSummary.results.map((r, i) => (
                <div
                  key={i}
                  className={`p-3 rounded-xl border space-y-1.5 ${
                    r.pass ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    {r.pass
                      ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                      : <XCircle className="w-3.5 h-3.5 text-red-500 shrink-0 mt-0.5" />
                    }
                    <p className="text-[11px] font-semibold text-slate-700 leading-snug">{r.name}</p>
                  </div>
                  {r.reason && (
                    <p className={`text-[10px] leading-snug pl-5 ${r.pass ? 'text-emerald-600' : 'text-red-600'}`}>
                      {r.reason}
                    </p>
                  )}
                  {!r.pass && r.detail && (
                    <p className="text-[10px] leading-snug pl-5 text-red-400 italic border-l-2 border-red-300 ml-5">
                      {r.detail}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Evidence Cards ── */}
        <div className="grid gap-3">
          {filteredItems.map((item, index) => {
            if (item.source === 'local') {
              const ev      = item.data;
              const catCfg  = CATEGORY_CONFIG[ev.category];
              const sevCfg  = SEVERITY_CONFIG[ev.severity];
              const isRunning = running.has(ev.persona.id);
              const result    = results[ev.persona.id];
              const isExpanded = expanded.has(ev.persona.id);

              return (
                <div
                  key={ev.persona.id}
                  className={`bg-white border rounded-2xl shadow-sm transition-all group ${
                    result
                      ? result.pass
                        ? 'border-emerald-200 hover:border-emerald-300'
                        : 'border-red-200 hover:border-red-300'
                      : 'border-slate-200 hover:border-slate-300'
                  }`}
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-3">

                        {/* Title row */}
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md">
                            #{index + 1}
                          </span>
                          <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-md border ${catCfg.bg} ${catCfg.color} ${catCfg.border}`}>
                            {catCfg.icon}{catCfg.label}
                          </span>
                          <span className={`flex items-center gap-1.5 text-[10px] font-semibold ${sevCfg.color}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${sevCfg.dot}`} />
                            {sevCfg.label}
                          </span>
                          {result && (
                            <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              result.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                            }`}>
                              {result.pass ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {result.pass ? 'PASS' : 'FAIL'}
                            </span>
                          )}
                          <h3 className="text-sm font-bold text-slate-800">{ev.persona.name}</h3>
                        </div>

                        <p className="text-sm text-slate-500 leading-relaxed">{ev.persona.description}</p>

                        {/* Test message chip */}
                        <div className="flex items-start gap-2 p-2.5 bg-slate-50 rounded-xl border border-slate-200">
                          <MessageSquare className="w-3.5 h-3.5 text-slate-400 mt-0.5 shrink-0" />
                          <p className="text-xs text-slate-600 italic">"{ev.testMessage}"</p>
                        </div>

                        {/* Expand/collapse details */}
                        <button
                          onClick={() => toggleExpanded(ev.persona.id)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {isExpanded ? 'Hide details' : 'Show behavior rules & success condition'}
                        </button>

                        {isExpanded && (
                          <div className="grid grid-cols-2 gap-4 pt-1">
                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                <ShieldAlert className="w-3 h-3" /> Behavior Rules
                              </div>
                              <ul className="space-y-1.5">
                                {ev.persona.behaviorRules.map((rule, i) => (
                                  <li key={i} className="text-xs text-slate-600 flex gap-2">
                                    <span className="text-red-400 mt-0.5 shrink-0">•</span>
                                    <span className="leading-snug">{rule}</span>
                                  </li>
                                ))}
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                <Cpu className="w-3 h-3" /> Success Condition
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed p-3 bg-slate-50 border border-slate-200 rounded-xl">
                                {ev.goal.successCondition}
                              </p>
                            </div>
                          </div>
                        )}

                        {/* Result reason — always visible after run */}
                        {result && result.reason && (
                          <div className={`rounded-xl border px-3.5 py-3 space-y-1.5 ${
                            result.pass
                              ? 'bg-emerald-50 border-emerald-200'
                              : 'bg-red-50 border-red-200'
                          }`}>
                            {/* Label + reason */}
                            <div className="flex items-start gap-2.5">
                              {result.pass
                                ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 mt-0.5 shrink-0" />
                                : <XCircle className="w-3.5 h-3.5 text-red-500 mt-0.5 shrink-0" />
                              }
                              <div className="min-w-0">
                                <p className={`text-[10px] font-bold uppercase tracking-widest mb-0.5 ${
                                  result.pass ? 'text-emerald-600' : 'text-red-500'
                                }`}>
                                  {result.pass ? 'Why it passed' : 'Why it failed'}
                                </p>
                                <p className={`text-xs font-medium leading-relaxed ${
                                  result.pass ? 'text-emerald-700' : 'text-red-700'
                                }`}>
                                  {result.reason}
                                </p>
                              </div>
                            </div>
                            {/* Exact quote from bot — only on failure */}
                            {!result.pass && result.detail && (
                              <div className="ml-6 pl-3 border-l-2 border-red-300">
                                <p className="text-[10px] font-semibold text-red-400 uppercase tracking-widest mb-0.5">Evidence</p>
                                <p className="text-xs text-red-800 italic leading-relaxed">{result.detail}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {/* Bot response — collapsible */}
                        {result?.response && (
                          <details className="group/resp">
                            <summary className={`cursor-pointer text-[11px] font-semibold flex items-center gap-1 select-none ${
                              result.pass ? 'text-emerald-600 hover:text-emerald-800' : 'text-red-500 hover:text-red-700'
                            }`}>
                              <ChevronDown className="w-3 h-3 transition-transform group-open/resp:rotate-180" />
                              View full bot response
                            </summary>
                            <div className={`mt-2 rounded-xl border p-3 ${
                              result.pass ? 'bg-emerald-50/60 border-emerald-200' : 'bg-red-50/60 border-red-200'
                            }`}>
                              <p className="text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{result.response}</p>
                            </div>
                          </details>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="shrink-0 flex flex-col gap-2">
                        <button
                          onClick={() => handleRunOne(ev.persona.id, () => runLocalScenario(ev))}
                          disabled={isRunning}
                          className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all ${
                            isRunning
                              ? 'bg-orange-50 border-orange-200 cursor-not-allowed'
                              : result
                                ? result.pass
                                  ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100'
                                  : 'bg-red-50 border-red-200 hover:bg-red-100'
                                : 'bg-slate-50 border-slate-200 hover:bg-orange-50 hover:border-orange-300'
                          }`}
                          title="Run this test against the live bot"
                        >
                          {isRunning
                            ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                            : result
                              ? result.pass
                                ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                                : <RefreshCw className="w-4 h-4 text-red-500" />
                              : <Play className="w-4 h-4 text-slate-400" />
                          }
                        </button>
                        <button
                          onClick={() => setCurrentView('arena')}
                          className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 hover:bg-red-50 hover:border-red-200 flex items-center justify-center transition-all"
                          title="Open in Arena"
                        >
                          <ArrowRight className="w-4 h-4 text-slate-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );

            } else {
              // Remote evidence
              const { persona, goal } = item.data;
              const pid = persona?.id;
              const gid = goal?.id;
              const isRunning  = pid ? running.has(pid) : false;
              const result     = pid ? results[pid] : undefined;
              const isExpanded = pid ? expanded.has(pid) : false;

              return (
                <div
                  key={pid || index}
                  className={`bg-white border rounded-2xl shadow-sm transition-all group ${
                    result
                      ? result.pass ? 'border-emerald-200' : 'border-red-200'
                      : 'border-slate-200 hover:border-blue-200'
                  }`}
                >
                  <div className="p-5">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1 min-w-0 space-y-3">
                        <div className="flex items-center flex-wrap gap-2">
                          <span className="text-[10px] font-semibold px-2 py-0.5 bg-slate-100 text-slate-500 rounded-md">#{index + 1}</span>
                          <span className="text-[10px] font-semibold px-2 py-0.5 bg-blue-50 text-blue-600 border border-blue-200 rounded-md">LangSmith</span>
                          {result && (
                            <span className={`flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md ${
                              result.pass ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-600'
                            }`}>
                              {result.pass ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
                              {result.pass ? 'PASS' : 'FAIL'}
                              {result.score !== undefined && ` · ${(result.score * 100).toFixed(0)}%`}
                            </span>
                          )}
                          <h3 className="text-sm font-bold text-slate-800">{persona?.name || 'Unknown Scenario'}</h3>
                        </div>
                        <p className="text-sm text-slate-500">{persona?.description || 'No description available.'}</p>

                        <button
                          onClick={() => pid && toggleExpanded(pid)}
                          className="flex items-center gap-1 text-[11px] font-semibold text-slate-400 hover:text-slate-600 transition-colors"
                        >
                          {isExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                          {isExpanded ? 'Hide details' : 'Show details'}
                        </button>

                        {isExpanded && (
                          <div className="grid grid-cols-2 gap-4 pt-1">
                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                <ShieldAlert className="w-3 h-3" /> Behavior Rules
                              </div>
                              <ul className="space-y-1.5">
                                {Array.isArray((persona as any)?.behaviorRules)
                                  ? (persona as any).behaviorRules.map((r: string, i: number) => (
                                      <li key={i} className="text-xs text-slate-600 flex gap-2">
                                        <span className="text-red-400 mt-0.5 shrink-0">•</span>
                                        <span>{r}</span>
                                      </li>
                                    ))
                                  : <li className="text-xs text-slate-400">No behavior rules defined.</li>
                                }
                              </ul>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-widest">
                                <Cpu className="w-3 h-3" /> Success Condition
                              </div>
                              <p className="text-xs text-slate-600 leading-relaxed p-3 bg-slate-50 border border-slate-200 rounded-xl">
                                {(goal as any)?.successCondition || goal?.objective || 'N/A'}
                              </p>
                            </div>
                          </div>
                        )}
                      </div>

                      <div className="shrink-0 flex flex-col gap-2">
                        <button
                          onClick={() => pid && gid && handleRunOne(pid, () => runRemoteScenario(pid, gid))}
                          disabled={isRunning || !pid || !gid}
                          className={`w-10 h-10 rounded-xl border flex items-center justify-center transition-all ${
                            isRunning
                              ? 'bg-orange-50 border-orange-200 cursor-not-allowed'
                              : result
                                ? result.pass ? 'bg-emerald-50 border-emerald-200 hover:bg-emerald-100' : 'bg-red-50 border-red-200 hover:bg-red-100'
                                : 'bg-slate-50 border-slate-200 hover:bg-blue-50 hover:border-blue-200'
                          }`}
                          title="Run via LangSmith"
                        >
                          {isRunning
                            ? <Loader2 className="w-4 h-4 text-orange-500 animate-spin" />
                            : result
                              ? result.pass ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <RefreshCw className="w-4 h-4 text-red-500" />
                              : <Play className="w-4 h-4 text-slate-400" />
                          }
                        </button>
                        <button
                          onClick={() => setCurrentView('arena')}
                          className="w-10 h-10 rounded-xl bg-slate-50 border border-slate-200 hover:bg-red-50 hover:border-red-200 flex items-center justify-center transition-all"
                          title="Open in Arena"
                        >
                          <ArrowRight className="w-4 h-4 text-slate-400" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              );
            }
          })}

          {filteredItems.length === 0 && (
            <div className="py-20 text-center border border-dashed border-slate-300 rounded-2xl bg-white">
              <Bug className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-400">No scenarios match this filter.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EvidenceView;
