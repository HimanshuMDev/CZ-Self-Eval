import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Award, Play, Plus, Edit2, Trash2, X, Shield, AlertTriangle,
  CheckCircle2, XCircle, Activity, Loader2, Zap, Filter, Save,
  Bot, Clock, TrendingUp, AlertCircle, Sparkles, ShieldCheck,
} from 'lucide-react';
import {
  fetchGoldenScenarios,
  createGoldenScenario,
  updateGoldenScenario,
  deleteGoldenScenario,
  runGoldenScenario,
  runGoldenBatch,
  type GoldenScenario,
  type GoldenLanguage,
  type GoldenSubAgent,
  type GoldenRunAggregate,
} from '../api';

// ─── Config ──────────────────────────────────────────────────────────────────

const LANGUAGES: GoldenLanguage[] = ['English', 'Hindi', 'Hinglish'];
const SUB_AGENTS: Exclude<GoldenSubAgent, null>[] = ['discovery', 'session', 'payment', 'support', 'faq'];

const SUB_AGENT_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  discovery: { bg: 'bg-blue-50',    text: 'text-blue-700',    border: 'border-blue-200' },
  session:   { bg: 'bg-violet-50',  text: 'text-violet-700',  border: 'border-violet-200' },
  payment:   { bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
  support:   { bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200' },
  faq:       { bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200' },
};

const emptyScenario = (): Partial<GoldenScenario> => ({
  id: '',
  title: '',
  description: '',
  language: 'English',
  expectedSubAgent: null,
  initialMessage: '',
  expectedAnswer: '',
  passKeywords: [],
  failKeywords: [],
  tags: [],
  mustPass: false,
  minScore: 0.5,
  notes: '',
});

// ─── Component ───────────────────────────────────────────────────────────────

const GoldenSetView: React.FC = () => {
  const [scenarios, setScenarios] = useState<GoldenScenario[]>([]);
  const [loading, setLoading]     = useState(true);
  const [error, setError]         = useState<string | null>(null);

  // Per-scenario run state
  const [running, setRunning]       = useState<Set<string>>(new Set());
  const [results, setResults]       = useState<Record<string, GoldenRunAggregate>>({});
  const [expanded, setExpanded]     = useState<Set<string>>(new Set());

  // Filters
  const [filterLang, setFilterLang]         = useState<'all' | GoldenLanguage>('all');
  const [filterSubAgent, setFilterSubAgent] = useState<'all' | Exclude<GoldenSubAgent, null>>('all');
  const [filterMustPass, setFilterMustPass] = useState(false);
  const [searchQuery, setSearchQuery]       = useState('');

  // Editor modal
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing]       = useState<Partial<GoldenScenario> | null>(null);

  // Batch state
  const [batchState, setBatchState] = useState<{
    running: boolean;
    current: number;
    total: number;
    currentTitle: string;
    summary?: { passed: number; failed: number; mustPassFailures: number; flaky: number; total: number };
  }>({ running: false, current: 0, total: 0, currentTitle: '' });
  const batchRef = useRef<EventSource | null>(null);

  const [n, setN] = useState(3);

  // ── Load ─────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await fetchGoldenScenarios();
      setScenarios(data.scenarios);
    } catch (err: any) {
      setError(err?.message || 'Failed to load golden scenarios');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    return () => { batchRef.current?.close(); };
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    return scenarios.filter(s => {
      if (filterLang !== 'all' && s.language !== filterLang) return false;
      if (filterSubAgent !== 'all' && s.expectedSubAgent !== filterSubAgent) return false;
      if (filterMustPass && !s.mustPass) return false;
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const hay = `${s.title} ${s.description} ${s.initialMessage} ${s.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [scenarios, filterLang, filterSubAgent, filterMustPass, searchQuery]);

  const summary = useMemo(() => {
    const total = scenarios.length;
    const mustPass = scenarios.filter(s => s.mustPass).length;
    const withResults = scenarios.filter(s => results[s.id]);
    const passed = withResults.filter(s => results[s.id].overallPass).length;
    const failed = withResults.length - passed;
    const flaky  = withResults.filter(s => results[s.id].flaky).length;
    const passRate = withResults.length > 0 ? Math.round((passed / withResults.length) * 100) : 0;
    return { total, mustPass, passed, failed, flaky, passRate, tested: withResults.length };
  }, [scenarios, results]);

  // ── Actions ──────────────────────────────────────────────────────────────
  const toggleExpand = (id: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const runOne = async (scenario: GoldenScenario) => {
    setRunning(prev => new Set(prev).add(scenario.id));
    try {
      const result = await runGoldenScenario(scenario.id, n);
      setResults(prev => ({ ...prev, [scenario.id]: result }));
      setExpanded(prev => new Set(prev).add(scenario.id));
    } catch (err: any) {
      setError(`Run failed: ${err?.message}`);
    } finally {
      setRunning(prev => {
        const next = new Set(prev);
        next.delete(scenario.id);
        return next;
      });
    }
  };

  const runBatch = (mustPassOnly: boolean) => {
    const target = mustPassOnly ? scenarios.filter(s => s.mustPass) : scenarios;
    if (!target.length) return;
    batchRef.current?.close();
    setBatchState({ running: true, current: 0, total: target.length, currentTitle: '' });

    batchRef.current = runGoldenBatch(n, mustPassOnly, {
      onStart: (p) => setBatchState(b => ({ ...b, running: true, total: p.total, current: 0 })),
      onProgress: (p) => setBatchState(b => ({ ...b, current: p.index + 1, currentTitle: p.scenarioTitle })),
      onResult: (r) => setResults(prev => ({ ...prev, [r.scenarioId]: r })),
      onError: (e) => {
        if (e.scenarioId) {
          // individual scenario errored; keep going
          console.warn('Scenario errored', e);
        } else {
          setError(e.error);
        }
      },
      onComplete: (p) => setBatchState({
        running: false,
        current: p.total,
        total: p.total,
        currentTitle: '',
        summary: {
          passed: p.passed,
          failed: p.failed,
          mustPassFailures: p.mustPassFailures,
          flaky: p.flaky,
          total: p.total,
        },
      }),
    });
  };

  const cancelBatch = () => {
    batchRef.current?.close();
    batchRef.current = null;
    setBatchState(b => ({ ...b, running: false }));
  };

  const openEditor = (scenario?: GoldenScenario) => {
    setEditing(scenario ? { ...scenario } : emptyScenario());
    setEditorOpen(true);
  };

  const closeEditor = () => {
    setEditorOpen(false);
    setEditing(null);
  };

  const saveScenario = async () => {
    if (!editing) return;
    try {
      if (editing.id && scenarios.some(s => s.id === editing.id)) {
        const updated = await updateGoldenScenario(editing.id, editing);
        setScenarios(prev => prev.map(s => s.id === updated.id ? updated : s));
      } else {
        const payload = { ...editing };
        if (!payload.id) delete payload.id;
        const created = await createGoldenScenario(payload);
        setScenarios(prev => [...prev, created]);
      }
      closeEditor();
    } catch (err: any) {
      setError(`Save failed: ${err?.message}`);
    }
  };

  const removeScenario = async (scenario: GoldenScenario) => {
    if (!confirm(`Delete "${scenario.title}"? This cannot be undone.`)) return;
    try {
      await deleteGoldenScenario(scenario.id);
      setScenarios(prev => prev.filter(s => s.id !== scenario.id));
      setResults(prev => {
        const next = { ...prev };
        delete next[scenario.id];
        return next;
      });
    } catch (err: any) {
      setError(`Delete failed: ${err?.message}`);
    }
  };

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div className="flex-1 overflow-y-auto px-7 py-6 space-y-6">
      {/* ── Header ── */}
      <header className="flex items-start justify-between gap-6 flex-wrap">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #F97316, #fb923c)', boxShadow: '0 4px 14px rgba(249,115,22,0.35)' }}
            >
              <Award className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-[20px] font-black text-slate-900" style={{ letterSpacing: '-0.02em' }}>
                Golden Set
              </h2>
              <p className="text-[12px] text-slate-500 leading-tight mt-0.5">
                The locked baseline your CZ agent must pass — runs N=3 times, reports median & variance
              </p>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white border border-slate-200">
            <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Runs</span>
            <select
              value={n}
              onChange={e => setN(Number(e.target.value))}
              className="text-[12px] font-bold text-slate-700 bg-transparent focus:outline-none cursor-pointer"
            >
              {[1, 3, 5, 7, 10].map(v => <option key={v} value={v}>N={v}</option>)}
            </select>
          </div>
          <button
            onClick={() => runBatch(true)}
            disabled={batchState.running || scenarios.filter(s => s.mustPass).length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold border transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-white border-slate-200 text-slate-700 hover:border-orange-300 hover:text-orange-600"
          >
            <ShieldCheck className="w-4 h-4" />
            Run Must-Pass
          </button>
          <button
            onClick={() => runBatch(false)}
            disabled={batchState.running || scenarios.length === 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{ background: 'linear-gradient(135deg, #F97316, #fb923c)', boxShadow: '0 3px 10px rgba(249,115,22,0.35)' }}
          >
            {batchState.running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
            Run All
          </button>
          <button
            onClick={() => openEditor()}
            className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold bg-slate-900 text-white hover:bg-slate-800 transition-colors"
          >
            <Plus className="w-4 h-4" />
            New
          </button>
        </div>
      </header>

      {/* ── Error banner ── */}
      {error && (
        <div className="flex items-start justify-between gap-3 px-4 py-3 rounded-2xl bg-red-50 border border-red-200">
          <div className="flex items-start gap-2">
            <AlertCircle className="w-4 h-4 text-red-500 mt-0.5 shrink-0" />
            <p className="text-[12px] text-red-700 leading-relaxed">{error}</p>
          </div>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* ── Summary Cards ── */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard
          icon={<Award className="w-4 h-4" />}
          label="Total scenarios"
          value={summary.total}
          color="slate"
        />
        <SummaryCard
          icon={<Shield className="w-4 h-4" />}
          label="Must pass"
          value={summary.mustPass}
          color="orange"
        />
        <SummaryCard
          icon={<CheckCircle2 className="w-4 h-4" />}
          label="Passed"
          value={summary.passed}
          suffix={summary.tested > 0 ? `/${summary.tested}` : ''}
          color="emerald"
        />
        <SummaryCard
          icon={<XCircle className="w-4 h-4" />}
          label="Failed"
          value={summary.failed}
          suffix={summary.tested > 0 ? `/${summary.tested}` : ''}
          color="red"
        />
        <SummaryCard
          icon={<Zap className="w-4 h-4" />}
          label="Flaky"
          value={summary.flaky}
          color="amber"
        />
      </div>

      {/* ── Batch progress ── */}
      {batchState.running && (
        <div className="px-5 py-4 rounded-2xl bg-white border border-orange-200 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
              <span className="text-[13px] font-bold text-orange-700">
                Running batch ({n}× per scenario)
              </span>
              <span className="text-[12px] text-slate-500">— {batchState.currentTitle}</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[12px] text-slate-600 font-semibold tabular-nums">
                {batchState.current} / {batchState.total}
              </span>
              <button
                onClick={cancelBatch}
                className="text-[11px] font-bold text-red-500 hover:text-red-700"
              >
                Cancel
              </button>
            </div>
          </div>
          <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${batchState.total > 0 ? (batchState.current / batchState.total) * 100 : 0}%`,
                background: 'linear-gradient(90deg, #F97316, #fb923c)',
              }}
            />
          </div>
        </div>
      )}

      {batchState.summary && !batchState.running && (
        <div className="px-5 py-4 rounded-2xl bg-white border border-slate-200 shadow-sm">
          <div className="flex items-center gap-3 flex-wrap">
            <Sparkles className="w-4 h-4 text-orange-500" />
            <span className="text-[13px] font-bold text-slate-900">Batch complete</span>
            <span className="text-[11px] font-semibold text-emerald-600 px-2 py-0.5 rounded-md bg-emerald-50">
              {batchState.summary.passed} passed
            </span>
            <span className="text-[11px] font-semibold text-red-600 px-2 py-0.5 rounded-md bg-red-50">
              {batchState.summary.failed} failed
            </span>
            {batchState.summary.mustPassFailures > 0 && (
              <span className="text-[11px] font-bold text-red-700 px-2 py-0.5 rounded-md bg-red-100 border border-red-200">
                ⚠️ {batchState.summary.mustPassFailures} must-pass regression{batchState.summary.mustPassFailures === 1 ? '' : 's'}
              </span>
            )}
            {batchState.summary.flaky > 0 && (
              <span className="text-[11px] font-semibold text-amber-700 px-2 py-0.5 rounded-md bg-amber-50">
                {batchState.summary.flaky} flaky
              </span>
            )}
          </div>
        </div>
      )}

      {/* ── Filters ── */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          <Filter className="w-3 h-3" /> Filter
        </div>
        <FilterPill active={filterMustPass} onClick={() => setFilterMustPass(v => !v)}>
          Must-pass only
        </FilterPill>
        <select
          value={filterLang}
          onChange={e => setFilterLang(e.target.value as any)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 focus:outline-none focus:border-orange-300"
        >
          <option value="all">All languages</option>
          {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
        </select>
        <select
          value={filterSubAgent}
          onChange={e => setFilterSubAgent(e.target.value as any)}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white border border-slate-200 text-slate-700 focus:outline-none focus:border-orange-300"
        >
          <option value="all">All sub-agents</option>
          {SUB_AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <input
          type="text"
          value={searchQuery}
          onChange={e => setSearchQuery(e.target.value)}
          placeholder="Search title, message, tag…"
          className="flex-1 min-w-[200px] px-3 py-1.5 rounded-lg text-[11px] font-medium bg-white border border-slate-200 text-slate-700 placeholder-slate-400 focus:outline-none focus:border-orange-300"
        />
      </div>

      {/* ── List ── */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 text-orange-400 animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState onCreate={() => openEditor()} hasAny={scenarios.length > 0} />
      ) : (
        <div className="space-y-3">
          {filtered.map(s => (
            <ScenarioCard
              key={s.id}
              scenario={s}
              result={results[s.id]}
              isRunning={running.has(s.id)}
              isExpanded={expanded.has(s.id)}
              onRun={() => runOne(s)}
              onEdit={() => openEditor(s)}
              onDelete={() => removeScenario(s)}
              onToggle={() => toggleExpand(s.id)}
            />
          ))}
        </div>
      )}

      {/* ── Editor Modal ── */}
      {editorOpen && editing && (
        <EditorModal
          value={editing}
          onChange={setEditing}
          onSave={saveScenario}
          onClose={closeEditor}
          isCreate={!scenarios.some(s => s.id === editing.id)}
        />
      )}
    </div>
  );
};

// ─── Summary Card ────────────────────────────────────────────────────────────

const COLOR_MAP: Record<string, { bg: string; iconBg: string; iconText: string; text: string }> = {
  slate:   { bg: 'bg-white border-slate-200',   iconBg: 'bg-slate-100',   iconText: 'text-slate-600',   text: 'text-slate-900' },
  orange:  { bg: 'bg-white border-orange-200',  iconBg: 'bg-orange-100',  iconText: 'text-orange-600',  text: 'text-orange-700' },
  emerald: { bg: 'bg-white border-emerald-200', iconBg: 'bg-emerald-100', iconText: 'text-emerald-600', text: 'text-emerald-700' },
  red:     { bg: 'bg-white border-red-200',     iconBg: 'bg-red-100',     iconText: 'text-red-600',     text: 'text-red-700' },
  amber:   { bg: 'bg-white border-amber-200',   iconBg: 'bg-amber-100',   iconText: 'text-amber-600',   text: 'text-amber-700' },
};

const SummaryCard: React.FC<{ icon: React.ReactNode; label: string; value: number; suffix?: string; color: keyof typeof COLOR_MAP }>
  = ({ icon, label, value, suffix, color }) => {
  const c = COLOR_MAP[color];
  return (
    <div className={`${c.bg} border rounded-2xl px-4 py-3.5 shadow-sm`}>
      <div className="flex items-center gap-2 mb-1.5">
        <div className={`${c.iconBg} ${c.iconText} w-7 h-7 rounded-lg flex items-center justify-center`}>
          {icon}
        </div>
        <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{label}</span>
      </div>
      <p className={`text-[22px] font-black tabular-nums leading-none ${c.text}`}>
        {value}{suffix && <span className="text-[13px] text-slate-400 font-semibold ml-0.5">{suffix}</span>}
      </p>
    </div>
  );
};

// ─── Filter Pill ─────────────────────────────────────────────────────────────

const FilterPill: React.FC<{ active: boolean; onClick: () => void; children: React.ReactNode }>
  = ({ active, onClick, children }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border transition-colors ${
      active
        ? 'bg-orange-50 text-orange-700 border-orange-200'
        : 'bg-white text-slate-600 border-slate-200 hover:border-slate-300'
    }`}
  >
    {children}
  </button>
);

// ─── Empty State ─────────────────────────────────────────────────────────────

const EmptyState: React.FC<{ onCreate: () => void; hasAny: boolean }> = ({ onCreate, hasAny }) => (
  <div className="py-20 flex flex-col items-center text-center">
    <div className="w-14 h-14 rounded-2xl bg-orange-50 flex items-center justify-center mb-4 border border-orange-100">
      <Award className="w-7 h-7 text-orange-500" />
    </div>
    <h3 className="text-[15px] font-black text-slate-900 mb-1">
      {hasAny ? 'No scenarios match your filters' : 'No golden scenarios yet'}
    </h3>
    <p className="text-[12px] text-slate-500 max-w-md leading-relaxed mb-4">
      {hasAny
        ? 'Try clearing a filter or search query to see your scenarios.'
        : 'Create your first golden scenario to lock in the behaviour your CZ agent must always pass on.'}
    </p>
    {!hasAny && (
      <button
        onClick={onCreate}
        className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold text-white"
        style={{ background: 'linear-gradient(135deg, #F97316, #fb923c)', boxShadow: '0 3px 10px rgba(249,115,22,0.35)' }}
      >
        <Plus className="w-4 h-4" />
        Create scenario
      </button>
    )}
  </div>
);

// ─── Scenario Card ───────────────────────────────────────────────────────────

const ScenarioCard: React.FC<{
  scenario: GoldenScenario;
  result?: GoldenRunAggregate;
  isRunning: boolean;
  isExpanded: boolean;
  onRun: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggle: () => void;
}> = ({ scenario, result, isRunning, isExpanded, onRun, onEdit, onDelete, onToggle }) => {
  const statusColor = !result
    ? 'border-slate-200'
    : result.regressionAlert
      ? 'border-red-300 ring-1 ring-red-100'
      : result.overallPass
        ? 'border-emerald-200'
        : 'border-red-200';

  const subAgentPal = scenario.expectedSubAgent ? SUB_AGENT_COLORS[scenario.expectedSubAgent] : null;

  return (
    <div className={`bg-white rounded-2xl border ${statusColor} shadow-sm transition-shadow hover:shadow-md`}>
      {/* Header row */}
      <div className="px-5 py-4 flex items-start gap-4">
        <button
          onClick={onToggle}
          className="flex-1 text-left group"
          aria-label="Toggle details"
        >
          <div className="flex items-center gap-2 flex-wrap mb-1">
            {scenario.mustPass && (
              <span className="flex items-center gap-1 px-2 py-0.5 rounded-md text-[9px] font-black uppercase tracking-widest bg-orange-100 text-orange-700 border border-orange-200">
                <Shield className="w-2.5 h-2.5" /> Must pass
              </span>
            )}
            <h3 className="text-[14px] font-black text-slate-900 group-hover:text-orange-600 transition-colors" style={{ letterSpacing: '-0.01em' }}>
              {scenario.title}
            </h3>
            <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider">
              {scenario.language}
            </span>
            {subAgentPal && (
              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${subAgentPal.bg} ${subAgentPal.text} border ${subAgentPal.border}`}>
                {scenario.expectedSubAgent}
              </span>
            )}
            {result?.flaky && (
              <span className="flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-md bg-amber-50 text-amber-700 border border-amber-200">
                <Zap className="w-2.5 h-2.5" /> Flaky
              </span>
            )}
          </div>
          <p className="text-[12px] text-slate-500 leading-relaxed line-clamp-2">
            {scenario.description || scenario.initialMessage}
          </p>
          {scenario.tags.length > 0 && (
            <div className="flex gap-1.5 mt-2 flex-wrap">
              {scenario.tags.map(t => (
                <span key={t} className="text-[10px] font-semibold text-slate-500 bg-slate-50 px-2 py-0.5 rounded-md border border-slate-100">
                  {t}
                </span>
              ))}
            </div>
          )}
        </button>

        {/* Result badge */}
        {result && (
          <div className="shrink-0 flex flex-col items-end gap-1">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-black ${
              result.overallPass
                ? 'bg-emerald-50 text-emerald-700'
                : 'bg-red-50 text-red-700'
            }`}>
              {result.overallPass ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
              {Math.round(result.medianScore * 100)}
            </div>
            <span className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">
              ±{result.stdevScore.toFixed(2)} · n={result.n}
            </span>
          </div>
        )}

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-1">
          <IconBtn onClick={onRun} disabled={isRunning} title="Run scenario">
            {isRunning ? <Loader2 className="w-4 h-4 animate-spin text-orange-500" /> : <Play className="w-4 h-4" />}
          </IconBtn>
          <IconBtn onClick={onEdit} title="Edit">
            <Edit2 className="w-4 h-4" />
          </IconBtn>
          <IconBtn onClick={onDelete} title="Delete" variant="danger">
            <Trash2 className="w-4 h-4" />
          </IconBtn>
        </div>
      </div>

      {/* Expanded details */}
      {isExpanded && (
        <div className="border-t border-slate-100 px-5 py-4 space-y-3 bg-slate-50/50">
          <DetailRow label="User message" value={scenario.initialMessage} mono />
          <DetailRow label="Expected answer" value={scenario.expectedAnswer} mono />

          {scenario.passKeywords.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Pass keywords</p>
              <div className="flex flex-wrap gap-1.5">
                {scenario.passKeywords.map((k, i) => (
                  <code key={i} className="px-2 py-0.5 rounded-md text-[11px] bg-emerald-50 text-emerald-700 border border-emerald-100">
                    {k}
                  </code>
                ))}
              </div>
            </div>
          )}

          {scenario.failKeywords.length > 0 && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1.5">Fail keywords (regex)</p>
              <div className="flex flex-wrap gap-1.5">
                {scenario.failKeywords.map((k, i) => (
                  <code key={i} className="px-2 py-0.5 rounded-md text-[11px] bg-red-50 text-red-700 border border-red-100">
                    {k}
                  </code>
                ))}
              </div>
            </div>
          )}

          {scenario.notes && (
            <div>
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">Notes</p>
              <p className="text-[12px] text-slate-600 leading-relaxed italic">{scenario.notes}</p>
            </div>
          )}

          {/* Run results */}
          {result && (
            <div className="pt-2 border-t border-slate-200">
              <div className="flex items-center gap-2 mb-2">
                <Activity className="w-3.5 h-3.5 text-slate-400" />
                <p className="text-[11px] font-black uppercase tracking-widest text-slate-500">
                  Last run results — {result.passCount}/{result.n} passed · median {Math.round(result.medianScore * 100)} · σ {result.stdevScore.toFixed(3)}
                </p>
              </div>
              <div className="space-y-1.5">
                {result.runs.map((r, i) => (
                  <div
                    key={i}
                    className={`px-3 py-2 rounded-lg border text-[11px] flex items-start gap-2 ${
                      r.pass ? 'bg-emerald-50 border-emerald-100' : 'bg-red-50 border-red-100'
                    }`}
                  >
                    <span className={`shrink-0 mt-0.5 font-bold ${r.pass ? 'text-emerald-600' : 'text-red-600'}`}>
                      #{i + 1}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`font-bold ${r.pass ? 'text-emerald-700' : 'text-red-700'}`}>
                          {r.pass ? 'Pass' : 'Fail'} · {Math.round(r.score * 100)}
                        </span>
                        {r.agentType && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                            <Bot className="w-2.5 h-2.5" /> {r.agentType}
                          </span>
                        )}
                        {r.responseTimeMs > 0 && (
                          <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                            <Clock className="w-2.5 h-2.5" /> {r.responseTimeMs}ms
                          </span>
                        )}
                      </div>
                      <p className="text-slate-600 leading-snug mt-0.5">{r.reason}</p>
                      {r.responseText && (
                        <p className="text-slate-500 italic leading-snug mt-1 line-clamp-2">
                          "{r.responseText}"
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

// ─── Detail Row ──────────────────────────────────────────────────────────────

const DetailRow: React.FC<{ label: string; value: string; mono?: boolean }> = ({ label, value, mono }) => (
  <div>
    <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400 mb-1">{label}</p>
    <p className={`text-[12px] text-slate-700 leading-relaxed ${mono ? 'font-mono' : ''}`}>{value}</p>
  </div>
);

// ─── Icon Button ─────────────────────────────────────────────────────────────

const IconBtn: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  title: string;
  variant?: 'default' | 'danger';
  children: React.ReactNode;
}> = ({ onClick, disabled, title, variant = 'default', children }) => (
  <button
    onClick={(e) => { e.stopPropagation(); onClick(); }}
    disabled={disabled}
    title={title}
    className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
      variant === 'danger'
        ? 'text-slate-400 hover:text-red-600 hover:bg-red-50'
        : 'text-slate-500 hover:text-orange-600 hover:bg-orange-50'
    }`}
  >
    {children}
  </button>
);

