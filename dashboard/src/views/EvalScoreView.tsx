// ─────────────────────────────────────────────────────────────────────────────
//  CZ Eval Score — the headline dashboard for "how healthy is the agent?"
//
//  Layout, top-to-bottom:
//
//    1. Hero banner         — the single CZ Score number + confidence + actions
//    2. Insights row        — 30-day trend chart (wide) + radar of components
//    3. Component cards     — 5 sub-scores, each with an info-tooltip explainer
//    4. Scenario reports    — one "report card" per scenario (expandable)
//    5. Side rail           — judges-disagreed + recent runs
//
//  Every metric on this page has a hover-to-read info popover so the user can
//  understand exactly what it measures without leaving the screen.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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

// ═══════════════════════════════════════════════════════════════════════════
// Design tokens & small formatters
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// Info tooltip — reusable popover anchored to an "i" button
// ═══════════════════════════════════════════════════════════════════════════
interface InfoContent {
  title: string;
  body: string;
  formula?: string;
  bands?: Array<{ label: string; range: string; tone: 'green' | 'yellow' | 'orange' | 'red' }>;
}

/**
 * InfoTooltip
 * ───────────
 * Renders the popover through a React portal into <body> so parent cards with
 * `overflow: hidden` can never clip it. The popover is positioned with `fixed`
 * coordinates computed from the trigger button's bounding rect, with automatic
 * viewport-edge flipping (down if there's space, up otherwise; clamped inside
 * 8px of the viewport edges horizontally).
 *
 * Interactions:
 *   - Hover opens (120 ms close grace period so the user can move the mouse
 *     from the pill into the popover without flicker).
 *   - Click toggles a sticky-open state.
 *   - ESC or clicking outside closes.
 *   - Repositions on scroll / resize so it never "drifts" off the button.
 */
const TOOLTIP_W = 300;
const TOOLTIP_MAX_H = 340;
const TOOLTIP_GAP = 8;
const VIEWPORT_PAD = 12;

