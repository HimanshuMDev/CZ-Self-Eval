import React, { useState, useEffect, useRef } from 'react';
import {
  fetchQuestionBank, previewQuestionBank, saveBatchQuestions,
  addQuestionBankItem, deleteQuestionBankItem, clearQuestionBank,
  type QuestionBankItem,
} from '../api';
import {
  FlaskConical, Sparkles, Loader2,
  X, Search, Plus, Trash2, Check,
  SlidersHorizontal, AlertTriangle,
  RefreshCw, Database, CheckSquare,
  Square, Hash, Clock, Tag,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

// ─── Category config ──────────────────────────────────────────────────────────
const CAT_META: Record<string, { pill: string; text: string; dot: string; icon: string; label: string }> = {
  charging:     { pill: 'bg-amber-50 border-amber-200',    text: 'text-amber-700',    dot: 'bg-amber-400',    icon: '⚡', label: 'Charging'     },
  payment:      { pill: 'bg-emerald-50 border-emerald-200',text: 'text-emerald-700',  dot: 'bg-emerald-400',  icon: '💳', label: 'Payment'      },
  registration: { pill: 'bg-cyan-50 border-cyan-200',      text: 'text-cyan-700',     dot: 'bg-cyan-400',     icon: '👤', label: 'Registration' },
  fault:        { pill: 'bg-red-50 border-red-200',        text: 'text-red-700',      dot: 'bg-red-400',      icon: '🔴', label: 'Fault'        },
  support:      { pill: 'bg-violet-50 border-violet-200',  text: 'text-violet-700',   dot: 'bg-violet-400',   icon: '🎧', label: 'Support'      },
  account:      { pill: 'bg-blue-50 border-blue-200',      text: 'text-blue-700',     dot: 'bg-blue-400',     icon: '🔐', label: 'Account'      },
  general:      { pill: 'bg-slate-100 border-slate-200',   text: 'text-slate-500',    dot: 'bg-slate-400',    icon: '💬', label: 'General'      },
};

const SOURCE_META: Record<string, { label: string; cls: string }> = {
  ai:      { label: '🤖 AI',      cls: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  history: { label: '💬 History', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
  custom:  { label: '✏️ Custom',  cls: 'bg-purple-50 text-purple-700 border-purple-200' },
};

type SortKey = 'newest' | 'oldest' | 'az' | 'category' | 'source';

// ─── Clear Confirm Modal ──────────────────────────────────────────────────────
const ClearModal: React.FC<{ count: number; onConfirm: () => void; onCancel: () => void }> = ({ count, onConfirm, onCancel }) => (
  <motion.div
    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
    className="fixed inset-0 bg-black/30 backdrop-blur-sm z-50 flex items-center justify-center p-4"
    onClick={onCancel}
  >
    <motion.div
      initial={{ scale: 0.9, y: 20 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.9, y: 20 }}
      onClick={e => e.stopPropagation()}
      className="bg-white rounded-2xl shadow-2xl border border-slate-200 p-6 max-w-sm w-full"
    >
      <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center mb-4">
        <AlertTriangle className="w-6 h-6 text-red-500" />
      </div>
      <h3 className="text-sm font-bold text-slate-800 mb-1.5">Clear all questions?</h3>
      <p className="text-xs text-slate-500 leading-relaxed">
        This will permanently delete all <span className="font-bold text-slate-700">{count} questions</span> from the bank.
      </p>
      <div className="flex gap-2 mt-4">
        <button onClick={onCancel} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 hover:bg-slate-200 transition-all">Cancel</button>
        <button onClick={onConfirm} className="flex-1 py-2.5 rounded-xl bg-red-500 text-white text-xs font-bold hover:bg-red-600 transition-all">Clear All</button>
      </div>
    </motion.div>
  </motion.div>
);

// ─── Generate Dialog ──────────────────────────────────────────────────────────
interface PreviewQuestion { text: string; category: string }

const GenerateDialog: React.FC<{
  questions: PreviewQuestion[];
  method: string;
  historyCount: number;
  saving: boolean;
  onSave: (selected: PreviewQuestion[]) => void;
  onClose: () => void;
}> = ({ questions, method, historyCount, saving, onSave, onClose }) => {
  const [selected, setSelected] = useState<Set<number>>(
    new Set(questions.map((_, i) => i)) // all pre-selected
  );

  const toggle = (i: number) =>
    setSelected(prev => { const next = new Set(prev); next.has(i) ? next.delete(i) : next.add(i); return next; });

  const toggleAll = () =>
    setSelected(prev => prev.size === questions.length ? new Set() : new Set(questions.map((_, i) => i)));

  const allSelected = selected.size === questions.length;

  return (
    <motion.div
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
      className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <motion.div
        initial={{ scale: 0.93, y: 24 }} animate={{ scale: 1, y: 0 }} exit={{ scale: 0.93, y: 20 }}
        transition={{ type: 'spring', stiffness: 380, damping: 32 }}
        onClick={e => e.stopPropagation()}
        className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-full max-w-lg flex flex-col max-h-[85vh]"
      >
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-slate-100 shrink-0">
          <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
            <Sparkles className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="flex-1 min-w-0">
            <h2 className="text-sm font-bold text-slate-800">Generated Questions</h2>
            <p className="text-[10px] text-slate-400 mt-0.5">
              {historyCount > 0
                ? `Based on ${historyCount} real chat messages · ${method === 'llm' ? 'AI generated' : 'Template fallback'}`
                : 'Template fallback — no chat history found'}
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-all">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Select all bar */}
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-slate-100 bg-slate-50 shrink-0">
          <button
            onClick={toggleAll}
            className="flex items-center gap-2 text-xs font-semibold text-slate-600 hover:text-slate-800 transition-colors"
          >
            {allSelected
              ? <CheckSquare className="w-3.5 h-3.5 text-emerald-500" />
              : <Square className="w-3.5 h-3.5 text-slate-400" />}
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
          <span className="text-[10px] text-slate-400 font-semibold">
            {selected.size} / {questions.length} selected
          </span>
        </div>

        {/* Question list */}
        <div className="flex-1 overflow-y-auto py-2 custom-scrollbar">
          {questions.map((q, i) => {
            const isSelected = selected.has(i);
            const cat = CAT_META[q.category] ?? CAT_META.general;
            return (
              <button
                key={i}
                onClick={() => toggle(i)}
                className={`w-full flex items-start gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50 ${isSelected ? 'bg-emerald-50/60' : ''}`}
              >
                {/* Checkbox */}
                <div className={`w-4 h-4 rounded border-2 flex items-center justify-center mt-0.5 shrink-0 transition-all ${
                  isSelected ? 'bg-emerald-500 border-emerald-500' : 'border-slate-300'
                }`}>
                  {isSelected && <Check className="w-2.5 h-2.5 text-white" strokeWidth={3} />}
                </div>
                {/* Text */}
                <div className="flex-1 min-w-0">
                  <p className={`text-xs leading-relaxed ${isSelected ? 'text-slate-800 font-medium' : 'text-slate-600'}`}>
                    {q.text}
                  </p>
                  <span className={`inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded-full border text-[9px] font-bold ${cat.pill} ${cat.text}`}>
                    {cat.icon} {cat.label}
                  </span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-3 px-5 py-4 border-t border-slate-100 shrink-0">
          <button onClick={onClose} className="flex-1 py-2.5 rounded-xl bg-slate-100 text-slate-700 text-xs font-bold border border-slate-200 hover:bg-slate-200 transition-all">
            Cancel
          </button>
          <button
            onClick={() => onSave(questions.filter((_, i) => selected.has(i)))}
            disabled={selected.size === 0 || saving}
            className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all disabled:opacity-50 shadow-sm"
          >
            {saving
              ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Saving…</>
              : <><Check className="w-3.5 h-3.5" /> Save {selected.size} Question{selected.size !== 1 ? 's' : ''}</>
            }
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
};

// ─── Main Component ───────────────────────────────────────────────────────────
const SandboxView: React.FC<{ onStartScenario: (ctx: string) => void }> = () => {
  // Data
  const [questions, setQuestions]   = useState<QuestionBankItem[]>([]);
  const [loading, setLoading]       = useState(true);
  const [loadError, setLoadError]   = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError]     = useState<string | null>(null);

  // Generate dialog
  const [dialogQuestions, setDialogQuestions] = useState<PreviewQuestion[] | null>(null);
  const [dialogMeta, setDialogMeta] = useState<{ method: string; historyCount: number }>({ method: 'fallback', historyCount: 0 });
  const [saving, setSaving]         = useState(false);
  const [savedCount, setSavedCount] = useState<number | null>(null);

  // Filters / sort
  const [search, setSearch]       = useState('');
  const [catFilter, setCatFilter] = useState<string | null>(null);
  const [srcFilter, setSrcFilter] = useState<string | null>(null);
  const [sortKey, setSortKey]     = useState<SortKey>('newest');
  const [showSortMenu, setShowSortMenu] = useState(false);

  // Custom question input
  const [customInput, setCustomInput] = useState('');
  const [addingCustom, setAddingCustom] = useState(false);
  const [customError, setCustomError]  = useState('');
  const customInputRef = useRef<HTMLInputElement>(null);

  // Delete / clear
  const [deletingId, setDeletingId]       = useState<string | null>(null);
  const [showClearModal, setShowClearModal] = useState(false);

  const sortMenuRef = useRef<HTMLDivElement>(null);

  // ── Load on mount ───────────────────────────────────────────────────────────
  useEffect(() => { loadQuestions(); }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (sortMenuRef.current && !sortMenuRef.current.contains(e.target as Node)) setShowSortMenu(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const loadQuestions = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      setQuestions(await fetchQuestionBank());
    } catch (e: any) {
      setLoadError(e?.message || 'Failed to connect to server. Is it running on port 4001?');
    } finally { setLoading(false); }
  };

  // ── Generate → open dialog ──────────────────────────────────────────────────
  const handleGenerate = async () => {
    setGenerating(true);
    setGenError(null);
    setSavedCount(null);
    try {
      const result = await previewQuestionBank(20);
      if (!result?.questions?.length) throw new Error('No questions returned from server');
      setDialogMeta({ method: result.method, historyCount: result.historyCount });
      setDialogQuestions(result.questions);
    } catch (e: any) {
      const msg = e?.message || 'Unknown error';
      setGenError(
        msg.includes('Failed to fetch') || msg.includes('NetworkError')
          ? 'Cannot reach server — make sure it is running on port 4001'
          : `Generate failed: ${msg}`
      );
    } finally { setGenerating(false); }
  };

  // ── Save selected from dialog ───────────────────────────────────────────────
  const handleSaveBatch = async (selected: PreviewQuestion[]) => {
    setSaving(true);
    try {
      const result = await saveBatchQuestions(selected);
      setQuestions(result.questions);
      setSavedCount(result.savedCount);
      setDialogQuestions(null);
    } catch (e: any) {
      setGenError(e?.message || 'Save failed');
      setDialogQuestions(null);
    } finally { setSaving(false); }
  };

  // ── Add custom ──────────────────────────────────────────────────────────────
  const handleAddCustom = async () => {
    const text = customInput.trim();
    if (text.length < 5) { setCustomError('At least 5 characters'); return; }
    setAddingCustom(true);
    setCustomError('');
    try {
      const item = await addQuestionBankItem(text);
      setQuestions(prev => [item, ...prev]);
      setCustomInput('');
      customInputRef.current?.focus();
    } catch (e: any) {
      setCustomError(e.message || 'Failed to add');
    } finally { setAddingCustom(false); }
  };

  // ── Delete ──────────────────────────────────────────────────────────────────
  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteQuestionBankItem(id);
      setQuestions(prev => prev.filter(q => q.id !== id));
    } catch (e) { console.error('[QB] delete failed:', e); }
    finally { setDeletingId(null); }
  };

  // ── Clear all ───────────────────────────────────────────────────────────────
  const handleClearAll = async () => {
    setShowClearModal(false);
    try {
      await clearQuestionBank();
      setQuestions([]);
    } catch (e) { console.error('[QB] clear failed:', e); }
  };

  // ── Filtered + sorted ───────────────────────────────────────────────────────
  let visible = questions.filter(q => {
    const matchSearch = !search || q.text.toLowerCase().includes(search.toLowerCase());
    const matchCat    = !catFilter || q.category === catFilter;
    const matchSrc    = !srcFilter || q.source === srcFilter;
    return matchSearch && matchCat && matchSrc;
  });

  if (sortKey === 'newest')   visible = [...visible].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  else if (sortKey === 'oldest') visible = [...visible].sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  else if (sortKey === 'az')  visible = [...visible].sort((a, b) => a.text.localeCompare(b.text));
  else if (sortKey === 'category') visible = [...visible].sort((a, b) => a.category.localeCompare(b.category));
  else if (sortKey === 'source')   visible = [...visible].sort((a, b) => a.source.localeCompare(b.source));

  const catCounts = questions.reduce<Record<string, number>>((acc, q) => { acc[q.category] = (acc[q.category] || 0) + 1; return acc; }, {});
  const srcCounts = questions.reduce<Record<string, number>>((acc, q) => { acc[q.source]   = (acc[q.source]   || 0) + 1; return acc; }, {});
  const activeFilters = [catFilter, srcFilter, search].filter(Boolean).length;

  const formatDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }); }
    catch { return iso?.slice(0, 10) ?? '—'; }
  };

  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex-1 flex flex-col overflow-hidden bg-slate-50">

      {/* Modals */}
      <AnimatePresence>
        {showClearModal && (
          <ClearModal count={questions.length} onConfirm={handleClearAll} onCancel={() => setShowClearModal(false)} />
        )}
        {dialogQuestions && (
          <GenerateDialog
            questions={dialogQuestions}
            method={dialogMeta.method}
            historyCount={dialogMeta.historyCount}
            saving={saving}
            onSave={handleSaveBatch}
            onClose={() => setDialogQuestions(null)}
          />
        )}
      </AnimatePresence>

      {/* ── Header ── */}
      <div className="bg-white border-b border-slate-200 px-5 py-3.5 shrink-0">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center justify-center shrink-0">
              <FlaskConical className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-slate-800">Questions Lab</h1>
              <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                <Database className="w-2.5 h-2.5" /> {questions.length} questions saved
              </span>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Saved confirmation */}
            <AnimatePresence>
              {savedCount !== null && (
                <motion.span
                  initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0 }}
                  onAnimationComplete={() => setTimeout(() => setSavedCount(null), 3000)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-700 text-[11px] font-semibold"
                >
                  <Check className="w-3 h-3" /> {savedCount} question{savedCount !== 1 ? 's' : ''} saved
                </motion.span>
              )}
            </AnimatePresence>

            {/* Error dismiss */}
            <AnimatePresence>
              {genError && (
                <motion.div
                  initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-red-50 border border-red-200 text-red-700 text-[11px]"
                >
                  <AlertTriangle className="w-3 h-3 shrink-0" />
                  <span className="max-w-[260px] truncate">{genError}</span>
                  <button onClick={() => setGenError(null)} className="text-red-400 hover:text-red-600 shrink-0"><X className="w-3 h-3" /></button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Clear */}
            {questions.length > 0 && (
              <button onClick={() => setShowClearModal(true)} aria-label="Clear all" title="Clear all questions"
                className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            {/* Reload */}
            <button onClick={loadQuestions} disabled={loading} aria-label="Reload" title="Reload from DB"
              className="p-2 rounded-xl border border-slate-200 text-slate-400 hover:bg-slate-50 hover:text-slate-600 transition-all disabled:opacity-40">
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            </button>
            {/* Generate */}
            <button
              onClick={handleGenerate}
              disabled={generating}
              className="flex items-center gap-2 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold transition-all disabled:opacity-60 active:scale-95 shadow-sm"
            >
              {generating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              {generating ? 'Generating…' : 'Generate'}
            </button>
          </div>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="bg-white border-b border-slate-100 px-5 py-2.5 flex items-center gap-2 flex-wrap shrink-0">
        {/* Search */}
        <div className="relative flex-1 min-w-[180px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search questions…"
            className="w-full pl-9 pr-8 py-2 text-xs bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-emerald-200 transition-all text-slate-700 placeholder:text-slate-400"
          />
          {search && <button onClick={() => setSearch('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"><X className="w-3 h-3" /></button>}
        </div>

        {/* Category filter chips */}
        <div className="flex items-center gap-1 flex-wrap">
          {Object.entries(CAT_META).map(([key, meta]) => {
            const count = catCounts[key] || 0;
            if (!count) return null;
            const active = catFilter === key;
            return (
              <button key={key} onClick={() => setCatFilter(active ? null : key)} aria-pressed={active}
                className={`flex items-center gap-1 px-2 py-1 rounded-full border text-[9px] font-bold transition-all ${
                  active ? `${meta.pill} ${meta.text} ring-1 ring-offset-1` : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}>
                {meta.icon} {meta.label} <span className="opacity-60">({count})</span>
              </button>
            );
          })}
        </div>

        {/* Source filter */}
        <div className="flex items-center gap-1">
          {(['ai', 'history', 'custom'] as const).map(src => {
            const count = srcCounts[src] || 0;
            if (!count) return null;
            const meta = SOURCE_META[src];
            const active = srcFilter === src;
            return (
              <button key={src} onClick={() => setSrcFilter(active ? null : src)} aria-pressed={active}
                className={`flex items-center gap-1 px-2 py-1 rounded-full border text-[9px] font-bold transition-all ${
                  active ? `${meta.cls} ring-1 ring-offset-1` : 'bg-white border-slate-200 text-slate-500 hover:border-slate-300'
                }`}>
                {meta.label} <span className="opacity-60">({count})</span>
              </button>
            );
          })}
        </div>

        {activeFilters > 0 && (
          <button onClick={() => { setSearch(''); setCatFilter(null); setSrcFilter(null); }}
            className="flex items-center gap-1 px-2 py-1 rounded-full bg-slate-100 border border-slate-200 text-[9px] font-semibold text-slate-500 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all">
            <X className="w-2.5 h-2.5" /> Clear filters
          </button>
        )}

        <div className="flex-1" />

        {visible.length !== questions.length && (
          <span className="text-[10px] text-slate-400 shrink-0">{visible.length} of {questions.length}</span>
        )}

        {/* Sort */}
        <div className="relative shrink-0" ref={sortMenuRef}>
          <button onClick={() => setShowSortMenu(v => !v)}
            className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[10px] font-semibold transition-all ${
              sortKey !== 'newest' ? 'bg-emerald-50 border-emerald-200 text-emerald-700' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}>
            <SlidersHorizontal className="w-3 h-3" /> Sort
          </button>
          <AnimatePresence>
            {showSortMenu && (
              <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}
                className="absolute right-0 mt-1.5 bg-white border border-slate-200 rounded-xl shadow-lg py-1 z-50 w-44" role="menu">
                {([
                  ['newest', 'Newest first'], ['oldest', 'Oldest first'],
                  ['az', 'A → Z'], ['category', 'By category'], ['source', 'By source'],
                ] as [SortKey, string][]).map(([key, label]) => (
                  <button key={key} role="menuitem" onClick={() => { setSortKey(key); setShowSortMenu(false); }}
                    className={`w-full flex items-center justify-between px-3.5 py-2 text-xs transition-colors hover:bg-slate-50 ${sortKey === key ? 'font-bold text-slate-800' : 'text-slate-600'}`}>
                    {label}
                    {sortKey === key && <Check className="w-3 h-3 text-emerald-500" />}
                  </button>
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ── Add custom row ── */}
      <div className="bg-white border-b border-slate-100 px-5 py-2.5 flex items-center gap-2 shrink-0">
        <Plus className="w-3.5 h-3.5 text-slate-400 shrink-0" />
        <input
          ref={customInputRef}
          value={customInput}
          onChange={e => { setCustomInput(e.target.value); setCustomError(''); }}
          onKeyDown={e => { if (e.key === 'Enter') handleAddCustom(); }}
          placeholder="Add a custom question and press Enter…"
          className={`flex-1 bg-transparent text-xs text-slate-700 placeholder:text-slate-400 focus:outline-none ${customError ? 'text-red-600' : ''}`}
        />
        {customError && <span className="text-[10px] text-red-500 shrink-0">{customError}</span>}
        {customInput.trim().length >= 5 && (
          <button onClick={handleAddCustom} disabled={addingCustom}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-purple-600 text-white text-[10px] font-bold hover:bg-purple-700 transition-all disabled:opacity-50 shrink-0">
            {addingCustom ? <Loader2 className="w-3 h-3 animate-spin" /> : <Plus className="w-3 h-3" />} Add
          </button>
        )}
      </div>

      {/* ── Table ── */}
      <div className="flex-1 overflow-auto custom-scrollbar">

        {/* Load error */}
        {!loading && loadError && (
          <div className="flex flex-col items-center justify-center py-16 gap-3 px-6">
            <div className="w-12 h-12 rounded-2xl bg-red-50 border border-red-200 flex items-center justify-center">
              <AlertTriangle className="w-6 h-6 text-red-400" />
            </div>
            <p className="text-sm font-semibold text-slate-600 text-center">Failed to load question bank</p>
            <p className="text-xs text-red-500 text-center max-w-sm leading-relaxed">{loadError}</p>
            <button onClick={loadQuestions} className="flex items-center gap-2 px-4 py-2 rounded-xl bg-slate-800 text-white text-xs font-bold hover:bg-slate-700 transition-all">
              <RefreshCw className="w-3.5 h-3.5" /> Retry
            </button>
          </div>
        )}

        {loading && (
          <div className="flex items-center justify-center py-20 gap-3">
            <Loader2 className="w-5 h-5 text-emerald-500 animate-spin" />
            <p className="text-sm text-slate-400">Loading question bank…</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !loadError && questions.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full gap-4 py-20">
            <div className="w-16 h-16 rounded-2xl bg-emerald-50 border border-emerald-200 flex items-center justify-center">
              <Sparkles className="w-7 h-7 text-emerald-400" />
            </div>
            <div className="text-center max-w-xs">
              <p className="text-sm font-bold text-slate-600 mb-1">No questions yet</p>
              <p className="text-xs text-slate-400 leading-relaxed">
                Click <span className="font-bold text-emerald-600">Generate</span> — AI will pull real user messages from chat history and create test questions. You pick which ones to save.
              </p>
            </div>
            <button onClick={handleGenerate} disabled={generating}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-bold transition-all shadow-sm disabled:opacity-60">
              <Sparkles className="w-4 h-4" /> Generate Questions
            </button>
          </div>
        )}

        {/* No match */}
        {!loading && !loadError && questions.length > 0 && visible.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 gap-2">
            <Search className="w-8 h-8 text-slate-300" />
            <p className="text-sm text-slate-400">No questions match your filters</p>
            <button onClick={() => { setSearch(''); setCatFilter(null); setSrcFilter(null); }}
              className="text-xs text-emerald-500 hover:text-emerald-700 underline mt-1">Clear filters</button>
          </div>
        )}

        {/* Table */}
        {!loading && !loadError && visible.length > 0 && (
          <table className="w-full border-collapse text-xs">
            <thead className="sticky top-0 z-10">
              <tr className="bg-slate-100 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 w-10">
                  <span className="flex items-center gap-1"><Hash className="w-2.5 h-2.5" /></span>
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500 min-w-[300px]">Question</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1"><Tag className="w-2.5 h-2.5" /> Category</span>
                </th>
                <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">Source</th>
                <th className="px-3 py-2.5 text-left text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span className="flex items-center gap-1"><Clock className="w-2.5 h-2.5" /> Added</span>
                </th>
                <th className="w-16 px-3 py-2.5" />
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {visible.map((q, i) => {
                  const catStyle   = CAT_META[q.category] ?? CAT_META.general;
                  const srcStyle   = SOURCE_META[q.source] ?? SOURCE_META.ai;
                  const isDeleting = deletingId === q.id;
                  return (
                    <motion.tr
                      key={q.id}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, x: -20 }}
                      transition={{ delay: Math.min(i * 0.01, 0.2) }}
                      className={`group border-b border-slate-100 bg-white hover:bg-slate-50 transition-colors ${isDeleting ? 'opacity-40 pointer-events-none' : ''}`}
                    >
                      <td className="px-4 py-3 text-[10px] text-slate-400 font-mono">{i + 1}</td>
                      <td className="px-3 py-3">
                        <span className="text-xs text-slate-700 leading-relaxed">{q.text}</span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold ${catStyle.pill} ${catStyle.text}`}>
                          {catStyle.icon} {catStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full border text-[9px] font-semibold ${srcStyle.cls}`}>
                          {srcStyle.label}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-[10px] text-slate-400 whitespace-nowrap">{formatDate(q.createdAt)}</td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => handleDelete(q.id)}
                          disabled={isDeleting}
                          aria-label={`Delete: ${q.text}`}
                          className="opacity-0 group-hover:opacity-100 p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-all disabled:opacity-40"
                        >
                          {isDeleting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                        </button>
                      </td>
                    </motion.tr>
                  );
                })}
              </AnimatePresence>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
};

export default SandboxView;
