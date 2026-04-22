import React, { useEffect, useState } from 'react';
import {
  TrendingUp, TrendingDown, Activity, Shield,
  CheckCircle2, XCircle, Clock, AlertTriangle, BarChart2,
  RefreshCw, Loader2, Flame,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface Metrics {
  healthScore: number;
  totalSessions: number;
  totalEvalRuns: number;
  evalPassRate: number;
  avgResponseMs: number;
  flakyCount: number;
  flags: { pass: number; fail: number; bug: number; slow: number };
  sessionsByDay: Record<string, number>;
  passRateByDay: Record<string, { pass: number; total: number }>;
  agentFailures: Record<string, number>;
  evalByCategory: Record<string, { pass: number; fail: number }>;
  topFailing: { name: string; reason: string; runAt: string; flaky: boolean }[];
}

// ─── Mini SVG charts ──────────────────────────────────────────────────────────

function Sparkline({ values, color = '#F97316', height = 48, width = 200 }: {
  values: number[]; color?: string; height?: number; width?: number;
}) {
  if (!values.length) return null;
  const max = Math.max(...values, 1);
  const pts = values.map((v, i) => {
    const x = (i / (values.length - 1)) * width;
    const y = height - (v / max) * (height - 4);
    return `${x},${y}`;
  }).join(' ');
  const fillPts = `0,${height} ${pts} ${width},${height}`;

  return (
    <svg width={width} height={height} className="overflow-visible">
      <defs>
        <linearGradient id={`sg-${color.replace('#','')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#sg-${color.replace('#','')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function DonutChart({ pass, total, size = 80 }: { pass: number; total: number; size?: number }) {
  const pct  = total > 0 ? pass / total : 0;
  const r    = (size - 12) / 2;
  const circ = 2 * Math.PI * r;
  const dash = pct * circ;
  const color = pct >= 0.8 ? '#22c55e' : pct >= 0.5 ? '#f97316' : '#ef4444';

  return (
    <svg width={size} height={size}>
      <circle cx={size/2} cy={size/2} r={r} fill="none" stroke="#f1f5f9" strokeWidth="10" />
      <circle
        cx={size/2} cy={size/2} r={r}
        fill="none" stroke={color} strokeWidth="10"
        strokeDasharray={`${dash} ${circ - dash}`}
        strokeLinecap="round"
        transform={`rotate(-90 ${size/2} ${size/2})`}
        style={{ transition: 'stroke-dasharray 0.8s ease' }}
      />
      <text x={size/2} y={size/2} textAnchor="middle" dominantBaseline="central"
        fontSize="14" fontWeight="800" fill={color}>
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

function BarChart({ data, colorPass = '#22c55e', colorFail = '#ef4444' }: {
  data: Record<string, { pass: number; fail: number }>;
  colorPass?: string; colorFail?: string;
}) {
  const entries = Object.entries(data);
  if (!entries.length) return <p className="text-xs text-slate-400 py-4 text-center">No data yet</p>;
  const maxVal = Math.max(...entries.map(([, v]) => v.pass + v.fail), 1);

  return (
    <div className="space-y-2.5">
      {entries.map(([cat, { pass, fail }]) => {
        const total = pass + fail;
        const pct   = total > 0 ? pass / total : 0;
        const label = cat.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        return (
          <div key={cat} className="space-y-1">
            <div className="flex justify-between items-center">
              <span className="text-[11px] font-semibold text-slate-600 capitalize">{label}</span>
              <span className={`text-[10px] font-bold ${pct >= 0.7 ? 'text-emerald-500' : pct >= 0.4 ? 'text-orange-500' : 'text-red-500'}`}>
                {pass}/{total}
              </span>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden flex">
              <div className="h-full rounded-full transition-all duration-700"
                style={{ width: `${(pass / maxVal) * 100}%`, background: colorPass }} />
              <div className="h-full transition-all duration-700"
                style={{ width: `${(fail / maxVal) * 100}%`, background: colorFail, opacity: 0.4 }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}

function SessionSparkline({ byDay }: { byDay: Record<string, number> }) {
  const entries = Object.entries(byDay).sort(([a], [b]) => a.localeCompare(b));
  const values  = entries.map(([, v]) => v);
  const labels  = entries.map(([d]) => d.slice(5)); // MM-DD
  const max     = Math.max(...values, 1);
  const W = 420, H = 60, n = values.length;

  const points = values.map((v, i) => {
    const x = 8 + (i / (n - 1)) * (W - 16);
    const y = H - 8 - (v / max) * (H - 16);
    return [x, y] as [number, number];
  });

  const pathD = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x},${y}`).join(' ');
  const fillD = `M${points[0][0]},${H} ${pathD.slice(1)} L${points[n-1][0]},${H}Z`;

  return (
    <div className="relative">
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full" style={{ height: '60px' }}>
        <defs>
          <linearGradient id="sg-session" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F97316" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#F97316" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={fillD} fill="url(#sg-session)" />
        <path d={pathD} fill="none" stroke="#F97316" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        {points.map(([x, y], i) => (
          <circle key={i} cx={x} cy={y} r="3" fill="#F97316" opacity={values[i] > 0 ? 1 : 0} />
        ))}
      </svg>
      <div className="flex justify-between mt-1">
        {labels.filter((_, i) => i === 0 || i === Math.floor(n/2) || i === n-1).map((l, i) => (
          <span key={i} className="text-[9px] text-slate-400">{l}</span>
        ))}
      </div>
    </div>
  );
}

// ─── Score badge ──────────────────────────────────────────────────────────────

function HealthBadge({ score }: { score: number }) {
  const color = score >= 75 ? 'text-emerald-600' : score >= 50 ? 'text-orange-500' : 'text-red-500';
  const bg    = score >= 75 ? 'bg-emerald-50 border-emerald-200' : score >= 50 ? 'bg-orange-50 border-orange-200' : 'bg-red-50 border-red-200';
  const label = score >= 75 ? 'Healthy' : score >= 50 ? 'Needs Work' : 'At Risk';
  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border ${bg}`}>
      <span className={`text-2xl font-black ${color}`}>{score}</span>
      <div>
        <p className={`text-[10px] font-bold uppercase tracking-widest ${color}`}>{label}</p>
        <p className="text-[9px] text-slate-400">Health Score</p>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const MetricsDashboard: React.FC = () => {
  const [metrics, setMetrics]   = useState<Metrics | null>(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch('/api/metrics');
      if (!res.ok) throw new Error(`${res.status}`);
      setMetrics(await res.json());
    } catch (e: any) {
      setError('Could not load metrics — make sure the local server is running.');
    } finally { setLoading(false); }
  };

  const refresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  useEffect(() => { load(); }, []);

  if (loading) return (
    <div className="flex-1 flex items-center justify-center bg-slate-50">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-7 h-7 text-orange-400 animate-spin" />
        <p className="text-sm text-slate-400">Loading metrics…</p>
      </div>
    </div>
  );

  if (error) return (
    <div className="flex-1 flex items-center justify-center bg-slate-50">
      <div className="text-center space-y-3">
        <AlertTriangle className="w-8 h-8 text-red-400 mx-auto" />
        <p className="text-sm font-semibold text-slate-600">{error}</p>
        <button onClick={load} className="px-4 py-2 text-xs font-semibold bg-orange-50 text-orange-600 border border-orange-200 rounded-xl hover:bg-orange-100 transition-all">
          Try Again
        </button>
      </div>
    </div>
  );

  if (!metrics) return null;
  const m = metrics;

  const passRateDayValues = Object.entries(m.passRateByDay)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, v]) => v.total > 0 ? Math.round((v.pass / v.total) * 100) : 0);

  const totalFlags = m.flags.pass + m.flags.fail + m.flags.bug + m.flags.slow;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar bg-slate-50">
      <div className="max-w-5xl mx-auto p-8 space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-center">
              <BarChart2 className="w-5 h-5 text-orange-500" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-800">Eval Metrics</h1>
              <p className="text-xs text-slate-400">Live health of your AI agent evaluation system</p>
            </div>
          </div>
          <button
            onClick={refresh}
            disabled={refreshing}
            className="flex items-center gap-2 px-4 py-2 text-xs font-semibold bg-white border border-slate-200 rounded-xl hover:border-orange-300 hover:bg-orange-50 transition-all"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin text-orange-500' : 'text-slate-400'}`} />
            Refresh
          </button>
        </div>

        {/* KPI strip */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {/* Health score */}
          <div className="col-span-2 md:col-span-1 bg-white border border-slate-200 rounded-2xl p-4 flex items-center gap-3">
            <HealthBadge score={m.healthScore} />
          </div>

          {[
            { icon: Activity,      label: 'Sessions',     value: m.totalSessions,  sub: 'total saved',         color: 'text-blue-500',    bg: 'bg-blue-50', border: 'border-blue-200' },
            { icon: Shield,        label: 'Eval Pass Rate',value: `${m.evalPassRate}%`, sub: `${m.totalEvalRuns} runs`, color: m.evalPassRate >= 70 ? 'text-emerald-600' : 'text-orange-500', bg: m.evalPassRate >= 70 ? 'bg-emerald-50' : 'bg-orange-50', border: m.evalPassRate >= 70 ? 'border-emerald-200' : 'border-orange-200' },
            { icon: Clock,         label: 'Avg Response', value: `${m.avgResponseMs}ms`, sub: 'across sessions', color: m.avgResponseMs < 3000 ? 'text-emerald-600' : 'text-orange-500', bg: 'bg-slate-50', border: 'border-slate-200' },
            { icon: Flame,         label: 'Flaky Tests',  value: m.flakyCount,     sub: 'inconsistent',        color: m.flakyCount > 0 ? 'text-amber-500' : 'text-slate-400', bg: 'bg-amber-50', border: 'border-amber-200' },
          ].map(({ icon: Icon, label, value, sub, color, bg, border }) => (
            <div key={label} className={`bg-white border ${border} rounded-2xl p-4`}>
              <div className="flex items-center gap-2 mb-2">
                <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center`}>
                  <Icon className={`w-3.5 h-3.5 ${color}`} />
                </div>
                <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest">{label}</span>
              </div>
              <p className={`text-2xl font-black ${color} leading-none`}>{value}</p>
              <p className="text-[10px] text-slate-400 mt-0.5">{sub}</p>
            </div>
          ))}
        </div>

        {/* Charts row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Session volume */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold text-slate-800">Session Volume</p>
                <p className="text-[10px] text-slate-400">Sessions saved per day — last 30 days</p>
              </div>
              <TrendingUp className="w-4 h-4 text-orange-400" />
            </div>
            <SessionSparkline byDay={m.sessionsByDay} />
          </div>

          {/* Eval pass rate trend */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-sm font-bold text-slate-800">Eval Pass Rate Trend</p>
                <p className="text-[10px] text-slate-400">% passing per day — last 30 days</p>
              </div>
              {m.evalPassRate >= 70
                ? <TrendingUp className="w-4 h-4 text-emerald-500" />
                : <TrendingDown className="w-4 h-4 text-red-400" />
              }
            </div>
            <div className="w-full">
              <Sparkline values={passRateDayValues} color={m.evalPassRate >= 70 ? '#22c55e' : '#f97316'} width={380} height={60} />
            </div>
            <div className="flex justify-between mt-1 text-[9px] text-slate-400">
              <span>30 days ago</span><span>Today</span>
            </div>
          </div>
        </div>

        {/* Middle row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

          {/* Flags breakdown */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <p className="text-sm font-bold text-slate-800 mb-1">Flag Breakdown</p>
            <p className="text-[10px] text-slate-400 mb-4">Across all manual chat sessions</p>
            <div className="flex items-center justify-center mb-4">
              <DonutChart pass={m.flags.pass} total={totalFlags} size={90} />
            </div>
            <div className="space-y-2">
              {[
                { key: 'pass', label: 'Pass',  color: 'bg-emerald-500' },
                { key: 'fail', label: 'Fail',  color: 'bg-red-500' },
                { key: 'bug',  label: 'Bug',   color: 'bg-amber-500' },
                { key: 'slow', label: 'Slow',  color: 'bg-blue-400' },
              ].map(({ key, label, color }) => (
                <div key={key} className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${color}`} />
                    <span className="text-xs text-slate-600">{label}</span>
                  </div>
                  <span className="text-xs font-bold text-slate-700">{m.flags[key as keyof typeof m.flags]}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Category pass rate */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <p className="text-sm font-bold text-slate-800 mb-1">By Category</p>
            <p className="text-[10px] text-slate-400 mb-4">Evidence pass/fail per failure type</p>
            {Object.keys(m.evalByCategory).length === 0
              ? <p className="text-xs text-slate-400 text-center py-6">Run evidence tests to see data</p>
              : <BarChart data={m.evalByCategory} />
            }
          </div>

          {/* Agent failure heatmap */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <p className="text-sm font-bold text-slate-800 mb-1">Agent Failure Map</p>
            <p className="text-[10px] text-slate-400 mb-4">Sessions with high bug/fail rate by agent</p>
            {Object.keys(m.agentFailures).length === 0
              ? <p className="text-xs text-slate-400 text-center py-6">No agent failure data yet</p>
              : (
                <div className="space-y-2.5">
                  {Object.entries(m.agentFailures)
                    .sort(([, a], [, b]) => b - a)
                    .map(([agent, count]) => (
                      <div key={agent} className="flex items-center gap-2">
                        <div className="flex-1">
                          <div className="flex justify-between mb-1">
                            <span className="text-[11px] font-semibold text-slate-700 capitalize">{agent}</span>
                            <span className="text-[10px] text-red-500 font-bold">{count} sessions</span>
                          </div>
                          <div className="h-1.5 bg-red-100 rounded-full overflow-hidden">
                            <div className="h-full bg-red-400 rounded-full transition-all duration-700"
                              style={{ width: `${Math.min(100, count * 20)}%` }} />
                          </div>
                        </div>
                      </div>
                    ))}
                </div>
              )
            }
          </div>
        </div>

        {/* Bottom: top failing + flaky */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">

          {/* Top failing scenarios */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5">
            <div className="flex items-center gap-2 mb-4">
              <XCircle className="w-4 h-4 text-red-500" />
              <p className="text-sm font-bold text-slate-800">Top Failing Scenarios</p>
            </div>
            {m.topFailing.length === 0
              ? <p className="text-xs text-slate-400 text-center py-6">No failing scenarios — run the evidence suite</p>
              : (
                <div className="space-y-3">
                  {m.topFailing.map((f, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-xl">
                      <span className="text-[10px] font-black text-red-400 mt-0.5 shrink-0">#{i+1}</span>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-xs font-semibold text-slate-700 leading-snug">{f.name}</p>
                          {f.flaky && (
                            <span className="text-[9px] font-bold px-1.5 py-0.5 bg-amber-100 text-amber-600 border border-amber-200 rounded-md">
                              FLAKY
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-red-500 mt-0.5 leading-snug">{f.reason}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )
            }
          </div>

          {/* Eval health summary */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <div className="flex items-center gap-2 mb-4">
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
              <p className="text-sm font-bold text-slate-800">Eval Health Summary</p>
            </div>
            {[
              {
                label: 'Evidence Pass Rate',
                value: `${m.evalPassRate}%`,
                good: m.evalPassRate >= 70,
                desc: m.evalPassRate >= 70 ? 'Agent passing most known failure scenarios' : 'Agent failing too many known failure scenarios',
              },
              {
                label: 'Avg Bot Response Time',
                value: `${m.avgResponseMs}ms`,
                good: m.avgResponseMs < 3000 || m.avgResponseMs === 0,
                desc: m.avgResponseMs === 0 ? 'No response time data' : m.avgResponseMs < 3000 ? 'Response times are acceptable' : 'Response times are slow — check bot performance',
              },
              {
                label: 'Flaky Test Count',
                value: String(m.flakyCount),
                good: m.flakyCount === 0,
                desc: m.flakyCount === 0 ? 'All tests produce consistent results' : `${m.flakyCount} test(s) produce inconsistent pass/fail results`,
              },
              {
                label: 'Bug/Fail Flag Ratio',
                value: totalFlags > 0 ? `${Math.round(((m.flags.fail + m.flags.bug) / totalFlags) * 100)}%` : '0%',
                good: totalFlags === 0 || ((m.flags.fail + m.flags.bug) / totalFlags) < 0.3,
                desc: totalFlags === 0 ? 'No flags recorded yet' : 'Ratio of negative flags in manual tests',
              },
            ].map(({ label, value, good, desc }) => (
              <div key={label} className="flex items-start gap-3">
                {good
                  ? <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                  : <XCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                }
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">{label}</span>
                    <span className={`text-xs font-black ${good ? 'text-emerald-600' : 'text-red-500'}`}>{value}</span>
                  </div>
                  <p className="text-[10px] text-slate-400 leading-snug mt-0.5">{desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
};

export default MetricsDashboard;
