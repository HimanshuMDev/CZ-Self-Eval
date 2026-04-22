// ─────────────────────────────────────────────────────────────────────────────
//  CZ Eval Score — the headline dashboard for "how healthy is the agent?"
//
//  Every piece on this page traces back to the rubric + score module in the
//  server. Read top-to-bottom:
//
//    1. Hero banner         — the single CZ Score number + confidence band
//    2. Trend chart         — 30-day rolling history
//    3. Five component cards— sub-scores with individual contribution
//    4. Scenario table      — per-scenario contribution, sortable
//    5. Low-agreement panel — scenarios where judges disagreed the most
//    6. Recent runs         — last 15 runs, click to open a full report
//
//  The "Run Eval" button opens a configurator, kicks off a backend run, and
//  streams progress via SSE.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  PlayCircle, Loader2, TrendingUp, TrendingDown, Minus,
  ShieldCheck, Target, Sparkles, Gauge, Timer, AlertTriangle,
  CheckCircle2, XCircle, ChevronRight, ChevronDown, Trash2,
  Activity, Zap, Settings2, RefreshCw, X, Info,
} from 'lucide-react';

import {
  fetchLatestEvalScore,
  fetchEvalTrend,
  fetchEvalRuns,
  fetchEvalRun,
  deleteEvalRun,
  startEvalRun,
  type EvalScoreReport,
  type EvalTrendPoint,
  type EvalRunHeader,
  type EvalRunOptions,
  type EvalStreamEvent,
  type ScenarioScore,
  type StatusBand,
} from '../api';

// ─────────────────────────────────────────────────────────────────────────
// Small visual helpers
// ─────────────────────────────────────────────────────────────────────────
const BRAND        = 'linear-gradient(135deg, #F97316 0%, #fb923c 100%)';
const CARD_SHADOW  = '0 4px 24px rgba(15,23,42,0.05)';
const BORDER       = '1px solid #EEF0F5';

function toneColor(tone?: StatusBand['tone']): string {
  switch (tone) {
    case 'green':  return '#22c55e';
    case 'yellow': return '#f59e0b';
    case 'orange': return '#f97316';
    case 'red':    return '#ef4444';
    default:       return '#64748b';
  }
}

function TrendArrow({ delta }: { delta: number | null }) {
  if (delta == null || delta === 0) return <Minus className="w-4 h-4 text-slate-400" />;
  if (delta > 0) return <TrendingUp className="w-4 h-4" style={{ color: '#22c55e' }} />;
  return <TrendingDown className="w-4 h-4" style={{ color: '#ef4444' }} />;
}

function formatScore(n: number | null | undefined, decimals = 1): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(decimals);
}

function formatPct(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return `${n.toFixed(0)}%`;
}

