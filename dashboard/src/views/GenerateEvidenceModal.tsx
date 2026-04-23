/**
 * GenerateEvidenceModal
 * ─────────────────────
 * Three-step modal for mining eval evidence from real chat sessions.
 *
 *   Step 1 · Pick sessions   — checkbox list with flag summary per session
 *   Step 2 · Candidates      — AI-generated scenarios, each editable inline
 *                              with a save-or-skip checkbox
 *   Step 3 · Done            — confirmation summary
 *
 * Everything is additive — if this modal fails the rest of the Eval Evidence
 * view keeps working. Errors surface as a red banner at the top of the modal.
 */
import React, { useEffect, useMemo, useState } from 'react';
import {
  X,
  Sparkles,
  Loader2,
  AlertTriangle,
  Check,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Save,
  CheckCircle2,
} from 'lucide-react';

import {
  fetchLocalChatSessions,
  generateEvidenceFromSessions,
  saveUserEvidenceBatch,
  type UserEvidenceScenario,
  type ChatSession,
  type GenerateEvidenceMeta,
} from '../api';

type SessionSummary = Omit<ChatSession, 'messages'>;

type Step = 'pick' | 'generating' | 'review' | 'saving' | 'done';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Called after a successful save so the parent view can reload its list. */
  onSaved: (added: UserEvidenceScenario[]) => void;
}

const AGENT_CHOICES = ['discovery', 'payment', 'session', 'support', 'new-user', 'session-flows'];
const CASE_TYPE_CHOICES = ['positive', 'negative', 'safety'];
const EVAL_TYPE_CHOICES = ['regression', 'capability', 'routing', 'ai_quality'];

