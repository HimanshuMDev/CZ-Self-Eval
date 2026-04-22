/**
 * Eval Evidence View
 * ──────────────────
 *
 * Replaces the old "Golden Set" tab. Shows every eval case across every agent
 * in the ChargeZone AI agent project, grouped by agent, with filters and a
 * detail side panel. A "Run Eval Score" button kicks off the existing eval
 * pipeline scoped to whatever evidence is currently filtered in.
 *
 * Source: agent project's unified evidence snapshot, copied into
 *   dashboard/src/data/agentEvalEvidence.json
 *   (regenerate with `npm run eval:evidence` in the agent project, then
 *    re-copy — see self-eval/scripts/sync-agent-evidence.sh)
 */
import { useMemo, useState } from 'react';
import {
  Search,
  Filter,
  ChevronRight,
  X,
  Layers,
  Tag,
  FileCode2,
  CheckCircle2,
} from 'lucide-react';
import agentEvidence from '../data/agentEvalEvidence.json';

// ─── Types (mirror the snapshot) ─────────────────────────────────────────────

interface EvalEvidenceEntry {
  id: string;
  name: string;
  agent: string;
  kind: 'single' | 'flow';
  tags: string[];
  caseType?: string;
  evalType?: string;
  source: string;
  task: Record<string, unknown>;
}

interface EvalEvidenceSnapshot {
  generatedAt: string;
  agents: string[];
  summary: {
    total: number;
    byAgent: Record<string, number>;
    byKind: { single: number; flow: number };
    byEvalType: Record<string, number>;
    byCaseType: Record<string, number>;
  };
  evidence: EvalEvidenceEntry[];
}

const SNAPSHOT = agentEvidence as EvalEvidenceSnapshot;

// ─── Agent visual metadata ───────────────────────────────────────────────────

const AGENT_META: Record<
  string,
  { label: string; accent: string; bg: string; border: string }
> = {
  discovery: {
    label: 'Discovery',
    accent: '#0ea5e9',
    bg: 'rgba(14,165,233,0.08)',
    border: 'rgba(14,165,233,0.22)',
  },
  payment: {
    label: 'Payment',
    accent: '#10b981',
    bg: 'rgba(16,185,129,0.08)',
    border: 'rgba(16,185,129,0.22)',
  },
  session: {
    label: 'Session',
    accent: '#a855f7',
    bg: 'rgba(168,85,247,0.08)',
    border: 'rgba(168,85,247,0.22)',
  },
  support: {
    label: 'Support',
    accent: '#f59e0b',
    bg: 'rgba(245,158,11,0.08)',
    border: 'rgba(245,158,11,0.22)',
  },
  'new-user': {
    label: 'New User',
    accent: '#ec4899',
    bg: 'rgba(236,72,153,0.08)',
    border: 'rgba(236,72,153,0.22)',
  },
  'session-flows': {
    label: 'Session Flows',
    accent: '#6366f1',
    bg: 'rgba(99,102,241,0.08)',
    border: 'rgba(99,102,241,0.22)',
  },
};

function metaFor(agent: string) {
  return (
    AGENT_META[agent] ?? {
      label: agent,
      accent: '#64748b',
      bg: 'rgba(100,116,139,0.08)',
      border: 'rgba(100,116,139,0.22)',
    }
  );
}

// ─── Small UI primitives ─────────────────────────────────────────────────────

function Chip({
  children,
  color = '#64748b',
  bg = '#f1f5f9',
  border = 'transparent',
}: {
  children: React.ReactNode;
  color?: string;
  bg?: string;
  border?: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide"
      style={{ color, background: bg, border: `1px solid ${border}` }}
    >
      {children}
    </span>
  );
}

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div
      className="rounded-2xl px-5 py-4"
      style={{
        background: '#fff',
        border: '1px solid #F0F1F5',
        boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
      }}
    >
      <p
        className="text-[10px] font-black uppercase"
        style={{ color: '#94a3b8', letterSpacing: '0.14em' }}
      >
        {label}
      </p>
      <p
        className="text-[26px] font-black leading-tight mt-1"
        style={{ color: '#0f172a', letterSpacing: '-0.02em' }}
      >
        {value}
      </p>
      {hint && (
        <p className="text-[11px] mt-1" style={{ color: '#94a3b8' }}>
          {hint}
        </p>
      )}
    </div>
  );
}

// ─── Main view ───────────────────────────────────────────────────────────────