function relativeTime(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1)  return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// Sparkline reused from MetricsDashboard style
function TrendSvg({ series, height = 120 }: { series: EvalTrendPoint[]; height?: number }) {
  const width = 720;
  if (!series.length) {
    return (
      <div
        className="flex items-center justify-center text-[12px] text-slate-400"
        style={{ height, width: '100%' }}
      >
        No runs yet — kick off your first eval to populate this chart.
      </div>
    );
  }
  const max = 100;
  const min = 0;
  const pts = series.map((p, i) => {
    const x = series.length === 1 ? width / 2 : (i / (series.length - 1)) * width;
    const y = height - ((p.czScore - min) / (max - min)) * (height - 20) - 10;
    return { x, y, p };
  });
  const path = pts.map((p, i) => (i === 0 ? 'M' : 'L') + ` ${p.x},${p.y}`).join(' ');
  const fill =
    `M ${pts[0].x},${height} ` +
    pts.map(p => `L ${p.x},${p.y}`).join(' ') +
    ` L ${pts[pts.length - 1].x},${height} Z`;

  const gridY = [25, 50, 75].map(v => height - ((v - min) / (max - min)) * (height - 20) - 10);

  return (
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" style={{ display: 'block' }}>
      <defs>
        <linearGradient id="evalTrendFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#F97316" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
        </linearGradient>
      </defs>
      {gridY.map((gy, i) => (
        <line key={i} x1="0" x2={width} y1={gy} y2={gy} stroke="#EEF0F5" strokeDasharray="3 4" />
      ))}
      <path d={fill} fill="url(#evalTrendFill)" />
      <path d={path} fill="none" stroke="#F97316" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {pts.map((p, i) => (
        <circle
          key={i}
          cx={p.x} cy={p.y} r={3.5}
          fill="#ffffff"
          stroke={toneColor(p.p.statusTone)}
          strokeWidth={2}
        />
      ))}
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Hero banner
// ─────────────────────────────────────────────────────────────────────────
function HeroBanner({
  report,
  running,
  onRun,
  onRefresh,
}: {
  report: EvalScoreReport | null;
  running: boolean;
  onRun: () => void;
  onRefresh: () => void;
}) {
  const score  = report?.czScore ?? null;
  const conf   = report?.confidence ?? null;
  const delta  = report?.deltaVsBaseline ?? null;
  const status = report?.status;
  const color  = toneColor(status?.tone);

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-8"
      style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
    >
      {/* decorative stripe */}
      <div
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: BRAND }}
      />

      <div className="flex items-start justify-between gap-8">
        {/* Left: score + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="text-[10px] uppercase font-black tracking-[0.22em] px-2 py-1 rounded-md"
              style={{ color: '#F97316', background: 'rgba(249,115,22,0.08)' }}
            >
              CZ Agent Score
            </span>
            {status && (
              <span
                className="text-[10px] uppercase font-black tracking-[0.18em] px-2 py-1 rounded-md"
                style={{ color, background: color + '15', border: `1px solid ${color}30` }}
              >
                {status.label}
              </span>
            )}
            {report?.meta?.configHash && (
              <span
                className="text-[10px] font-mono text-slate-400 px-2 py-1"
                title={`Rubric hash — stamped on every run to keep history comparable.`}
              >
                cfg {report.meta.configHash}
              </span>
            )}
          </div>

          <div className="flex items-end gap-3 leading-none">
            <div
              className="text-[96px] font-black"
              style={{
                background: score != null ? BRAND : undefined,
                WebkitBackgroundClip: 'text',
                WebkitTextFillColor: score != null ? 'transparent' : undefined,
                color: score == null ? '#cbd5e1' : undefined,
                letterSpacing: '-0.05em',
                lineHeight: 0.9,
              }}
            >
              {score != null ? formatScore(score, 1) : '—'}
            </div>
            <div className="pb-2 text-slate-400 text-[18px] font-bold">/ 100</div>
            {conf != null && (
              <div className="pb-3 text-slate-500 text-[13px] font-semibold">
                ± {formatScore(conf, 1)}
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 text-[12.5px]">
            {delta != null && (
              <div className="flex items-center gap-1.5">
                <TrendArrow delta={delta} />
                <span className="font-semibold" style={{ color: delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#64748b' }}>
                  {delta > 0 ? '+' : ''}{formatScore(delta, 1)} vs baseline
                </span>
                {report?.baselineScore != null && (
                  <span className="text-slate-400">(last baseline: {formatScore(report.baselineScore, 1)})</span>
                )}
              </div>
            )}
            {report?.stats && (
              <div className="text-slate-500">
                <span className="font-bold text-slate-700">{report.stats.passed}</span>
                <span className="text-slate-400"> / {report.stats.totalScenarios} passed</span>
                {report.stats.mustPassFailed > 0 && (
                  <span className="ml-3 text-red-600 font-bold">
                    {report.stats.mustPassFailed} must-pass failed
                  </span>
                )}
                {report.stats.flaky > 0 && (
                  <span className="ml-3 text-amber-600 font-bold">
                    {report.stats.flaky} flaky
                  </span>
                )}
              </div>
            )}
            {report?.meta?.computedAt && (
              <div className="text-slate-400">
                Computed {relativeTime(report.meta.computedAt)}
              </div>
            )}
          </div>
        </div>

        {/* Right: actions */}
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={onRun}
            disabled={running}
            className="flex items-center gap-2 px-5 py-3 rounded-2xl text-[13px] font-bold text-white transition-transform hover:scale-[1.02] active:scale-100 disabled:opacity-60 disabled:cursor-not-allowed"
            style={{ background: BRAND, boxShadow: '0 8px 24px rgba(249,115,22,0.34)', letterSpacing: '-0.01em' }}
          >
            {running ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Running eval…
              </>
            ) : (
              <>
                <PlayCircle className="w-4 h-4" />
                Run Eval Score
              </>
            )}
          </button>
          <button
            onClick={onRefresh}
            className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-500 hover:text-slate-700"
          >
            <RefreshCw className="w-3 h-3" />
            Refresh
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Component card
// ─────────────────────────────────────────────────────────────────────────
function ComponentCard({
  label, icon: Icon, value, weight, trend, description,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  value: number;
  weight: number;
  trend?: number[];
  description: string;
}) {
  const contrib = (value * weight);
  const color =
    value >= 90 ? '#22c55e' :
    value >= 75 ? '#F97316' :
    value >= 50 ? '#f59e0b' :
                  '#ef4444';

  return (
    <div
      className="rounded-2xl p-5 flex flex-col gap-3"
      style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-xl flex items-center justify-center"
            style={{ background: color + '18' }}
          >
            <Icon className="w-4 h-4" style={{ color }} />
          </div>
          <span className="text-[11.5px] font-black uppercase tracking-wider text-slate-600">
            {label}
          </span>
        </div>
        <span
          className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md text-slate-500"
          style={{ background: '#F7F8FB', border: BORDER }}
          title={`This component is weighted at ${Math.round(weight * 100)}% of the total CZ Score.`}
        >
          w {Math.round(weight * 100)}%
        </span>
      </div>

      <div className="flex items-end gap-2 leading-none">
        <span className="text-[32px] font-black" style={{ color: '#0f172a', letterSpacing: '-0.02em' }}>
          {formatScore(value, 1)}
        </span>
        <span className="text-[12px] text-slate-400 pb-1">/ 100</span>
      </div>

      {trend && trend.length > 1 && (
        <div className="-mx-1 mt-1">
          <MiniSparkline values={trend} color={color} />
        </div>
      )}

      <div className="text-[11px] text-slate-500 leading-snug">
        {description}
      </div>

      <div className="text-[10.5px] text-slate-400 pt-1 border-t border-slate-100">
        contributes <span className="font-bold text-slate-600">{contrib.toFixed(1)}</span> pts to CZ Score
      </div>
    </div>
  );
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const width = 180, height = 32;
  if (!values.length) return null;
  const max = 100;
  const pts = values.map((v, i) => {
    const x = values.length === 1 ? width / 2 : (i / (values.length - 1)) * width;
    const y = height - ((v / max) * (height - 4)) - 2;
    return `${x},${y}`;
  }).join(' ');

  return (
    <svg width={width} height={height} className="overflow-visible w-full">
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeOpacity={0.85}
        strokeWidth={1.6}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Scenario breakdown table
// ─────────────────────────────────────────────────────────────────────────
type SortKey = 'contribution' | 'medianScore' | 'weight' | 'flakiness';

function ScenarioTable({ scenarios }: { scenarios: ScenarioScore[] }) {
  const [sort, setSort] = useState<SortKey>('contribution');
  const [expanded, setExpanded] = useState<string | null>(null);

  const sorted = useMemo(() => {
    const copy = [...scenarios];
    copy.sort((a, b) => {
      switch (sort) {
        case 'contribution': return (b.contribution ?? 0) - (a.contribution ?? 0);
        case 'medianScore':  return b.medianScore - a.medianScore;
        case 'weight':       return b.weight - a.weight;
        case 'flakiness':    return b.flakiness - a.flakiness;
        default:             return 0;
      }
    });
    return copy;
  }, [scenarios, sort]);

  const maxContribution = Math.max(...sorted.map(s => s.contribution ?? 0), 1);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
    >
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100">
        <div>
          <h3 className="text-[13px] font-black text-slate-800" style={{ letterSpacing: '-0.01em' }}>
            Scenario Breakdown
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            What each scenario contributed to the CZ Score — sorted by impact.
          </p>
        </div>
        <div className="flex items-center gap-1 text-[10.5px]">
          {([
            ['contribution', 'Impact'],
            ['medianScore',  'Score'],
            ['weight',       'Weight'],
            ['flakiness',    'Flaky'],
          ] as [SortKey, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setSort(k)}
              className="px-2 py-1 rounded-md font-bold uppercase tracking-wider transition"
              style={{
                background: sort === k ? 'rgba(249,115,22,0.12)' : 'transparent',
                color:      sort === k ? '#ea580c' : '#64748b',
                border:     sort === k ? '1px solid rgba(249,115,22,0.25)' : '1px solid transparent',
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {sorted.length === 0 && (
          <div className="p-10 text-center text-slate-400 text-[12.5px]">
            No scenarios scored yet.
          </div>
        )}
        {sorted.map(sc => {
          const isOpen = expanded === sc.scenarioId;
          const barPct = ((sc.contribution ?? 0) / maxContribution) * 100;
          const tone =
            !sc.overallPass ? '#ef4444' :
            sc.flakinessTier === 'flaky' ? '#f59e0b' :
            '#22c55e';

          return (
            <div key={sc.scenarioId} className="group">
              <button
                onClick={() => setExpanded(isOpen ? null : sc.scenarioId)}
                className="w-full text-left px-5 py-3 flex items-center gap-3 hover:bg-slate-50 transition"
              >
                <div className="shrink-0">
                  {isOpen ? <ChevronDown className="w-4 h-4 text-slate-400" /> : <ChevronRight className="w-4 h-4 text-slate-400" />}
                </div>

                {/* Pass / fail pip */}
                <div
                  className="w-2 h-8 rounded-full shrink-0"
                  style={{ background: tone }}
                />

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[12.5px] text-slate-800 truncate">{sc.title}</span>
                    {sc.mustPass && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                        style={{ background: '#fee2e2', color: '#b91c1c' }}
                      >
                        Must Pass
                      </span>
                    )}
                    {sc.flakinessTier === 'flaky' && (
                      <span
                        className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
                        style={{ background: '#fef3c7', color: '#a16207' }}
                      >
                        Flaky
                      </span>
                    )}
                    {sc.category && (
                      <span className="text-[10px] text-slate-400">· {sc.category}</span>
                    )}
                  </div>
                  <div className="text-[10.5px] text-slate-400 mt-0.5 font-mono">
                    {sc.scenarioId}
                  </div>
                </div>

                <div className="w-[140px] shrink-0 hidden md:block">
                  <div className="h-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${barPct}%`, background: BRAND }}
                    />
                  </div>
                  <div className="text-[10px] text-slate-400 mt-1 text-right">
                    impact {(sc.contribution ?? 0).toFixed(1)}
                  </div>
                </div>

                <div className="w-16 shrink-0 text-right">
                  <div className="text-[14px] font-black text-slate-800">{formatScore(sc.medianScore, 0)}</div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">score</div>
                </div>

                <div className="w-14 shrink-0 text-right">
                  <div className="text-[14px] font-black text-slate-600">{sc.weight}</div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">weight</div>
                </div>

                <div className="w-16 shrink-0 text-right">
                  <div className="text-[13px] font-bold text-slate-700">±{(sc.stdevScore ?? 0).toFixed(1)}</div>
                  <div className="text-[9px] text-slate-400 uppercase tracking-wider">flaky</div>
                </div>
              </button>

              {isOpen && <ScenarioDetail scenario={sc} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function ScenarioDetail({ scenario }: { scenario: ScenarioScore }) {
  const dims = [
    { id: 'goal', label: 'Goal' },
    { id: 'routing', label: 'Routing' },
    { id: 'efficiency', label: 'Efficiency' },
    { id: 'accuracy', label: 'Accuracy' },
    { id: 'quality', label: 'Quality' },
  ] as const;

  return (
    <div className="bg-slate-50 px-6 py-5 border-t border-slate-100">
      {/* Rubric dims */}
      <div className="grid grid-cols-5 gap-3 mb-5">
        {dims.map(d => {
          const v = scenario.perDim?.[d.id];
          const vNum = typeof v === 'number' ? v : null;
          const col = vNum == null ? '#cbd5e1' : vNum >= 7 ? '#22c55e' : vNum >= 5 ? '#f59e0b' : '#ef4444';
          return (
            <div key={d.id} className="rounded-xl bg-white p-3 border border-slate-100">
              <div className="text-[9.5px] uppercase font-bold tracking-wider text-slate-500">{d.label}</div>
              <div className="flex items-end gap-1 mt-0.5">
                <span className="text-[22px] font-black leading-none" style={{ color: col }}>
                  {vNum == null ? '—' : vNum.toFixed(1)}
                </span>
                <span className="text-[10px] text-slate-400 pb-0.5">/10</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Other metrics */}
      <div className="grid grid-cols-4 gap-3 mb-5">
        <DetailPill
          label="Hallucination-free"
          value={formatPct((scenario.hallucinationFreeRate ?? 0) * 100)}
          tone={scenario.hallucinationFreeRate >= 0.99 ? 'green' : scenario.hallucinationFreeRate >= 0.9 ? 'yellow' : 'red'}
        />
        <DetailPill
          label="Routing accuracy"
          value={formatPct((scenario.routingAccuracy ?? 0) * 100)}
          tone={scenario.routingAccuracy >= 0.95 ? 'green' : scenario.routingAccuracy >= 0.8 ? 'yellow' : 'red'}
        />
        <DetailPill
          label="Latency SLA"
          value={formatPct((scenario.latencyRate ?? 0) * 100)}
          tone={scenario.latencyRate >= 0.9 ? 'green' : scenario.latencyRate >= 0.7 ? 'yellow' : 'red'}
        />
        <DetailPill
          label="Judge agreement"
          value={scenario.agreement != null ? `${(scenario.agreement * 100).toFixed(0)}%` : '—'}
          tone={(scenario.agreement ?? 0) >= 0.85 ? 'green' : (scenario.agreement ?? 0) >= 0.6 ? 'yellow' : 'red'}
        />
      </div>

      {/* Per-run list */}
      <div className="space-y-2">
        <div className="text-[10.5px] font-bold uppercase tracking-wider text-slate-500">
          Runs (N = {scenario.n})
        </div>
        {scenario.runs.map((r, i) => (
          <div
            key={i}
            className="rounded-xl bg-white border border-slate-100 p-3"
          >
            <div className="flex items-center gap-2 mb-1.5">
              {r.pass
                ? <CheckCircle2 className="w-4 h-4" style={{ color: '#22c55e' }} />
                : <XCircle      className="w-4 h-4" style={{ color: '#ef4444' }} />}
              <span className="text-[11.5px] font-bold text-slate-700">Run {i + 1}</span>
              <span className="text-[10px] text-slate-400">·</span>
              <span className="text-[11.5px] text-slate-600">composite <span className="font-bold">{formatScore(r.composite, 1)}</span></span>
              {r.agentType && (
                <span className="text-[10px] text-slate-400 ml-2 px-1.5 py-0.5 rounded bg-slate-100 font-mono">
                  {r.agentType}
                </span>
              )}
              {r.responseTimeMs > 0 && (
                <span className="text-[10px] text-slate-400 ml-auto">
                  {r.responseTimeMs < 1000
                    ? `${r.responseTimeMs}ms`
                    : `${(r.responseTimeMs / 1000).toFixed(1)}s`}
                </span>
              )}
            </div>
            {r.reason && <div className="text-[11px] text-slate-500 mb-1">{r.reason}</div>}
            {r.responseText && (
              <div
                className="text-[11.5px] text-slate-700 bg-slate-50 rounded-lg p-2.5 leading-relaxed"
                style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace' }}
              >
                {r.responseText.slice(0, 400)}
              </div>
            )}
            {r.judge && r.judge.judges.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {r.judge.judges.map((j, k) => (
                  <span
                    key={k}
                    className="text-[10px] px-2 py-0.5 rounded-md font-mono"
                    style={{ background: '#f1f5f9', color: '#475569' }}
                    title={j.rationale}
                  >
                    {j.judgeId}: {j.overall.toFixed(1)}
                  </span>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

function DetailPill({ label, value, tone }: { label: string; value: string; tone: 'green' | 'yellow' | 'red' }) {
  const color = tone === 'green' ? '#16a34a' : tone === 'yellow' ? '#a16207' : '#dc2626';
  const bg    = tone === 'green' ? '#dcfce7' : tone === 'yellow' ? '#fef3c7' : '#fee2e2';
  return (
    <div className="rounded-xl bg-white p-3 border border-slate-100">
      <div className="text-[9.5px] uppercase font-bold tracking-wider text-slate-500">{label}</div>
      <div className="flex items-center justify-between mt-0.5">
        <span className="text-[18px] font-black" style={{ color: '#0f172a' }}>{value}</span>
        <span
          className="text-[9px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded"
          style={{ color, background: bg }}
        >
          {tone}
        </span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Runner configurator modal
// ─────────────────────────────────────────────────────────────────────────
function RunConfigModal({
  open, onClose, onStart, defaults,
}: {
  open: boolean;
  onClose: () => void;
  onStart: (opts: EvalRunOptions) => void;
  defaults: EvalRunOptions;
}) {
  const [n, setN] = useState(defaults.n ?? 3);
  const [scope, setScope] = useState<EvalRunOptions['scope']>(defaults.scope ?? 'mustPass');
  const [useLlm, setUseLlm] = useState(!!defaults.useLlm);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-8"
      style={{ background: 'rgba(15,23,42,0.5)', backdropFilter: 'blur(4px)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-3xl bg-white p-7"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h3 className="text-[18px] font-black text-slate-900">Run CZ Eval Score</h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-slate-100">
            <X className="w-4 h-4 text-slate-500" />
          </button>
        </div>

        <div className="space-y-5">
          {/* Scope */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2 block">
              Scope
            </label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { id: 'mustPass', label: 'Must-pass only', sub: 'Fastest, gate-critical' },
                { id: 'all',      label: 'All scenarios',  sub: 'Full health check' },
              ].map(opt => (
                <button
                  key={opt.id}
                  onClick={() => setScope(opt.id as EvalRunOptions['scope'])}
                  className="text-left p-3 rounded-xl border transition"
                  style={{
                    borderColor: scope === opt.id ? '#F97316' : '#EEF0F5',
                    background:  scope === opt.id ? 'rgba(249,115,22,0.06)' : '#ffffff',
                  }}
                >
                  <div className="text-[12.5px] font-bold text-slate-800">{opt.label}</div>
                  <div className="text-[10.5px] text-slate-500 mt-0.5">{opt.sub}</div>
                </button>
              ))}
            </div>
          </div>

          {/* N selector */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2 block">
              Repetitions per scenario (N)
            </label>
            <div className="flex gap-2">
              {[1, 3, 5, 7].map(k => (
                <button
                  key={k}
                  onClick={() => setN(k)}
                  className="flex-1 py-2 rounded-xl text-[12.5px] font-bold transition"
                  style={{
                    background:  n === k ? BRAND : '#ffffff',
                    color:       n === k ? '#ffffff' : '#64748b',
                    border:      n === k ? '1px solid transparent' : BORDER,
                    boxShadow:   n === k ? '0 4px 14px rgba(249,115,22,0.3)' : 'none',
                  }}
                >
                  N = {k}
                </button>
              ))}
            </div>
            <p className="text-[10.5px] text-slate-400 mt-1.5">
              N ≥ 3 gives a stable median. Use 5 for release gates.
            </p>
          </div>

          {/* Judge mode */}
          <div>
            <label className="text-[11px] font-bold uppercase tracking-wider text-slate-600 mb-2 block">
              Judge
            </label>
            <div className="flex items-center gap-3 p-3 rounded-xl border" style={{ borderColor: '#EEF0F5' }}>
              <input
                id="useLlm"
                type="checkbox"
                checked={useLlm}
                onChange={e => setUseLlm(e.target.checked)}
                className="w-4 h-4 accent-orange-500"
              />
              <label htmlFor="useLlm" className="flex-1 cursor-pointer">
                <div className="text-[12px] font-bold text-slate-800">Use LLM judge (3-model ensemble)</div>
                <div className="text-[10.5px] text-slate-500 mt-0.5">
                  Requires ANTHROPIC_API_KEY or OPENAI_API_KEY on the server — falls back to heuristic if missing.
                </div>
              </label>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 mt-7">
          <button
            onClick={onClose}
            className="px-4 py-2 text-[12.5px] font-semibold text-slate-600 hover:bg-slate-100 rounded-xl"
          >
            Cancel
          </button>
          <button
            onClick={() => { onStart({ n, scope, useLlm }); }}
            className="px-5 py-2 text-[12.5px] font-bold text-white rounded-xl"
            style={{ background: BRAND, boxShadow: '0 6px 20px rgba(249,115,22,0.3)' }}
          >
            Start run
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────
// Main view
// ─────────────────────────────────────────────────────────────────────────
const EvalScoreView: React.FC = () => {
  const [report,   setReport]   = useState<EvalScoreReport | null>(null);
  const [trend,    setTrend]    = useState<EvalTrendPoint[]>([]);
  const [runs,     setRuns]     = useState<EvalRunHeader[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  const [configOpen, setConfigOpen] = useState(false);
  const [running,   setRunning]   = useState(false);
  const [progress,  setProgress]  = useState<{ done: number; total: number; scenario?: string } | null>(null);

  const runEsRef = useRef<{ close: () => void } | null>(null);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      const [latest, trendResp, runsResp] = await Promise.all([
        fetchLatestEvalScore().catch((): EvalScoreReport | null => null),
        fetchEvalTrend(30).catch(() => ({ days: 30, count: 0, series: [] as EvalTrendPoint[] })),
        fetchEvalRuns().catch(() => ({ count: 0, runs: [] as EvalRunHeader[] })),
      ]);
      setReport(latest && !latest.empty ? latest : null);
      setTrend(trendResp.series);
      setRuns(runsResp.runs);
    } catch (e: any) {
      setError(e?.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const handleStart = async (opts: EvalRunOptions) => {
    setConfigOpen(false);
    setRunning(true);
    setProgress({ done: 0, total: 0 });

    try {
      const { es, close } = await startEvalRun(opts, {
        onEvent: (evt: EvalStreamEvent) => {
          if (evt.type === 'start') {
            setProgress({ done: 0, total: evt.total });
          } else if (evt.type === 'scenario-start') {
            setProgress(p => ({ done: p?.done ?? 0, total: evt.total, scenario: evt.title }));
          } else if (evt.type === 'progress') {
            setProgress(p => ({ done: evt.done, total: evt.total, scenario: p?.scenario }));
          } else if (evt.type === 'complete') {
            setReport(evt.report);
            setRunning(false);
            setProgress(null);
            // refresh trend / runs
            load();
          } else if (evt.type === 'error') {
            setError(evt.message);
            setRunning(false);
            setProgress(null);
          }
        },
      });
      runEsRef.current = { close };
      void es;
    } catch (e: any) {
      setError(e?.message || 'Failed to start run');
      setRunning(false);
      setProgress(null);
    }
  };

  const cancelRun = () => {
    runEsRef.current?.close();
    runEsRef.current = null;
    setRunning(false);
    setProgress(null);
  };

  const loadOldRun = async (id: string) => {
    try {
      const r = await fetchEvalRun(id);
      setReport(r);
    } catch (e: any) {
      setError(e?.message || 'Failed to load run');
    }
  };

  const removeRun = async (id: string) => {
    if (!confirm('Delete this run? This cannot be undone.')) return;
    try {
      await deleteEvalRun(id);
      load();
    } catch (e: any) {
      setError(e?.message || 'Failed to delete run');
    }
  };

  const components = report?.components;
  const weights = components?.weights ?? { goldenPassRate: 0.4, rubricAvg: 0.3, hallucinationFree: 0.15, routingAccuracy: 0.1, latencySla: 0.05 };

  return (
    <div className="flex-1 overflow-y-auto p-7" style={{ background: '#F7F8FB' }}>
      <div className="max-w-[1320px] mx-auto space-y-6">
        {/* Error banner */}
        {error && (
          <div
            className="rounded-xl px-4 py-3 flex items-start gap-3"
            style={{ background: '#fef2f2', border: '1px solid #fecaca' }}
          >
            <AlertTriangle className="w-4 h-4 text-red-600 mt-0.5 shrink-0" />
            <div className="flex-1 text-[12px] text-red-700">{error}</div>
            <button onClick={() => setError(null)} className="text-red-600 text-[11px] font-bold">Dismiss</button>
          </div>
        )}

        {/* Hero */}
        {loading ? (
          <div
            className="rounded-3xl p-8 flex items-center justify-center min-h-[240px]"
            style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
          >
            <Loader2 className="w-5 h-5 animate-spin text-orange-500" />
            <span className="ml-2 text-[12.5px] text-slate-500 font-semibold">Loading latest eval…</span>
          </div>
        ) : (
          <HeroBanner
            report={report}
            running={running}
            onRun={() => setConfigOpen(true)}
            onRefresh={load}
          />
        )}

        {/* Running progress */}
        {running && progress && (
          <div
            className="rounded-2xl p-4 flex items-center gap-4"
            style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
          >
            <Loader2 className="w-4 h-4 animate-spin text-orange-500" />
            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between text-[11.5px] font-bold text-slate-700">
                <span>
                  Running {progress.total > 0 ? `${progress.done}/${progress.total}` : '…'}
                  {progress.scenario && <span className="text-slate-400 font-normal ml-2">· {progress.scenario}</span>}
                </span>
                <button onClick={cancelRun} className="text-[11px] text-red-600 hover:underline">Cancel</button>
              </div>
              <div className="h-1.5 mt-1.5 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{
                    width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 5}%`,
                    background: BRAND,
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Trend chart */}
        <div
          className="rounded-2xl p-5"
          style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
        >
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-[13px] font-black text-slate-800" style={{ letterSpacing: '-0.01em' }}>
                30-day trend
              </h3>
              <p className="text-[11px] text-slate-500 mt-0.5">
                CZ Score over time · higher is better · colour-coded by status band
              </p>
            </div>
            <div className="text-[11px] text-slate-500">
              {trend.length} run{trend.length === 1 ? '' : 's'}
            </div>
          </div>
          <TrendSvg series={trend} />
        </div>

        {/* Component cards */}
        {report && components && (
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
            <ComponentCard
              label="Golden Pass Rate"
              icon={ShieldCheck}
              value={components.goldenPassRate}
              weight={weights.goldenPassRate}
              trend={trend.map(t => t.czScore)}
              description="% of locked scenarios that passed, weighted by business impact."
            />
            <ComponentCard
              label="Rubric Average"
              icon={Target}
              value={components.rubricAvg}
              weight={weights.rubricAvg}
              description="Weighted median score from the 3-judge rubric ensemble."
            />
            <ComponentCard
              label="Hallucination-free"
              icon={Sparkles}
              value={components.hallucinationFree}
              weight={weights.hallucinationFree}
              description="% of replies with no fabricated bookings or facts."
            />
            <ComponentCard
              label="Routing Accuracy"
              icon={Gauge}
              value={components.routingAccuracy}
              weight={weights.routingAccuracy}
              description="% of messages handled by the correct sub-agent."
            />
            <ComponentCard
              label="Latency SLA"
              icon={Timer}
              value={components.latencySla}
              weight={weights.latencySla}
              description="% of replies returned within the 10 s SLA."
            />
          </div>
        )}

        {/* Scenario breakdown + side panels */}
        {report && report.scenarioBreakdown.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ScenarioTable scenarios={report.scenarioBreakdown} />
            </div>

            <div className="space-y-6">
              {/* Low agreement */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
              >
                <div className="px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Activity className="w-3.5 h-3.5 text-amber-500" />
                    <h3 className="text-[12px] font-black text-slate-800 uppercase tracking-wider">
                      Judges disagreed
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Scenarios where the 3-judge ensemble was split — candidates for human review.
                  </p>
                </div>
                <div className="divide-y divide-slate-100">
                  {report.lowAgreement.length === 0 && (
                    <div className="p-5 text-[11.5px] text-slate-400">
                      All judges agreed. Nothing to escalate.
                    </div>
                  )}
                  {report.lowAgreement.map(r => (
                    <div key={r.scenarioId} className="px-5 py-3">
                      <div className="text-[12px] font-bold text-slate-800 truncate">{r.title}</div>
                      <div className="flex items-center gap-3 mt-1 text-[10.5px] text-slate-500">
                        <span>agreement <span className="font-bold text-amber-600">{(r.agreement * 100).toFixed(0)}%</span></span>
                        <span>· score <span className="font-bold text-slate-700">{r.medianScore.toFixed(0)}</span></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Recent runs */}
              <div
                className="rounded-2xl overflow-hidden"
                style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
              >
                <div className="px-5 py-4 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <Zap className="w-3.5 h-3.5 text-orange-500" />
                    <h3 className="text-[12px] font-black text-slate-800 uppercase tracking-wider">
                      Recent runs
                    </h3>
                  </div>
                </div>
                <div className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto">
                  {runs.length === 0 && (
                    <div className="p-5 text-[11.5px] text-slate-400">
                      No runs yet.
                    </div>
                  )}
                  {runs.slice(0, 15).map(r => (
                    <div key={r.id} className="px-5 py-3 hover:bg-slate-50 group">
                      <div className="flex items-center justify-between">
                        <button
                          onClick={() => loadOldRun(r.id)}
                          className="flex-1 text-left"
                        >
                          <div className="flex items-center gap-2">
                            <span
                              className="inline-block w-2 h-2 rounded-full"
                              style={{ background: toneColor(r.statusTone) }}
                            />
                            <span className="text-[14px] font-black text-slate-800">
                              {formatScore(r.czScore, 1)}
                            </span>
                            <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                              {r.status}
                            </span>
                            {r.deltaVsBaseline != null && r.deltaVsBaseline !== 0 && (
                              <span
                                className="text-[10px] font-bold"
                                style={{ color: r.deltaVsBaseline > 0 ? '#16a34a' : '#dc2626' }}
                              >
                                {r.deltaVsBaseline > 0 ? '+' : ''}{r.deltaVsBaseline.toFixed(1)}
                              </span>
                            )}
                          </div>
                          <div className="text-[10.5px] text-slate-500 mt-0.5">
                            {relativeTime(r.runAt)} · {r.scope} · N={r.n} · {r.passed}/{r.passed + r.failed} passed
                          </div>
                        </button>
                        <button
                          onClick={() => removeRun(r.id)}
                          className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-50 text-red-500 transition"
                          title="Delete run"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Info tile */}
              <div
                className="rounded-2xl p-4 flex gap-2 text-[11px] leading-relaxed"
                style={{ background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.14)' }}
              >
                <Info className="w-3.5 h-3.5 shrink-0 mt-0.5" style={{ color: '#F97316' }} />
                <div className="text-slate-600">
                  The CZ Score is a weighted composite. Every number on this page traces to <span className="font-mono text-slate-700">server/rubric.js</span>.
                  Changes to the rubric produce a new config hash and mark historical runs as non-comparable.
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Empty state */}
        {report == null && !loading && (
          <div
            className="rounded-2xl p-12 text-center"
            style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center mx-auto mb-3"
              style={{ background: BRAND }}
            >
              <Settings2 className="w-6 h-6 text-white" />
            </div>
            <h3 className="text-[16px] font-black text-slate-800">No eval runs yet</h3>
            <p className="text-[12px] text-slate-500 mt-1 max-w-md mx-auto">
              Click <span className="font-bold text-orange-600">Run Eval Score</span> to execute the full multi-layer pipeline against the CZ agent and get your first baseline number.
            </p>
          </div>
        )}
      </div>

      <RunConfigModal
        open={configOpen}
        onClose={() => setConfigOpen(false)}
        onStart={handleStart}
        defaults={{ n: 3, scope: 'mustPass', useLlm: false }}
      />
    </div>
  );
};

export default EvalScoreView;