// ─── Editor Modal ────────────────────────────────────────────────────────────

const EditorModal: React.FC<{
  value: Partial<GoldenScenario>;
  onChange: (v: Partial<GoldenScenario>) => void;
  onSave: () => void;
  onClose: () => void;
  isCreate: boolean;
}> = ({ value, onChange, onSave, onClose, isCreate }) => {
  const set = <K extends keyof GoldenScenario>(k: K, v: GoldenScenario[K]) => {
    onChange({ ...value, [k]: v });
  };

  const kwList = (str: string): string[] =>
    str.split(',').map(s => s.trim()).filter(Boolean);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-3xl w-full max-w-2xl max-h-[92vh] flex flex-col shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="px-6 py-5 border-b border-slate-100 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-2xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #F97316, #fb923c)' }}
            >
              <Award className="w-5 h-5 text-white" />
            </div>
            <div>
              <h3 className="text-[16px] font-black text-slate-900" style={{ letterSpacing: '-0.02em' }}>
                {isCreate ? 'New golden scenario' : 'Edit scenario'}
              </h3>
              <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                Lock in expected behaviour — this scenario will run on every eval cycle
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-400 hover:text-slate-700 hover:bg-slate-50"
          >
            <X className="w-4 h-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          <Field label="Title" required>
            <input
              type="text"
              value={value.title || ''}
              onChange={e => set('title', e.target.value)}
              placeholder="E.g. RFID request routed to app"
              className={fieldCls}
            />
          </Field>

          <Field label="Description">
            <textarea
              value={value.description || ''}
              onChange={e => set('description', e.target.value)}
              placeholder="What does this scenario verify?"
              rows={2}
              className={fieldCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Language">
              <select
                value={value.language || 'English'}
                onChange={e => set('language', e.target.value as GoldenLanguage)}
                className={fieldCls}
              >
                {LANGUAGES.map(l => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
            <Field label="Expected sub-agent">
              <select
                value={value.expectedSubAgent || ''}
                onChange={e => set('expectedSubAgent', (e.target.value || null) as GoldenSubAgent)}
                className={fieldCls}
              >
                <option value="">— none —</option>
                {SUB_AGENTS.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </Field>
          </div>

          <Field label="User message" required>
            <textarea
              value={value.initialMessage || ''}
              onChange={e => set('initialMessage', e.target.value)}
              placeholder="What the user sends to the CZ agent"
              rows={2}
              className={`${fieldCls} font-mono text-[12px]`}
            />
          </Field>

          <Field label="Expected answer" required>
            <textarea
              value={value.expectedAnswer || ''}
              onChange={e => set('expectedAnswer', e.target.value)}
              placeholder="Hand-verified good response — serves as human reference"
              rows={3}
              className={`${fieldCls} font-mono text-[12px]`}
            />
          </Field>

          <Field label="Pass keywords (comma-separated, regex allowed)" hint="All must appear in response">
            <input
              type="text"
              value={(value.passKeywords || []).join(', ')}
              onChange={e => set('passKeywords', kwList(e.target.value))}
              placeholder="app, free"
              className={`${fieldCls} font-mono text-[12px]`}
            />
          </Field>

          <Field label="Fail keywords (comma-separated, regex allowed)" hint="Any match = hard fail">
            <input
              type="text"
              value={(value.failKeywords || []).join(', ')}
              onChange={e => set('failKeywords', kwList(e.target.value))}
              placeholder="i cannot help, please contact"
              className={`${fieldCls} font-mono text-[12px]`}
            />
          </Field>

          <Field label="Tags (comma-separated)">
            <input
              type="text"
              value={(value.tags || []).join(', ')}
              onChange={e => set('tags', kwList(e.target.value))}
              placeholder="rfid, support, must-pass"
              className={fieldCls}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3 items-end">
            <Field label="Minimum score to pass" hint="0.0 – 1.0">
              <input
                type="number"
                min={0}
                max={1}
                step={0.05}
                value={value.minScore ?? 0.5}
                onChange={e => set('minScore', parseFloat(e.target.value) || 0)}
                className={fieldCls}
              />
            </Field>
            <label className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-slate-200 hover:border-orange-300 cursor-pointer transition-colors bg-white">
              <input
                type="checkbox"
                checked={!!value.mustPass}
                onChange={e => set('mustPass', e.target.checked)}
                className="w-4 h-4 rounded text-orange-500 focus:ring-orange-500"
              />
              <span className="text-[12px] font-bold text-slate-700">Must pass (regression alert)</span>
            </label>
          </div>

          <Field label="Notes" hint="Context for reviewers — why this scenario exists">
            <textarea
              value={value.notes || ''}
              onChange={e => set('notes', e.target.value)}
              rows={2}
              className={fieldCls}
            />
          </Field>
        </div>

        <footer className="px-6 py-4 border-t border-slate-100 flex items-center justify-between gap-3 shrink-0">
          <p className="text-[11px] text-slate-400 leading-tight">
            <AlertTriangle className="w-3 h-3 inline mr-1" />
            Changes save to <code className="font-mono">data/golden.json</code>
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-[12px] font-bold text-slate-600 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSave}
              disabled={!value.title || !value.initialMessage || !value.expectedAnswer}
              className="flex items-center gap-2 px-4 py-2 rounded-xl text-[12px] font-bold text-white disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: 'linear-gradient(135deg, #F97316, #fb923c)' }}
            >
              <Save className="w-4 h-4" />
              {isCreate ? 'Create scenario' : 'Save changes'}
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};

const fieldCls = 'w-full px-3 py-2 rounded-xl text-[13px] font-medium bg-white border border-slate-200 text-slate-900 placeholder-slate-400 focus:outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100 transition-colors';

const Field: React.FC<{ label: string; hint?: string; required?: boolean; children: React.ReactNode }>
  = ({ label, hint, required, children }) => (
  <div>
    <label className="flex items-baseline justify-between mb-1.5">
      <span className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
        {label} {required && <span className="text-orange-500">*</span>}
      </span>
      {hint && <span className="text-[10px] text-slate-400 italic">{hint}</span>}
    </label>
    {children}
  </div>
);

// Use TrendingUp to suppress unused-import warnings while keeping the symbol available for future stats rows.
void TrendingUp;

export default GoldenSetView;