const EvalEvidenceView: React.FC = () => {
  const [query, setQuery] = useState('');
  const [agentFilter, setAgentFilter] = useState<string | 'all'>('all');
  const [caseTypeFilter, setCaseTypeFilter] = useState<string | 'all'>('all');
  const [evalTypeFilter, setEvalTypeFilter] = useState<string | 'all'>('all');
  const [kindFilter, setKindFilter] = useState<'all' | 'single' | 'flow'>(
    'all',
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // ── Filter pipeline ────────────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return SNAPSHOT.evidence.filter((e) => {
      if (agentFilter !== 'all' && e.agent !== agentFilter) return false;
      if (caseTypeFilter !== 'all' && e.caseType !== caseTypeFilter) return false;
      if (evalTypeFilter !== 'all' && e.evalType !== evalTypeFilter) return false;
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (q) {
        const hay = `${e.id} ${e.name} ${e.tags.join(' ')}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [query, agentFilter, caseTypeFilter, evalTypeFilter, kindFilter]);

  const grouped = useMemo(() => {
    const g = new Map<string, EvalEvidenceEntry[]>();
    for (const a of SNAPSHOT.agents) g.set(a, []);
    for (const e of filtered) {
      if (!g.has(e.agent)) g.set(e.agent, []);
      g.get(e.agent)!.push(e);
    }
    return Array.from(g.entries()).filter(([, items]) => items.length > 0);
  }, [filtered]);

  const selected = useMemo(
    () => SNAPSHOT.evidence.find((e) => e.id === selectedId) ?? null,
    [selectedId],
  );

  // Unique values for dropdown filters
  const allCaseTypes = useMemo(
    () =>
      Array.from(new Set(SNAPSHOT.evidence.map((e) => e.caseType).filter(Boolean))) as string[],
    [],
  );
  const allEvalTypes = useMemo(
    () =>
      Array.from(new Set(SNAPSHOT.evidence.map((e) => e.evalType).filter(Boolean))) as string[],
    [],
  );

  const filteredIsAll = filtered.length === SNAPSHOT.evidence.length;

  return (
    <div className="flex-1 overflow-hidden flex" style={{ background: '#F7F8FB' }}>
      {/* Main content column */}
      <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
        {/* Summary cards */}
        <div className="grid grid-cols-4 gap-4">
          <StatCard
            label="Total Evidence"
            value={SNAPSHOT.summary.total}
            hint={`across ${SNAPSHOT.agents.length} agents`}
          />
          <StatCard
            label="Single-Turn"
            value={SNAPSHOT.summary.byKind.single}
            hint="code-graded + rubric"
          />
          <StatCard
            label="Multi-Turn Flows"
            value={SNAPSHOT.summary.byKind.flow}
            hint="stateful scenarios"
          />
          <StatCard
            label="Showing"
            value={filtered.length}
            hint={filteredIsAll ? 'all evidence' : 'after filters'}
          />
        </div>

        {/* Filter bar + Run */}
        <div
          className="rounded-2xl p-4 flex items-center gap-3 flex-wrap"
          style={{ background: '#fff', border: '1px solid #F0F1F5' }}
        >
          {/* Search */}
          <div
            className="flex items-center gap-2 px-3 py-2 rounded-xl flex-1 min-w-[220px]"
            style={{ background: '#F7F8FB', border: '1px solid #EEF0F5' }}
          >
            <Search style={{ width: 14, height: 14, color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Search id, name, or tags…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-[12.5px]"
              style={{ color: '#0f172a' }}
            />
            {query && (
              <button
                onClick={() => setQuery('')}
                className="text-[11px]"
                style={{ color: '#94a3b8' }}
              >
                clear
              </button>
            )}
          </div>

          {/* Agent filter */}
          <FilterSelect
            label="Agent"
            value={agentFilter}
            onChange={setAgentFilter}
            options={[
              { value: 'all', label: 'All agents' },
              ...SNAPSHOT.agents.map((a) => ({
                value: a,
                label: `${metaFor(a).label} (${SNAPSHOT.summary.byAgent[a] ?? 0})`,
              })),
            ]}
          />

          {/* Kind filter */}
          <FilterSelect
            label="Kind"
            value={kindFilter}
            onChange={(v) => setKindFilter(v as any)}
            options={[
              { value: 'all', label: 'All kinds' },
              { value: 'single', label: 'Single-turn' },
              { value: 'flow', label: 'Flow (multi-turn)' },
            ]}
          />

          {/* Case type filter */}
          <FilterSelect
            label="Case"
            value={caseTypeFilter}
            onChange={setCaseTypeFilter}
            options={[
              { value: 'all', label: 'All cases' },
              ...allCaseTypes.map((c) => ({ value: c, label: c })),
            ]}
          />

          {/* Eval type filter */}
          <FilterSelect
            label="Type"
            value={evalTypeFilter}
            onChange={setEvalTypeFilter}
            options={[
              { value: 'all', label: 'All types' },
              ...allEvalTypes.map((e) => ({ value: e, label: e })),
            ]}
          />

          {/* Subtle note — runs live in the Eval Score tab */}
          <span
            className="text-[10.5px] font-semibold ml-auto"
            style={{ color: '#94a3b8', letterSpacing: '0.02em' }}
          >
            {filteredIsAll ? `${filtered.length} cases` : `${filtered.length} / ${SNAPSHOT.evidence.length} cases`}
          </span>
        </div>

        {/* Groups */}
        {grouped.length === 0 ? (
          <div
            className="rounded-2xl py-16 flex flex-col items-center justify-center"
            style={{ background: '#fff', border: '1px dashed #E2E8F0' }}
          >
            <Filter style={{ width: 32, height: 32, color: '#cbd5e1' }} />
            <p className="mt-3 text-[13px] font-bold" style={{ color: '#64748b' }}>
              No evidence matches the current filters
            </p>
            <p className="mt-1 text-[11.5px]" style={{ color: '#94a3b8' }}>
              Try clearing the search or switching the agent filter.
            </p>
          </div>
        ) : (
          grouped.map(([agent, items]) => (
            <AgentGroup
              key={agent}
              agent={agent}
              items={items}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
          ))
        )}
      </div>

      {/* Detail side panel */}
      {selected && (
        <DetailPanel
          entry={selected}
          onClose={() => setSelectedId(null)}
        />
      )}
    </div>
  );
};

// ─── Sub-components ──────────────────────────────────────────────────────────

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<{ value: string; label: string }>;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="text-[10px] font-black uppercase"
        style={{ color: '#94a3b8', letterSpacing: '0.12em' }}
      >
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="text-[12px] font-semibold rounded-lg px-2.5 py-1.5 outline-none cursor-pointer"
        style={{
          background: '#F7F8FB',
          border: '1px solid #EEF0F5',
          color: '#334155',
        }}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

function AgentGroup({
  agent,
  items,
  selectedId,
  onSelect,
}: {
  agent: string;
  items: EvalEvidenceEntry[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const meta = metaFor(agent);
  return (
    <section
      className="rounded-2xl overflow-hidden"
      style={{ background: '#fff', border: '1px solid #F0F1F5' }}
    >
      {/* Header */}
      <div
        className="px-5 py-3.5 flex items-center justify-between"
        style={{
          background: meta.bg,
          borderBottom: `1px solid ${meta.border}`,
        }}
      >
        <div className="flex items-center gap-2.5">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: meta.accent, color: '#fff' }}
          >
            <Layers style={{ width: 14, height: 14 }} />
          </div>
          <div>
            <p
              className="text-[13px] font-black"
              style={{ color: '#0f172a', letterSpacing: '-0.01em' }}
            >
              {meta.label}
            </p>
            <p className="text-[10.5px]" style={{ color: '#64748b' }}>
              {items.length} case{items.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <span
          className="text-[10px] font-black uppercase px-2 py-1 rounded-full"
          style={{
            color: meta.accent,
            background: '#fff',
            border: `1px solid ${meta.border}`,
            letterSpacing: '0.12em',
          }}
        >
          {agent}
        </span>
      </div>

      {/* Cases */}
      <ul>
        {items.map((e) => {
          const active = e.id === selectedId;
          return (
            <li
              key={e.id}
              onClick={() => onSelect(e.id)}
              className="px-5 py-3 flex items-center gap-3 cursor-pointer transition-colors"
              style={{
                background: active ? 'rgba(249,115,22,0.04)' : 'transparent',
                borderTop: '1px solid #F4F6F9',
              }}
              onMouseEnter={(ev) => {
                if (!active)
                  (ev.currentTarget as HTMLElement).style.background = '#F9FAFB';
              }}
              onMouseLeave={(ev) => {
                if (!active)
                  (ev.currentTarget as HTMLElement).style.background = 'transparent';
              }}
            >
              <span
                className="text-[10px] font-black px-2 py-0.5 rounded-md shrink-0"
                style={{
                  background: active ? '#F97316' : '#F1F5F9',
                  color: active ? '#fff' : '#64748b',
                  fontFamily: 'ui-monospace, SFMono-Regular, monospace',
                  letterSpacing: '-0.01em',
                }}
              >
                {e.id}
              </span>
              <span
                className="text-[12.5px] flex-1 truncate"
                style={{
                  color: '#1e293b',
                  fontWeight: active ? 700 : 500,
                }}
              >
                {e.name}
              </span>
              <div className="flex items-center gap-1.5 shrink-0">
                {e.caseType && (
                  <Chip
                    color={
                      e.caseType === 'negative'
                        ? '#dc2626'
                        : e.caseType === 'safety'
                          ? '#b91c1c'
                          : '#059669'
                    }
                    bg={
                      e.caseType === 'negative'
                        ? 'rgba(220,38,38,0.08)'
                        : e.caseType === 'safety'
                          ? 'rgba(185,28,28,0.08)'
                          : 'rgba(5,150,105,0.08)'
                    }
                  >
                    {e.caseType}
                  </Chip>
                )}
                {e.evalType && <Chip>{e.evalType}</Chip>}
                {e.kind === 'flow' && (
                  <Chip color="#6366f1" bg="rgba(99,102,241,0.1)">
                    flow
                  </Chip>
                )}
              </div>
              <ChevronRight
                style={{ width: 14, height: 14, color: '#cbd5e1', flexShrink: 0 }}
              />
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DetailPanel({
  entry,
  onClose,
}: {
  entry: EvalEvidenceEntry;
  onClose: () => void;
}) {
  const meta = metaFor(entry.agent);
  return (
    <aside
      className="w-[440px] shrink-0 flex flex-col"
      style={{
        background: '#fff',
        borderLeft: '1px solid #F0F1F5',
        boxShadow: '-4px 0 16px rgba(0,0,0,0.04)',
      }}
    >
      {/* Header */}
      <header
        className="px-5 py-4 flex items-start justify-between"
        style={{
          background: meta.bg,
          borderBottom: `1px solid ${meta.border}`,
        }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[10px] font-black px-2 py-0.5 rounded-md"
              style={{
                background: meta.accent,
                color: '#fff',
                fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              }}
            >
              {entry.id}
            </span>
            <Chip
              color={meta.accent}
              bg="#fff"
              border={meta.border.replace('0.22', '0.4')}
            >
              {meta.label}
            </Chip>
            {entry.kind === 'flow' && (
              <Chip color="#6366f1" bg="rgba(99,102,241,0.1)">
                flow
              </Chip>
            )}
          </div>
          <h3
            className="text-[14px] font-black leading-tight"
            style={{ color: '#0f172a', letterSpacing: '-0.01em' }}
          >
            {entry.name}
          </h3>
        </div>
        <button
          onClick={onClose}
          className="w-7 h-7 rounded-lg flex items-center justify-center ml-2"
          style={{ background: 'rgba(255,255,255,0.6)', color: '#64748b' }}
          aria-label="Close"
        >
          <X style={{ width: 14, height: 14 }} />
        </button>
      </header>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5 text-[12.5px]">
        <Section label="Metadata">
          <MetaRow icon={CheckCircle2} label="Case Type" value={entry.caseType ?? '—'} />
          <MetaRow icon={CheckCircle2} label="Eval Type" value={entry.evalType ?? '—'} />
          <MetaRow icon={Layers} label="Kind" value={entry.kind} />
          <MetaRow icon={FileCode2} label="Source" value={entry.source} mono />
        </Section>

        {entry.tags.length > 0 && (
          <Section label="Tags">
            <div className="flex flex-wrap gap-1.5">
              {entry.tags.map((t) => (
                <Chip key={t}>
                  <Tag style={{ width: 10, height: 10 }} /> {t}
                </Chip>
              ))}
            </div>
          </Section>
        )}

        <Section label="Task Payload">
          <pre
            className="rounded-xl p-3 overflow-x-auto text-[11px] leading-relaxed"
            style={{
              background: '#0f172a',
              color: '#e2e8f0',
              fontFamily: 'ui-monospace, SFMono-Regular, monospace',
              maxHeight: 360,
            }}
          >
            {JSON.stringify(entry.task, null, 2)}
          </pre>
        </Section>
      </div>
    </aside>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p
        className="text-[10px] font-black uppercase mb-2"
        style={{ color: '#94a3b8', letterSpacing: '0.14em' }}
      >
        {label}
      </p>
      <div>{children}</div>
    </div>
  );
}

function MetaRow({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: React.ComponentType<{ style?: React.CSSProperties }>;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-start gap-2 py-1.5">
      <Icon style={{ width: 12, height: 12, color: '#94a3b8', marginTop: 2 }} />
      <span
        className="shrink-0"
        style={{ color: '#94a3b8', minWidth: 80, fontWeight: 600 }}
      >
        {label}
      </span>
      <span
        className="break-all"
        style={{
          color: '#0f172a',
          fontWeight: 500,
          fontFamily: mono
            ? 'ui-monospace, SFMono-Regular, monospace'
            : undefined,
          fontSize: mono ? 11 : undefined,
        }}
      >
        {value}
      </span>
    </div>
  );
}

export default EvalEvidenceView;