function InfoTooltip({ info, align = 'right' }: { info: InfoContent; align?: 'right' | 'left' | 'center' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; placement: 'top' | 'bottom' } | null>(null);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const timer = useRef<number | null>(null);

  const computePosition = () => {
    const btn = btnRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();

    // Horizontal anchor
    let left: number;
    if (align === 'center') {
      left = rect.left + rect.width / 2 - TOOLTIP_W / 2;
    } else if (align === 'left') {
      left = rect.left;
    } else {
      left = rect.right - TOOLTIP_W;
    }
    // Clamp horizontally inside viewport
    const vpW = window.innerWidth;
    if (left < VIEWPORT_PAD) left = VIEWPORT_PAD;
    if (left + TOOLTIP_W > vpW - VIEWPORT_PAD) left = vpW - TOOLTIP_W - VIEWPORT_PAD;

    // Vertical: prefer below, flip above if it would overflow
    const vpH = window.innerHeight;
    const spaceBelow = vpH - rect.bottom;
    const spaceAbove = rect.top;
    let top: number;
    let placement: 'top' | 'bottom';
    if (spaceBelow >= TOOLTIP_MAX_H + TOOLTIP_GAP || spaceBelow >= spaceAbove) {
      top = rect.bottom + TOOLTIP_GAP;
      placement = 'bottom';
    } else {
      top = rect.top - TOOLTIP_GAP - TOOLTIP_MAX_H;
      if (top < VIEWPORT_PAD) top = VIEWPORT_PAD;
      placement = 'top';
    }

    setPos({ top, left, placement });
  };

  const show = () => {
    if (timer.current) window.clearTimeout(timer.current);
    computePosition();
    setOpen(true);
  };
  const hide = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 150);
  };

  // Re-compute on every open, and on scroll / resize while open
  useLayoutEffect(() => {
    if (!open) return;
    computePosition();
    const onScrollOrResize = () => computePosition();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    const onClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (popRef.current?.contains(target)) return;
      if (btnRef.current?.contains(target)) return;
      setOpen(false);
    };
    window.addEventListener('scroll', onScrollOrResize, true);
    window.addEventListener('resize', onScrollOrResize);
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClickOutside);
    return () => {
      window.removeEventListener('scroll', onScrollOrResize, true);
      window.removeEventListener('resize', onScrollOrResize);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClickOutside);
    };
    // align can change behaviour, recompute when it changes too
  }, [open, align]);

  // Clean up stray timer on unmount
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const popover = open && pos ? (
    <div
      ref={popRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        width: TOOLTIP_W,
        maxHeight: TOOLTIP_MAX_H,
        overflowY: 'auto',
        zIndex: 9999,
        background: '#0f172a',
        color: '#e2e8f0',
        borderRadius: 12,
        padding: 14,
        boxShadow: '0 18px 48px rgba(15,23,42,0.32)',
        border: '1px solid #1e293b',
      }}
      role="tooltip"
    >
      <div
        style={{
          color: '#fb923c',
          fontSize: 11.5,
          fontWeight: 900,
          letterSpacing: '0.02em',
          marginBottom: 6,
          textTransform: 'none',
        }}
      >
        {info.title}
      </div>
      <div
        style={{
          color: '#cbd5e1',
          fontSize: 11.5,
          lineHeight: 1.55,
        }}
      >
        {info.body}
      </div>
      {info.formula && (
        <div
          style={{
            marginTop: 10,
            padding: '6px 10px',
            borderRadius: 6,
            background: 'rgba(249,115,22,0.1)',
            color: '#fdba74',
            fontFamily: 'ui-monospace, SFMono-Regular, monospace',
            fontSize: 10.5,
            border: '1px solid rgba(249,115,22,0.24)',
            wordBreak: 'break-word',
          }}
        >
          {info.formula}
        </div>
      )}
      {info.bands && info.bands.length > 0 && (
        <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {info.bands.map((b) => (
            <div key={b.label} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 10.5 }}>
              <span
                style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: toneColor(b.tone),
                  flexShrink: 0,
                }}
              />
              <span style={{ color: '#e2e8f0', fontWeight: 700, minWidth: 64 }}>{b.label}</span>
              <span style={{ color: '#94a3b8' }}>{b.range}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  ) : null;

  return (
    <span
      style={{ display: 'inline-flex', position: 'relative' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <button
        ref={btnRef}
        type="button"
        className="inline-flex items-center justify-center rounded-full transition-all shrink-0"
        style={{
          width: 18,
          height: 18,
          background: open ? '#F97316' : '#E2E8F0',
          color: open ? '#fff' : '#475569',
          border: '1px solid',
          borderColor: open ? '#F97316' : '#CBD5E1',
          boxShadow: open ? '0 2px 6px rgba(249,115,22,0.3)' : 'none',
          cursor: 'pointer',
        }}
        onMouseEnter={(e) => {
          if (!open) {
            (e.currentTarget as HTMLElement).style.background = '#CBD5E1';
            (e.currentTarget as HTMLElement).style.color = '#1e293b';
          }
        }}
        onMouseLeave={(e) => {
          if (!open) {
            (e.currentTarget as HTMLElement).style.background = '#E2E8F0';
            (e.currentTarget as HTMLElement).style.color = '#475569';
          }
        }}
        onClick={() => {
          // Click toggles open and snaps the position to current placement
          setOpen((v) => {
            if (!v) computePosition();
            return !v;
          });
        }}
        aria-label={`About ${info.title}`}
        aria-expanded={open}
      >
        <Info style={{ width: 11, height: 11, strokeWidth: 2.5 }} />
      </button>
      {popover && createPortal(popover, document.body)}
    </span>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Metric info dictionary — every metric on this page is explained here.
// Keep wording plain-English; the numbers themselves are explained below.
// ═══════════════════════════════════════════════════════════════════════════
const METRIC_INFO = {
  czScore: {
    title: 'CZ Score',
    body:
      'A single 0–100 number summarising agent health. It is a weighted blend of five sub-scores — pass rate, rubric quality, hallucination-free rate, routing accuracy, and latency SLA.',
    formula:
      'czScore = 0.40·golden + 0.30·rubric + 0.15·hallucFree + 0.10·routing + 0.05·latency',
    bands: [
      { label: 'Excellent', range: '≥ 90', tone: 'green' as const },
      { label: 'Good',      range: '75 – 89', tone: 'yellow' as const },
      { label: 'At risk',   range: '50 – 74', tone: 'orange' as const },
      { label: 'Failing',   range: '< 50',  tone: 'red' as const },
    ],
  },
  confidence: {
    title: 'Confidence (± band)',
    body:
      'How much the score might swing if we reran the same evaluation. Lower ± means scenarios are stable across repeats and judges agree with each other.',
    formula: '± = f(scenario flakiness, judge disagreement)',
  },
  delta: {
    title: 'Delta vs. baseline',
    body:
      'Difference between this run and the rolling median of recent runs on the same config. Positive = the agent improved; negative = regression.',
  },
  passed: {
    title: 'Passed / Failed',
    body:
      'A scenario passes if code-graded assertions match AND the rubric median is ≥ the scenario\'s passing threshold across all N repeats.',
  },
  mustPassFailed: {
    title: 'Must-pass failed',
    body:
      'Flagged scenarios that are part of the CI release gate. Any must-pass failure blocks a release regardless of overall CZ Score.',
  },
  flaky: {
    title: 'Flaky scenarios',
    body:
      'Scenarios where the median-score standard deviation across N repeats exceeded the flaky threshold. Flaky = inconsistent behaviour, even if it often passes.',
    bands: [
      { label: 'Stable',  range: '< 0.5 σ', tone: 'green' as const },
      { label: 'Wobbly',  range: '0.5 – 1.5 σ', tone: 'yellow' as const },
      { label: 'Flaky',   range: '≥ 1.5 σ', tone: 'red' as const },
    ],
  },
  golden: {
    title: 'Golden Pass Rate',
    body:
      'The gate metric. Share of all locked scenarios that pass — both their code-graded assertions and the overall rubric floor. Must-pass scenarios count extra via their weight.',
    formula: 'sum(weight · passed) / sum(weight)',
  },
  rubric: {
    title: 'Rubric Average',
    body:
      'Weighted median of the five rubric dimensions (goal, routing, efficiency, accuracy, quality). Scored by the 3-judge LLM ensemble, rescaled to 0–100.',
  },
  hallucinationFree: {
    title: 'Hallucination-free Rate',
    body:
      'Share of replies with NO fabricated data (fake bookings, invented balances, made-up chargers). Detected by a dedicated judge that cross-checks response content against available context.',
  },
  routing: {
    title: 'Routing Accuracy',
    body:
      'Share of user messages that were handled by the correct sub-agent (discovery / payment / session / support / etc.). Wrong routing is the #1 cause of bad UX.',
  },
  latencySla: {
    title: 'Latency SLA',
    body:
      'Share of responses returned within the SLA budget (10 s end-to-end for WhatsApp). Slow replies frustrate users and distort other quality signals.',
  },
  contribution: {
    title: 'Contribution',
    body:
      'How many points this scenario added (or lost) to the CZ Score. = scenario weight × median score. Bigger bars = higher impact on the overall number.',
  },
  agreement: {
    title: 'Judge Agreement',
    body:
      'How aligned the 3-judge ensemble was on this scenario. Low agreement is a signal the scenario is subjective or the rubric is ambiguous — candidates for human review.',
  },
  medianLatency: {
    title: 'Median Latency',
    body:
      'The middle response time across N repeats. Less outlier-sensitive than the mean. Compare against the SLA budget to see how much headroom you have.',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// 30-day trend SVG (preserved from the previous version, styling unchanged)
// ═══════════════════════════════════════════════════════════════════════════
function TrendSvg({ series, height = 140 }: { series: EvalTrendPoint[]; height?: number }) {
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

// ═══════════════════════════════════════════════════════════════════════════
// Component Radar — visual shape of the 5 component scores
// Each axis is 0 at centre, 100 at edge. Overlay on a 4-ring grid.
// ═══════════════════════════════════════════════════════════════════════════
interface RadarAxis {
  label: string;
  short: string;
  value: number; // 0-100
  weight: number; // 0-1
}

function ComponentRadar({ axes, size = 260 }: { axes: RadarAxis[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const radius = size / 2 - 26;
  const angleStep = (Math.PI * 2) / axes.length;

  const pointFor = (v: number, i: number) => {
    const r = (Math.min(Math.max(v, 0), 100) / 100) * radius;
    const a = -Math.PI / 2 + i * angleStep;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };
  const labelFor = (i: number) => {
    const r = radius + 14;
    const a = -Math.PI / 2 + i * angleStep;
    return { x: cx + Math.cos(a) * r, y: cy + Math.sin(a) * r };
  };

  const valuePoints = axes.map((ax, i) => pointFor(ax.value, i));
  const polygon = valuePoints.map((p) => `${p.x},${p.y}`).join(' ');

  const rings = [25, 50, 75, 100];

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size}>
      <defs>
        <radialGradient id="radarFill" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#F97316" stopOpacity="0.22" />
          <stop offset="100%" stopColor="#F97316" stopOpacity="0.06" />
        </radialGradient>
      </defs>

      {/* concentric grid */}
      {rings.map((r) => {
        const pts = axes
          .map((_, i) => pointFor(r, i))
          .map((p) => `${p.x},${p.y}`)
          .join(' ');
        return (
          <polygon
            key={r}
            points={pts}
            fill="none"
            stroke="#EEF0F5"
            strokeWidth={1}
          />
        );
      })}

      {/* axes */}
      {axes.map((_, i) => {
        const p = pointFor(100, i);
        return (
          <line
            key={i}
            x1={cx}
            y1={cy}
            x2={p.x}
            y2={p.y}
            stroke="#EEF0F5"
            strokeWidth={1}
          />
        );
      })}

      {/* value shape */}
      <polygon
        points={polygon}
        fill="url(#radarFill)"
        stroke="#F97316"
        strokeWidth={2}
        strokeLinejoin="round"
      />

      {/* value dots */}
      {valuePoints.map((p, i) => (
        <circle
          key={i}
          cx={p.x}
          cy={p.y}
          r={3.5}
          fill="#fff"
          stroke="#F97316"
          strokeWidth={2}
        />
      ))}

      {/* axis labels */}
      {axes.map((ax, i) => {
        const lp = labelFor(i);
        return (
          <g key={ax.label}>
            <text
              x={lp.x}
              y={lp.y}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={800}
              fill="#64748b"
              style={{ letterSpacing: '0.04em', textTransform: 'uppercase' }}
            >
              {ax.short}
            </text>
            <text
              x={lp.x}
              y={lp.y + 11}
              textAnchor="middle"
              dominantBaseline="middle"
              fontSize={10}
              fontWeight={700}
              fill="#0f172a"
            >
              {ax.value.toFixed(0)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Latency histogram — tiny per-scenario bar chart of run response times
// ═══════════════════════════════════════════════════════════════════════════
function LatencyBars({
  values,
  sla = 10_000,
  height = 44,
}: {
  values: number[];
  sla?: number;
  height?: number;
}) {
  if (!values.length) return null;
  const max = Math.max(sla, ...values) * 1.1;
  const barW = 100 / values.length;
  return (
    <div
      className="rounded-lg px-2 py-2"
      style={{ background: '#f8fafc', border: '1px solid #e2e8f0' }}
    >
      <svg viewBox={`0 0 100 ${height}`} width="100%" height={height} preserveAspectRatio="none">
        {/* SLA line */}
        <line
          x1="0"
          x2="100"
          y1={height - (sla / max) * (height - 4) - 2}
          y2={height - (sla / max) * (height - 4) - 2}
          stroke="#ef4444"
          strokeDasharray="2 2"
          strokeWidth={0.5}
          opacity={0.6}
        />
        {values.map((v, i) => {
          const h = (v / max) * (height - 4);
          const within = v <= sla;
          return (
            <rect
              key={i}
              x={i * barW + barW * 0.15}
              y={height - h - 2}
              width={barW * 0.7}
              height={h}
              fill={within ? '#22c55e' : '#ef4444'}
              opacity={0.85}
              rx={0.6}
            />
          );
        })}
      </svg>
      <div
        className="flex items-center justify-between text-[9px] mt-0.5"
        style={{ color: '#94a3b8', fontWeight: 600 }}
      >
        <span>per-run latency</span>
        <span>SLA {(sla / 1000).toFixed(0)}s</span>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Mini sparkline (preserved)
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// Hero banner
// ═══════════════════════════════════════════════════════════════════════════
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
      <div
        className="absolute inset-y-0 left-0 w-1.5"
        style={{ background: BRAND }}
      />

      <div className="flex items-start justify-between gap-8">
        {/* Left: score + meta */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <span
              className="inline-flex items-center gap-1 text-[10px] uppercase font-black tracking-[0.22em] px-2 py-1 rounded-md"
              style={{ color: '#F97316', background: 'rgba(249,115,22,0.08)' }}
            >
              CZ Agent Score
              <InfoTooltip info={METRIC_INFO.czScore} align="left" />
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
                title="Rubric hash — stamped on every run to keep history comparable."
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
              <div className="pb-3 text-slate-500 text-[13px] font-semibold inline-flex items-center gap-1">
                ± {formatScore(conf, 1)}
                <InfoTooltip info={METRIC_INFO.confidence} />
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 mt-4 text-[12.5px]">
            {delta != null && (
              <div className="inline-flex items-center gap-1.5">
                <TrendArrow delta={delta} />
                <span
                  className="font-semibold"
                  style={{ color: delta > 0 ? '#16a34a' : delta < 0 ? '#dc2626' : '#64748b' }}
                >
                  {delta > 0 ? '+' : ''}{formatScore(delta, 1)} vs baseline
                </span>
                {report?.baselineScore != null && (
                  <span className="text-slate-400">(baseline: {formatScore(report.baselineScore, 1)})</span>
                )}
                <InfoTooltip info={METRIC_INFO.delta} />
              </div>
            )}
            {report?.stats && (
              <div className="inline-flex items-center gap-1 text-slate-500">
                <span className="font-bold text-slate-700">{report.stats.passed}</span>
                <span className="text-slate-400">/ {report.stats.totalScenarios} passed</span>
                <InfoTooltip info={METRIC_INFO.passed} />
                {report.stats.mustPassFailed > 0 && (
                  <span className="ml-3 inline-flex items-center gap-1 text-red-600 font-bold">
                    {report.stats.mustPassFailed} must-pass failed
                    <InfoTooltip info={METRIC_INFO.mustPassFailed} />
                  </span>
                )}
                {report.stats.flaky > 0 && (
                  <span className="ml-3 inline-flex items-center gap-1 text-amber-600 font-bold">
                    {report.stats.flaky} flaky
                    <InfoTooltip info={METRIC_INFO.flaky} />
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

// ═══════════════════════════════════════════════════════════════════════════
// Component card
// ═══════════════════════════════════════════════════════════════════════════
function ComponentCard({
  label,
  icon: Icon,
  value,
  weight,
  trend,
  description,
  info,
}: {
  label: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  value: number;
  weight: number;
  trend?: number[];
  description: string;
  info: InfoContent;
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
          <span className="text-[11.5px] font-black uppercase tracking-wider text-slate-600 inline-flex items-center gap-1.5">
            {label}
            <InfoTooltip info={info} />
          </span>
        </div>
        <span
          className="text-[9px] font-bold uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-md text-slate-500"
          style={{ background: '#F7F8FB', border: BORDER }}
          title={`Weighted at ${Math.round(weight * 100)}% of CZ Score`}
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

// ═══════════════════════════════════════════════════════════════════════════
// Scenario Report Card — one full report card per scenario
// Replaces the prior dense table row. Each scenario is now a self-contained
// report with a clear verdict, key metrics, rubric bars, and an expandable
// per-run section with response text + judge breakdown.
// ═══════════════════════════════════════════════════════════════════════════
type SortKey = 'contribution' | 'medianScore' | 'weight' | 'flakiness';

function ScenarioReportList({ scenarios }: { scenarios: ScenarioScore[] }) {
  const [sort, setSort] = useState<SortKey>('contribution');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [onlyFailing, setOnlyFailing] = useState(false);

  const sorted = useMemo(() => {
    let copy = [...scenarios];
    if (onlyFailing) copy = copy.filter((s) => !s.overallPass);
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
  }, [scenarios, sort, onlyFailing]);

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
    >
      {/* Header */}
      <div className="px-5 py-4 flex items-center justify-between border-b border-slate-100 gap-3 flex-wrap">
        <div>
          <h3 className="text-[13px] font-black text-slate-800" style={{ letterSpacing: '-0.01em' }}>
            Scenario Reports
          </h3>
          <p className="text-[11px] text-slate-500 mt-0.5">
            One report per evaluated scenario · click any card to expand the per-run detail
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Fail toggle */}
          <button
            onClick={() => setOnlyFailing((v) => !v)}
            className="text-[10.5px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition"
            style={{
              background: onlyFailing ? 'rgba(239,68,68,0.12)' : 'transparent',
              color: onlyFailing ? '#dc2626' : '#64748b',
              border: onlyFailing ? '1px solid rgba(239,68,68,0.25)' : '1px solid #EEF0F5',
            }}
          >
            {onlyFailing ? 'Showing failing only' : 'Only failing'}
          </button>

          {/* Sort */}
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
      </div>

      {/* Cards */}
      <div className="p-4 space-y-3" style={{ background: '#F7F8FB' }}>
        {sorted.length === 0 && (
          <div className="p-10 text-center text-slate-400 text-[12.5px]">
            {onlyFailing ? 'No failing scenarios — nice.' : 'No scenarios scored yet.'}
          </div>
        )}
        {sorted.map((sc) => (
          <ScenarioReportCard
            key={sc.scenarioId}
            scenario={sc}
            expanded={expanded === sc.scenarioId}
            onToggle={() => setExpanded(expanded === sc.scenarioId ? null : sc.scenarioId)}
          />
        ))}
      </div>
    </div>
  );
}

function ScenarioReportCard({
  scenario: sc,
  expanded,
  onToggle,
}: {
  scenario: ScenarioScore;
  expanded: boolean;
  onToggle: () => void;
}) {
  const accent =
    !sc.overallPass ? '#ef4444' :
    sc.flakinessTier === 'flaky' ? '#f59e0b' :
    '#22c55e';
  const verdict =
    !sc.overallPass ? 'FAILED' :
    sc.flakinessTier === 'flaky' ? 'FLAKY' :
    'PASSED';

  return (
    <div
      className="rounded-2xl overflow-hidden"
      style={{
        background: '#ffffff',
        border: `1px solid ${expanded ? accent + '55' : '#EEF0F5'}`,
        boxShadow: expanded ? '0 12px 32px rgba(15,23,42,0.08)' : '0 1px 2px rgba(15,23,42,0.02)',
        transition: 'box-shadow 0.15s, border-color 0.15s',
      }}
    >
      {/* Card header */}
      <button
        onClick={onToggle}
        className="w-full text-left flex items-center gap-4 px-5 py-4"
      >
        {/* Verdict chevron */}
        <div className="shrink-0" style={{ color: '#94a3b8' }}>
          {expanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
        </div>

        {/* Vertical verdict bar */}
        <div
          className="w-1 self-stretch rounded-full shrink-0"
          style={{ background: accent }}
        />

        {/* Title + id + tags */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span
              className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
              style={{ background: accent + '18', color: accent }}
            >
              {verdict}
            </span>
            {sc.mustPass && (
              <span
                className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{ background: '#fee2e2', color: '#b91c1c' }}
                title="Release-gate scenario — must pass"
              >
                Must Pass
              </span>
            )}
            {sc.regressionAlert && (
              <span
                className="text-[9px] font-black uppercase tracking-widest px-1.5 py-0.5 rounded"
                style={{ background: '#ffedd5', color: '#c2410c' }}
                title="Degraded vs. last run on the same scenario"
              >
                Regression
              </span>
            )}
            {sc.category && (
              <span className="text-[10px] text-slate-400">· {sc.category}</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <span className="text-[13px] font-bold text-slate-800 truncate">{sc.title}</span>
          </div>
          <div className="text-[10.5px] text-slate-400 mt-0.5 font-mono">{sc.scenarioId}</div>
        </div>

        {/* Key numbers */}
        <div className="hidden sm:grid grid-cols-4 gap-5 shrink-0">
          <HeaderStat
            label="Median"
            value={formatScore(sc.medianScore, 0)}
            suffix="/100"
          />
          <HeaderStat
            label="Pass rate"
            value={formatPct((sc.passRate ?? 0) * 100)}
            tone={sc.passRate >= 0.95 ? 'green' : sc.passRate >= 0.7 ? 'yellow' : 'red'}
          />
          <HeaderStat
            label="Flakiness"
            value={`±${(sc.stdevScore ?? 0).toFixed(1)}`}
            tone={sc.flakinessTier === 'stable' ? 'green' : sc.flakinessTier === 'wobbly' ? 'yellow' : 'red'}
          />
          <HeaderStat
            label="Contribution"
            value={(sc.contribution ?? 0).toFixed(1)}
            suffix="pts"
            infoKey="contribution"
          />
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && <ScenarioDetail scenario={sc} />}
    </div>
  );
}

function HeaderStat({
  label,
  value,
  suffix,
  tone,
  infoKey,
}: {
  label: string;
  value: string;
  suffix?: string;
  tone?: 'green' | 'yellow' | 'red';
  infoKey?: keyof typeof METRIC_INFO;
}) {
  const color =
    tone === 'green'  ? '#16a34a' :
    tone === 'yellow' ? '#a16207' :
    tone === 'red'    ? '#dc2626' :
                        '#0f172a';
  return (
    <div className="text-right min-w-[64px]">
      <div className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-slate-500">
        {label}
        {infoKey && <InfoTooltip info={METRIC_INFO[infoKey]} />}
      </div>
      <div className="text-[15px] font-black mt-0.5" style={{ color }}>
        {value}
        {suffix && <span className="text-[10px] font-semibold text-slate-400 ml-0.5">{suffix}</span>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// Scenario detail (expanded) — rubric bars, metric pills, per-run list,
// latency histogram. Re-used from the previous version with polish.
// ═══════════════════════════════════════════════════════════════════════════
function ScenarioDetail({ scenario }: { scenario: ScenarioScore }) {
  const dims = [
    { id: 'goal', label: 'Goal' },
    { id: 'routing', label: 'Routing' },
    { id: 'efficiency', label: 'Efficiency' },
    { id: 'accuracy', label: 'Accuracy' },
    { id: 'quality', label: 'Quality' },
  ] as const;

  const latencies = scenario.runs.map((r) => r.responseTimeMs).filter((t) => t > 0);

  return (
    <div className="px-6 py-5 border-t" style={{ background: '#f8fafc', borderColor: '#eef0f5' }}>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mb-5">
        {/* Rubric dims — left two columns on large */}
        <div className="lg:col-span-2">
          <div className="text-[10.5px] font-black uppercase tracking-wider text-slate-500 mb-2">
            Rubric dimensions (0–10)
          </div>
          <div className="grid grid-cols-5 gap-2">
            {dims.map((d) => {
              const v = scenario.perDim?.[d.id];
              const vNum = typeof v === 'number' ? v : null;
              const col = vNum == null ? '#cbd5e1' : vNum >= 7 ? '#22c55e' : vNum >= 5 ? '#f59e0b' : '#ef4444';
              const fill = vNum == null ? 0 : Math.min(Math.max(vNum / 10, 0), 1);
              return (
                <div key={d.id} className="rounded-lg bg-white p-2.5 border border-slate-100">
                  <div className="text-[9px] uppercase font-bold tracking-wider text-slate-500">
                    {d.label}
                  </div>
                  <div className="flex items-end gap-0.5 mt-0.5">
                    <span className="text-[18px] font-black leading-none" style={{ color: col }}>
                      {vNum == null ? '—' : vNum.toFixed(1)}
                    </span>
                    <span className="text-[9px] text-slate-400 pb-0.5">/10</span>
                  </div>
                  <div className="h-1 mt-1.5 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${fill * 100}%`, background: col }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Latency histogram */}
        <div>
          <div className="text-[10.5px] font-black uppercase tracking-wider text-slate-500 mb-2 inline-flex items-center gap-1">
            Latency across runs <InfoTooltip info={METRIC_INFO.medianLatency} />
          </div>
          <LatencyBars values={latencies} />
          <div className="mt-1.5 text-[10.5px] text-slate-500">
            median{' '}
            <span className="font-bold text-slate-700">
              {scenario.medianLatency > 0
                ? scenario.medianLatency < 1000
                  ? `${scenario.medianLatency}ms`
                  : `${(scenario.medianLatency / 1000).toFixed(1)}s`
                : '—'}
            </span>
          </div>
        </div>
      </div>

      {/* Metric pills */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-5">
        <DetailPill
          label="Hallucination-free"
          value={formatPct((scenario.hallucinationFreeRate ?? 0) * 100)}
          tone={scenario.hallucinationFreeRate >= 0.99 ? 'green' : scenario.hallucinationFreeRate >= 0.9 ? 'yellow' : 'red'}
          infoKey="hallucinationFree"
        />
        <DetailPill
          label="Routing accuracy"
          value={formatPct((scenario.routingAccuracy ?? 0) * 100)}
          tone={scenario.routingAccuracy >= 0.95 ? 'green' : scenario.routingAccuracy >= 0.8 ? 'yellow' : 'red'}
          infoKey="routing"
        />
        <DetailPill
          label="Latency SLA"
          value={formatPct((scenario.latencyRate ?? 0) * 100)}
          tone={scenario.latencyRate >= 0.9 ? 'green' : scenario.latencyRate >= 0.7 ? 'yellow' : 'red'}
          infoKey="latencySla"
        />
        <DetailPill
          label="Judge agreement"
          value={scenario.agreement != null ? `${(scenario.agreement * 100).toFixed(0)}%` : '—'}
          tone={(scenario.agreement ?? 0) >= 0.85 ? 'green' : (scenario.agreement ?? 0) >= 0.6 ? 'yellow' : 'red'}
          infoKey="agreement"
        />
      </div>

      {/* Per-run list */}
      <div className="space-y-2">
        <div className="text-[10.5px] font-black uppercase tracking-wider text-slate-500 flex items-center justify-between">
          <span>Runs · N = {scenario.n}</span>
          {scenario.runs.length > 0 && (
            <span className="text-slate-400 font-semibold normal-case tracking-normal">
              {scenario.runs.filter((r) => r.pass).length} passed, {scenario.runs.filter((r) => !r.pass).length} failed
            </span>
          )}
        </div>
        {scenario.runs.map((r, i) => (
          <div key={i} className="rounded-xl bg-white border border-slate-100 p-3">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {r.pass
                ? <CheckCircle2 className="w-4 h-4" style={{ color: '#22c55e' }} />
                : <XCircle      className="w-4 h-4" style={{ color: '#ef4444' }} />}
              <span className="text-[11.5px] font-bold text-slate-700">Run {i + 1}</span>
              <span className="text-[10px] text-slate-400">·</span>
              <span className="text-[11.5px] text-slate-600">
                composite <span className="font-bold">{formatScore(r.composite, 1)}</span>
              </span>
              {r.agentType && (
                <span className="text-[10px] text-slate-400 ml-2 px-1.5 py-0.5 rounded bg-slate-100 font-mono">
                  {r.agentType}
                </span>
              )}
              {r.hallucination && (
                <span
                  className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded"
                  style={{ background: '#fee2e2', color: '#b91c1c' }}
                >
                  Hallucination
                </span>
              )}
              {r.responseTimeMs > 0 && (
                <span
                  className="text-[10px] ml-auto font-semibold"
                  style={{ color: r.responseTimeMs <= 10_000 ? '#64748b' : '#dc2626' }}
                >
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
                {r.responseText.length > 400 && <span className="text-slate-400">…</span>}
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

function DetailPill({
  label,
  value,
  tone,
  infoKey,
}: {
  label: string;
  value: string;
  tone: 'green' | 'yellow' | 'red';
  infoKey?: keyof typeof METRIC_INFO;
}) {
  const color = tone === 'green' ? '#16a34a' : tone === 'yellow' ? '#a16207' : '#dc2626';
  const bg    = tone === 'green' ? '#dcfce7' : tone === 'yellow' ? '#fef3c7' : '#fee2e2';
  return (
    <div className="rounded-xl bg-white p-3 border border-slate-100">
      <div className="text-[9.5px] uppercase font-bold tracking-wider text-slate-500 inline-flex items-center gap-1">
        {label}
        {infoKey && <InfoTooltip info={METRIC_INFO[infoKey]} />}
      </div>
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

// ═══════════════════════════════════════════════════════════════════════════
// Runner configurator modal (preserved)
// ═══════════════════════════════════════════════════════════════════════════
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

// ═══════════════════════════════════════════════════════════════════════════
// Main view
// ═══════════════════════════════════════════════════════════════════════════
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
  const weights = components?.weights ?? {
    goldenPassRate: 0.4,
    rubricAvg: 0.3,
    hallucinationFree: 0.15,
    routingAccuracy: 0.1,
    latencySla: 0.05,
  };

  const radarAxes: RadarAxis[] | null = components
    ? [
        { label: 'Golden', short: 'Golden',  value: components.goldenPassRate,    weight: weights.goldenPassRate },
        { label: 'Rubric', short: 'Rubric',  value: components.rubricAvg,         weight: weights.rubricAvg },
        { label: 'Halluc', short: 'H-free',  value: components.hallucinationFree, weight: weights.hallucinationFree },
        { label: 'Route',  short: 'Route',   value: components.routingAccuracy,   weight: weights.routingAccuracy },
        { label: 'Latency',short: 'Latency', value: components.latencySla,        weight: weights.latencySla },
      ]
    : null;

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

        {/* Insights row: 30-day trend + component radar */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          <div
            className="rounded-2xl p-5 lg:col-span-2"
            style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
          >
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-[13px] font-black text-slate-800 inline-flex items-center gap-1.5" style={{ letterSpacing: '-0.01em' }}>
                  30-day trend
                  <InfoTooltip
                    info={{
                      title: '30-day trend',
                      body:
                        'CZ Score for every completed eval run in the last 30 days. Dots are colour-coded by status band (green / yellow / orange / red).',
                    }}
                  />
                </h3>
                <p className="text-[11px] text-slate-500 mt-0.5">
                  Higher is better · hover a dot to see its status
                </p>
              </div>
              <div className="text-[11px] text-slate-500">
                {trend.length} run{trend.length === 1 ? '' : 's'}
              </div>
            </div>
            <TrendSvg series={trend} />
          </div>

          <div
            className="rounded-2xl p-5 flex flex-col"
            style={{ background: '#ffffff', border: BORDER, boxShadow: CARD_SHADOW }}
          >
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-[13px] font-black text-slate-800 inline-flex items-center gap-1.5" style={{ letterSpacing: '-0.01em' }}>
                Component shape
                <InfoTooltip
                  info={{
                    title: 'Component shape',
                    body:
                      'Radar plot of the 5 CZ Score components on a 0–100 scale. A round, outward-pushed shape means the agent is uniformly strong. Inward spikes are the weakest components.',
                  }}
                />
              </h3>
              {report?.meta?.n != null && (
                <span className="text-[10.5px] text-slate-400 font-semibold">N = {report.meta.n}</span>
              )}
            </div>
            <div className="flex-1 flex items-center justify-center">
              {radarAxes ? (
                <ComponentRadar axes={radarAxes} />
              ) : (
                <div className="text-[11.5px] text-slate-400">Run an eval to populate.</div>
              )}
            </div>
          </div>
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
              info={METRIC_INFO.golden}
            />
            <ComponentCard
              label="Rubric Average"
              icon={Target}
              value={components.rubricAvg}
              weight={weights.rubricAvg}
              description="Weighted median score from the 3-judge rubric ensemble."
              info={METRIC_INFO.rubric}
            />
            <ComponentCard
              label="Hallucination-free"
              icon={Sparkles}
              value={components.hallucinationFree}
              weight={weights.hallucinationFree}
              description="% of replies with no fabricated bookings or facts."
              info={METRIC_INFO.hallucinationFree}
            />
            <ComponentCard
              label="Routing Accuracy"
              icon={Gauge}
              value={components.routingAccuracy}
              weight={weights.routingAccuracy}
              description="% of messages handled by the correct sub-agent."
              info={METRIC_INFO.routing}
            />
            <ComponentCard
              label="Latency SLA"
              icon={Timer}
              value={components.latencySla}
              weight={weights.latencySla}
              description="% of replies returned within the 10 s SLA."
              info={METRIC_INFO.latencySla}
            />
          </div>
        )}

        {/* Scenario reports + side panels */}
        {report && report.scenarioBreakdown.length > 0 && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <div className="lg:col-span-2">
              <ScenarioReportList scenarios={report.scenarioBreakdown} />
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
                    <h3 className="text-[12px] font-black text-slate-800 uppercase tracking-wider inline-flex items-center gap-1.5">
                      Judges disagreed
                      <InfoTooltip info={METRIC_INFO.agreement} />
                    </h3>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Split-verdict scenarios — candidates for human review
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
                  Hover any <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full" style={{ background: '#e2e8f0', color: '#64748b' }}><Info className="w-2 h-2" /></span> icon for a plain-English explanation of that metric.
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