export default function GenerateEvidenceModal({ open, onClose, onSaved }: Props) {
  const [step, setStep]           = useState<Step>('pick');
  const [error, setError]         = useState<string | null>(null);

  // Step 1 — session picker
  const [sessions, setSessions]       = useState<SessionSummary[] | null>(null);
  const [loadingSess, setLoadingSess] = useState(false);
  const [selected, setSelected]       = useState<Set<string>>(new Set());
  const [searchQ, setSearchQ]         = useState('');
  const [count, setCount]             = useState(5);
  const [useLlm, setUseLlm]           = useState(true);

  // Step 2 — candidates
  const [candidates, setCandidates] = useState<UserEvidenceScenario[]>([]);
  const [accepted, setAccepted]     = useState<Set<string>>(new Set());
  const [editingId, setEditingId]   = useState<string | null>(null);
  const [genMeta, setGenMeta]       = useState<GenerateEvidenceMeta | null>(null);

  // Step 3 — done
  const [savedSummary, setSavedSummary] = useState<{ added: number; skipped: number } | null>(null);

  // Load sessions the first time the modal opens
  useEffect(() => {
    if (!open) return;
    if (sessions !== null) return;    // cache between opens
    setLoadingSess(true);
    setError(null);
    fetchLocalChatSessions()
      .then((list) => setSessions(list))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingSess(false));
  }, [open, sessions]);

  // Reset volatile state when closing
  useEffect(() => {
    if (open) return;
    setStep('pick');
    setCandidates([]);
    setAccepted(new Set());
    setEditingId(null);
    setGenMeta(null);
    setSavedSummary(null);
    setError(null);
  }, [open]);

  const filteredSessions = useMemo(() => {
    if (!sessions) return [];
    const q = searchQ.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter(
      (s) =>
        s.title?.toLowerCase().includes(q) ||
        s.from?.toLowerCase().includes(q) ||
        s.id?.toLowerCase().includes(q),
    );
  }, [sessions, searchQ]);

  const toggleSession = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAccepted = (id: string) => {
    setAccepted((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleGenerate = async () => {
    setError(null);
    setStep('generating');
    try {
      const resp = await generateEvidenceFromSessions(Array.from(selected), count, useLlm);
      setCandidates(resp.candidates);
      setGenMeta(resp.meta);
      // Pre-accept all by default — user opts out, not in
      setAccepted(new Set(resp.candidates.map((c) => c.id)));
      setStep('review');
    } catch (err) {
      setError((err as Error).message);
      setStep('pick');
    }
  };

  const handleSave = async () => {
    setError(null);
    setStep('saving');
    try {
      const picked = candidates.filter((c) => accepted.has(c.id));
      if (picked.length === 0) {
        setError('Nothing to save — accept at least one candidate.');
        setStep('review');
        return;
      }
      const resp = await saveUserEvidenceBatch(picked);
      setSavedSummary({ added: resp.addedCount, skipped: resp.skipped });
      onSaved(resp.added);
      setStep('done');
    } catch (err) {
      setError((err as Error).message);
      setStep('review');
    }
  };

  const patchCandidate = (id: string, patch: Partial<UserEvidenceScenario>) => {
    setCandidates((prev) =>
      prev.map((c) => (c.id === id ? { ...c, ...patch } : c)),
    );
  };

  const patchTask = (id: string, patch: Partial<UserEvidenceScenario['task']>) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.id === id
          ? { ...c, task: { ...c.task, ...patch } }
          : c,
      ),
    );
  };

  const patchCriteria = (
    id: string,
    patch: Partial<NonNullable<UserEvidenceScenario['task']['codeGradedCriteria']>>,
  ) => {
    setCandidates((prev) =>
      prev.map((c) =>
        c.id === id
          ? {
              ...c,
              task: {
                ...c.task,
                codeGradedCriteria: {
                  ...(c.task.codeGradedCriteria || {}),
                  ...patch,
                },
              },
            }
          : c,
      ),
    );
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-6"
      style={{ background: 'rgba(15,23,42,0.55)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-4xl max-h-[90vh] rounded-3xl bg-white flex flex-col"
        onClick={(e) => e.stopPropagation()}
        style={{ boxShadow: '0 24px 60px rgba(15,23,42,0.3)' }}
      >
        {/* Header */}
        <header className="px-6 py-4 flex items-center justify-between border-b border-slate-100 shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-9 h-9 rounded-xl flex items-center justify-center"
              style={{ background: 'linear-gradient(135deg, #F97316, #fb923c)' }}
            >
              <Sparkles className="w-4 h-4 text-white" />
            </div>
            <div>
              <h2 className="text-[15px] font-black text-slate-900" style={{ letterSpacing: '-0.01em' }}>
                Generate Eval Evidence
              </h2>
              <p className="text-[11px] text-slate-500">
                Mine real chat sessions with AI to create new regression scenarios.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <StepPill label="Pick chats" active={step === 'pick'} done={step !== 'pick'} />
            <StepPill
              label="Review"
              active={step === 'review' || step === 'generating' || step === 'saving'}
              done={step === 'done'}
            />
            <StepPill label="Done" active={step === 'done'} done={false} />
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-slate-100"
              aria-label="Close"
            >
              <X className="w-4 h-4 text-slate-500" />
            </button>
          </div>
        </header>

        {error && (
          <div
            className="mx-6 mt-4 rounded-xl px-4 py-3 flex items-start gap-2"
            style={{ background: '#fef2f2', border: '1px solid #fecaca', color: '#b91c1c' }}
          >
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <div className="text-[12.5px] font-semibold flex-1">{error}</div>
            <button onClick={() => setError(null)} className="text-[11px] font-bold">
              dismiss
            </button>
          </div>
        )}

        <main className="flex-1 overflow-y-auto px-6 py-5">
          {step === 'pick' && (
            <PickStep
              loading={loadingSess}
              sessions={filteredSessions}
              totalCount={sessions?.length ?? 0}
              selected={selected}
              onToggle={toggleSession}
              searchQ={searchQ}
              onSearch={setSearchQ}
              count={count}
              onChangeCount={setCount}
              useLlm={useLlm}
              onChangeUseLlm={setUseLlm}
            />
          )}

          {step === 'generating' && (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500 mb-3" />
              <h3 className="text-[14px] font-bold text-slate-800">Mining sessions with AI…</h3>
              <p className="text-[12px] text-slate-500 mt-1">
                This usually takes 5–20 seconds depending on session length.
              </p>
            </div>
          )}

          {step === 'review' && (
            <ReviewStep
              candidates={candidates}
              accepted={accepted}
              onToggleAccept={toggleAccepted}
              editingId={editingId}
              onEdit={setEditingId}
              onPatchCandidate={patchCandidate}
              onPatchTask={patchTask}
              onPatchCriteria={patchCriteria}
              meta={genMeta}
            />
          )}

          {step === 'saving' && (
            <div className="py-20 flex flex-col items-center justify-center text-center">
              <Loader2 className="w-6 h-6 animate-spin text-orange-500 mb-3" />
              <h3 className="text-[14px] font-bold text-slate-800">Saving evidence…</h3>
            </div>
          )}

          {step === 'done' && savedSummary && (
            <div className="py-16 flex flex-col items-center justify-center text-center">
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-3"
                style={{ background: 'rgba(16,185,129,0.15)', color: '#047857' }}
              >
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-[16px] font-black text-slate-900">
                Added {savedSummary.added} scenario{savedSummary.added === 1 ? '' : 's'} to your evidence
              </h3>
              {savedSummary.skipped > 0 && (
                <p className="text-[12px] text-slate-500 mt-1">
                  Skipped {savedSummary.skipped} duplicate{savedSummary.skipped === 1 ? '' : 's'}.
                </p>
              )}
              <p className="text-[12px] text-slate-500 mt-1">
                They'll now show up in the Eval Evidence list and in future Eval Score runs.
              </p>
            </div>
          )}
        </main>

        {/* Footer */}
        <footer className="px-6 py-4 flex items-center justify-between border-t border-slate-100 shrink-0">
          <div className="text-[11.5px] text-slate-500">
            {step === 'pick' && `${selected.size} session${selected.size === 1 ? '' : 's'} selected`}
            {step === 'review' && candidates.length > 0 && (
              <>
                {accepted.size} / {candidates.length} candidates marked to save
                {genMeta?.backend && (
                  <span className="ml-2 text-slate-400">
                    · via {genMeta.backend}
                  </span>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-2">
            {step === 'review' && (
              <button
                onClick={() => setStep('pick')}
                className="inline-flex items-center gap-1 px-4 py-2 rounded-xl text-[12.5px] font-bold text-slate-600 hover:bg-slate-100"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}

            {step === 'pick' && (
              <button
                onClick={handleGenerate}
                disabled={selected.size === 0}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[12.5px] font-bold text-white transition-opacity"
                style={{
                  background: 'linear-gradient(135deg, #F97316, #fb923c)',
                  boxShadow: '0 6px 20px rgba(249,115,22,0.3)',
                  opacity: selected.size === 0 ? 0.4 : 1,
                  cursor: selected.size === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <Sparkles className="w-3.5 h-3.5" />
                Generate {count} {count === 1 ? 'candidate' : 'candidates'}
              </button>
            )}

            {step === 'review' && (
              <button
                onClick={handleSave}
                disabled={accepted.size === 0}
                className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[12.5px] font-bold text-white transition-opacity"
                style={{
                  background: 'linear-gradient(135deg, #10b981, #34d399)',
                  boxShadow: '0 6px 20px rgba(16,185,129,0.3)',
                  opacity: accepted.size === 0 ? 0.4 : 1,
                  cursor: accepted.size === 0 ? 'not-allowed' : 'pointer',
                }}
              >
                <Save className="w-3.5 h-3.5" />
                Save {accepted.size} to evidence
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}

            {step === 'done' && (
              <button
                onClick={onClose}
                className="px-5 py-2.5 rounded-xl text-[12.5px] font-bold text-white"
                style={{ background: 'linear-gradient(135deg, #F97316, #fb923c)' }}
              >
                Done
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────────────────────────

function StepPill({ label, active, done }: { label: string; active: boolean; done: boolean }) {
  const bg = done ? '#dcfce7' : active ? '#ffedd5' : '#f1f5f9';
  const color = done ? '#047857' : active ? '#c2410c' : '#94a3b8';
  return (
    <span
      className="text-[10px] font-black uppercase tracking-wider px-2 py-1 rounded-md inline-flex items-center gap-1"
      style={{ background: bg, color, letterSpacing: '0.08em' }}
    >
      {done && <Check className="w-2.5 h-2.5" />}
      {label}
    </span>
  );
}

// ─── Step 1: pick sessions ──────────────────────────────────────────────────

function PickStep({
  loading,
  sessions,
  totalCount,
  selected,
  onToggle,
  searchQ,
  onSearch,
  count,
  onChangeCount,
  useLlm,
  onChangeUseLlm,
}: {
  loading: boolean;
  sessions: SessionSummary[];
  totalCount: number;
  selected: Set<string>;
  onToggle: (id: string) => void;
  searchQ: string;
  onSearch: (v: string) => void;
  count: number;
  onChangeCount: (n: number) => void;
  useLlm: boolean;
  onChangeUseLlm: (v: boolean) => void;
}) {
  return (
    <div>
      {/* Config row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
            Candidates to generate
          </span>
          <div className="flex gap-2">
            {[3, 5, 10].map((n) => (
              <button
                key={n}
                onClick={() => onChangeCount(n)}
                className="flex-1 py-2 rounded-xl text-[12.5px] font-bold transition-all"
                style={{
                  background: count === n ? 'linear-gradient(135deg, #F97316, #fb923c)' : '#fff',
                  color: count === n ? '#fff' : '#64748b',
                  border: count === n ? '1px solid transparent' : '1px solid #EEF0F5',
                }}
              >
                {n}
              </button>
            ))}
          </div>
        </label>

        <label className="flex flex-col gap-1 md:col-span-2">
          <span className="text-[10px] font-black uppercase tracking-wider text-slate-500">
            Generation backend
          </span>
          <div className="flex items-center gap-3 rounded-xl px-3 py-2" style={{ border: '1px solid #EEF0F5' }}>
            <input
              id="useLlm"
              type="checkbox"
              checked={useLlm}
              onChange={(e) => onChangeUseLlm(e.target.checked)}
              className="w-4 h-4 accent-orange-500"
            />
            <label htmlFor="useLlm" className="flex-1 text-[12px] cursor-pointer">
              <span className="font-bold text-slate-800">Use LLM</span>
              <span className="text-slate-500 ml-1.5">
                (Anthropic/OpenAI) — falls back to a deterministic heuristic if no API key is set.
              </span>
            </label>
          </div>
        </label>
      </div>

      {/* Search */}
      <input
        type="text"
        value={searchQ}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="Search sessions by title, phone, or id…"
        className="w-full rounded-xl px-3.5 py-2 text-[12.5px] mb-3 outline-none"
        style={{ background: '#F7F8FB', border: '1px solid #EEF0F5' }}
      />

      {/* Session list */}
      {loading ? (
        <div className="py-12 flex flex-col items-center text-slate-400 text-[12px]">
          <Loader2 className="w-5 h-5 animate-spin mb-2" />
          Loading sessions…
        </div>
      ) : sessions.length === 0 ? (
        <div
          className="py-16 rounded-2xl text-center"
          style={{ background: '#F7F8FB', border: '1px dashed #E2E8F0' }}
        >
          <p className="text-[13px] font-bold text-slate-600">No chat sessions yet</p>
          <p className="text-[11.5px] text-slate-500 mt-1">
            Use <b>Live Chat</b> to record some sessions first, then come back here.
          </p>
          {totalCount > 0 && (
            <p className="text-[11px] text-slate-400 mt-2">
              ({totalCount} sessions exist but don't match your search.)
            </p>
          )}
        </div>
      ) : (
        <ul className="space-y-1.5 max-h-[380px] overflow-y-auto pr-1">
          {sessions.map((s) => {
            const active = selected.has(s.id);
            const flags = s.flags || { pass: 0, fail: 0, bug: 0, slow: 0 };
            const flagTotal = flags.pass + flags.fail + flags.bug + flags.slow;
            return (
              <li
                key={s.id}
                onClick={() => onToggle(s.id)}
                className="rounded-xl px-3.5 py-2.5 flex items-center gap-3 cursor-pointer transition-all"
                style={{
                  background: active ? 'rgba(249,115,22,0.06)' : '#fff',
                  border: `1px solid ${active ? 'rgba(249,115,22,0.3)' : '#EEF0F5'}`,
                }}
              >
                <span
                  className="w-4 h-4 rounded-md flex items-center justify-center shrink-0"
                  style={{
                    background: active ? '#F97316' : '#fff',
                    border: `1px solid ${active ? '#F97316' : '#CBD5E1'}`,
                  }}
                >
                  {active && <Check className="w-3 h-3 text-white" />}
                </span>

                <div className="flex-1 min-w-0">
                  <div className="text-[12.5px] font-bold text-slate-800 truncate">
                    {s.title || '(untitled session)'}
                  </div>
                  <div className="text-[10.5px] text-slate-500 mt-0.5">
                    {s.from} · {s.totalMessages || 0} msgs
                    {s.agentTypesUsed?.length > 0 && (
                      <span className="text-slate-400 ml-2">
                        {s.agentTypesUsed.slice(0, 3).join(', ')}
                      </span>
                    )}
                  </div>
                </div>

                {/* Flag chips */}
                {flagTotal > 0 && (
                  <div className="flex items-center gap-1.5 shrink-0">
                    {flags.fail > 0 && (
                      <span
                        className="text-[9px] font-black px-1.5 py-0.5 rounded"
                        style={{ background: '#fee2e2', color: '#b91c1c' }}
                      >
                        {flags.fail} fail
                      </span>
                    )}
                    {flags.bug > 0 && (
                      <span
                        className="text-[9px] font-black px-1.5 py-0.5 rounded"
                        style={{ background: '#f3e8ff', color: '#6b21a8' }}
                      >
                        {flags.bug} bug
                      </span>
                    )}
                    {flags.slow > 0 && (
                      <span
                        className="text-[9px] font-black px-1.5 py-0.5 rounded"
                        style={{ background: '#fef3c7', color: '#a16207' }}
                      >
                        {flags.slow} slow
                      </span>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ─── Step 2: review AI candidates ──────────────────────────────────────────

function ReviewStep({
  candidates,
  accepted,
  onToggleAccept,
  editingId,
  onEdit,
  onPatchCandidate,
  onPatchTask,
  onPatchCriteria,
  meta,
}: {
  candidates: UserEvidenceScenario[];
  accepted: Set<string>;
  onToggleAccept: (id: string) => void;
  editingId: string | null;
  onEdit: (id: string | null) => void;
  onPatchCandidate: (id: string, p: Partial<UserEvidenceScenario>) => void;
  onPatchTask: (id: string, p: Partial<UserEvidenceScenario['task']>) => void;
  onPatchCriteria: (
    id: string,
    p: Partial<NonNullable<UserEvidenceScenario['task']['codeGradedCriteria']>>,
  ) => void;
  meta: GenerateEvidenceMeta | null;
}) {
  if (candidates.length === 0) {
    return (
      <div className="py-16 text-center">
        <p className="text-[13px] font-bold text-slate-700">No candidates produced</p>
        <p className="text-[11.5px] text-slate-500 mt-1">Try different sessions or a higher count.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {meta && meta.backend === 'heuristic-fallback' && (
        <div
          className="rounded-xl px-3.5 py-2.5 flex items-start gap-2 text-[11.5px]"
          style={{ background: '#fff7ed', border: '1px solid rgba(249,115,22,0.3)', color: '#9a3412' }}
        >
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <div>
            Using heuristic fallback — set <code>ANTHROPIC_API_KEY</code> or{' '}
            <code>OPENAI_API_KEY</code> on the server for higher-quality AI generation.
          </div>
        </div>
      )}

      {candidates.map((c) => {
        const isEditing = editingId === c.id;
        const isAccepted = accepted.has(c.id);
        return (
          <div
            key={c.id}
            className="rounded-2xl"
            style={{
              background: '#fff',
              border: `1px solid ${isAccepted ? 'rgba(16,185,129,0.35)' : '#EEF0F5'}`,
              boxShadow: isAccepted ? '0 1px 12px rgba(16,185,129,0.08)' : 'none',
              opacity: isAccepted ? 1 : 0.72,
              transition: 'opacity 0.15s',
            }}
          >
            {/* Header row */}
            <div className="px-4 py-3 flex items-center gap-3">
              <button
                onClick={() => onToggleAccept(c.id)}
                className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                style={{
                  background: isAccepted ? '#10b981' : '#fff',
                  border: `1px solid ${isAccepted ? '#10b981' : '#CBD5E1'}`,
                }}
                title={isAccepted ? 'Skip this one' : 'Accept this one'}
                aria-label={isAccepted ? 'Accepted' : 'Not accepted'}
              >
                {isAccepted && <Check className="w-3.5 h-3.5 text-white" />}
              </button>

              <div className="flex-1 min-w-0">
                {isEditing ? (
                  <input
                    type="text"
                    value={c.name}
                    onChange={(e) => onPatchCandidate(c.id, { name: e.target.value })}
                    className="w-full text-[13px] font-bold text-slate-900 outline-none bg-transparent border-b border-orange-300 pb-0.5"
                  />
                ) : (
                  <div className="text-[13px] font-bold text-slate-900 truncate">{c.name}</div>
                )}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap text-[10px]">
                  <Chip color="#c2410c" bg="rgba(249,115,22,0.1)">
                    {c.agent}
                  </Chip>
                  <Chip>{c.caseType}</Chip>
                  <Chip>{c.evalType}</Chip>
                  {c.tags.slice(0, 4).map((t) => (
                    <Chip key={t}>{t}</Chip>
                  ))}
                </div>
              </div>

              <button
                onClick={() => onEdit(isEditing ? null : c.id)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[10.5px] font-bold"
                style={{
                  background: isEditing ? '#F97316' : '#F7F8FB',
                  color: isEditing ? '#fff' : '#475569',
                  border: `1px solid ${isEditing ? '#F97316' : '#EEF0F5'}`,
                }}
              >
                {isEditing ? (
                  <>
                    <Check className="w-3 h-3" />
                    Done
                  </>
                ) : (
                  <>
                    <Pencil className="w-3 h-3" />
                    Edit
                  </>
                )}
              </button>
            </div>

            {/* User message preview */}
            <div
              className="mx-4 mb-3 rounded-xl px-3 py-2 text-[11.5px]"
              style={{ background: '#F7F8FB', border: '1px solid #EEF0F5' }}
            >
              <div className="text-[9.5px] font-black uppercase tracking-wider text-slate-500 mb-1">
                User message
              </div>
              {isEditing ? (
                <textarea
                  value={c.task.input.userMessage}
                  onChange={(e) => onPatchTask(c.id, {
                    input: { ...c.task.input, userMessage: e.target.value },
                  })}
                  className="w-full bg-white rounded p-2 outline-none text-[11.5px]"
                  style={{ border: '1px solid #EEF0F5' }}
                  rows={2}
                />
              ) : (
                <div className="text-slate-700">{c.task.input.userMessage}</div>
              )}
            </div>

            {/* Edit panel */}
            {isEditing && (
              <div className="mx-4 mb-4 pb-4 space-y-3" style={{ borderTop: '1px solid #EEF0F5' }}>
                <div className="grid grid-cols-3 gap-2 pt-3">
                  <LabelledSelect
                    label="Agent"
                    value={c.agent}
                    onChange={(v) => onPatchCandidate(c.id, { agent: v })}
                    options={AGENT_CHOICES}
                  />
                  <LabelledSelect
                    label="Case type"
                    value={c.caseType || 'negative'}
                    onChange={(v) => onPatchCandidate(c.id, { caseType: v })}
                    options={CASE_TYPE_CHOICES}
                  />
                  <LabelledSelect
                    label="Eval type"
                    value={c.evalType || 'regression'}
                    onChange={(v) => onPatchCandidate(c.id, { evalType: v })}
                    options={EVAL_TYPE_CHOICES}
                  />
                </div>

                <LabelledArea
                  label="Description"
                  value={c.task.description || ''}
                  onChange={(v) => onPatchTask(c.id, { description: v })}
                />

                <LabelledInput
                  label="Expected agent type"
                  value={c.task.codeGradedCriteria?.expectedAgentType || c.agent}
                  onChange={(v) => onPatchCriteria(c.id, { expectedAgentType: v })}
                />

                <LabelledChipList
                  label="Response MUST contain one of"
                  values={c.task.codeGradedCriteria?.responseMustContainOneOf || []}
                  onChange={(arr) => onPatchCriteria(c.id, { responseMustContainOneOf: arr })}
                  tone="green"
                />

                <LabelledChipList
                  label="Response MUST NOT contain"
                  values={c.task.codeGradedCriteria?.responseMustNotContain || []}
                  onChange={(arr) => onPatchCriteria(c.id, { responseMustNotContain: arr })}
                  tone="red"
                />

                <LabelledChipList
                  label="Tags"
                  values={c.tags}
                  onChange={(arr) => {
                    onPatchCandidate(c.id, { tags: arr });
                    onPatchTask(c.id, { tags: arr });
                  }}
                  tone="slate"
                />
              </div>
            )}

            {/* Compact preview when NOT editing */}
            {!isEditing && (
              <div className="px-4 pb-4 grid grid-cols-2 gap-3 text-[11px]">
                <AssertionPreview
                  label="Expects one of"
                  values={c.task.codeGradedCriteria?.responseMustContainOneOf || []}
                  tone="green"
                />
                <AssertionPreview
                  label="Forbids"
                  values={c.task.codeGradedCriteria?.responseMustNotContain || []}
                  tone="red"
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── Small UI helpers ──────────────────────────────────────────────────────

function Chip({
  children,
  color = '#64748b',
  bg = '#f1f5f9',
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase"
      style={{ color, background: bg, letterSpacing: '0.04em' }}
    >
      {children}
    </span>
  );
}

function LabelledSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg px-2 py-1.5 text-[12px] outline-none cursor-pointer"
        style={{ background: '#F7F8FB', border: '1px solid #EEF0F5' }}
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </label>
  );
}

function LabelledInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
        style={{ background: '#F7F8FB', border: '1px solid #EEF0F5' }}
      />
    </label>
  );
}

function LabelledArea({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="rounded-lg px-2.5 py-1.5 text-[12px] outline-none"
        style={{ background: '#F7F8FB', border: '1px solid #EEF0F5' }}
      />
    </label>
  );
}

function LabelledChipList({
  label,
  values,
  onChange,
  tone,
}: {
  label: string;
  values: string[];
  onChange: (v: string[]) => void;
  tone: 'green' | 'red' | 'slate';
}) {
  const [draft, setDraft] = useState('');
  const chipStyle =
    tone === 'green'
      ? { bg: '#dcfce7', color: '#166534' }
      : tone === 'red'
        ? { bg: '#fee2e2', color: '#b91c1c' }
        : { bg: '#f1f5f9', color: '#334155' };

  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (values.includes(v)) return;
    onChange([...values, v]);
    setDraft('');
  };
  const remove = (i: number) => onChange(values.filter((_, idx) => idx !== i));

  return (
    <div className="flex flex-col gap-1">
      <span className="text-[9.5px] font-black uppercase tracking-wider text-slate-500">{label}</span>
      <div
        className="rounded-lg px-2 py-1.5 flex flex-wrap gap-1.5 items-center"
        style={{ background: '#F7F8FB', border: '1px solid #EEF0F5', minHeight: 32 }}
      >
        {values.map((v, i) => (
          <span
            key={i}
            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10.5px] font-bold"
            style={{ background: chipStyle.bg, color: chipStyle.color }}
          >
            {v}
            <button onClick={() => remove(i)} aria-label={`Remove ${v}`}>
              <X className="w-2.5 h-2.5" />
            </button>
          </span>
        ))}
        <input
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ',') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
          placeholder="Add term…"
          className="flex-1 min-w-[80px] bg-transparent outline-none text-[11.5px]"
        />
      </div>
    </div>
  );
}

function AssertionPreview({
  label,
  values,
  tone,
}: {
  label: string;
  values: string[];
  tone: 'green' | 'red';
}) {
  const style =
    tone === 'green'
      ? { bg: 'rgba(22,163,74,0.08)', border: 'rgba(22,163,74,0.2)', color: '#166534' }
      : { bg: 'rgba(220,38,38,0.06)', border: 'rgba(220,38,38,0.2)', color: '#991b1b' };
  return (
    <div
      className="rounded-lg px-2.5 py-2"
      style={{ background: style.bg, border: `1px solid ${style.border}` }}
    >
      <div
        className="text-[9.5px] font-black uppercase tracking-wider mb-1"
        style={{ color: style.color }}
      >
        {label}
      </div>
      {values.length === 0 ? (
        <div className="text-slate-400 italic">(none set)</div>
      ) : (
        <div className="flex flex-wrap gap-1">
          {values.slice(0, 5).map((v, i) => (
            <code
              key={i}
              className="text-[10px] px-1.5 py-0.5 rounded"
              style={{ background: '#fff', color: style.color }}
            >
              {v}
            </code>
          ))}
          {values.length > 5 && (
            <span className="text-[10px] text-slate-500">+{values.length - 5} more</span>
          )}
        </div>
      )}
    </div>
  );
}

