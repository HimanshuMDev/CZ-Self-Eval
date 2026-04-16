import React, { useState, useEffect } from 'react';
import { fetchEvidence, streamBatchSimulation, type Persona, type Goal } from '../api';
import { Bug, ArrowRight, ShieldAlert, Cpu, Play, CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import { useDashboard } from '../store/DashboardContext';

const EvidenceView: React.FC = () => {
  const [evidence, setEvidence] = useState<{ persona: Persona; goal: Goal }[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; personaName: string; status: string } | null>(null);
  const [batchSummary, setBatchSummary] = useState<{ passed: number; total: number; results: any[] } | null>(null);
  const { setView: setCurrentView } = useDashboard();

  useEffect(() => {
    fetchEvidence().then(setEvidence).catch(console.error);
  }, []);

  const handleRunBatch = () => {
    if (isBatchRunning) return;
    setIsBatchRunning(true);
    setBatchSummary(null);
    setBatchProgress(null);

    const eventSource = streamBatchSimulation(
      (type, payload) => {
        if (type === 'batch-progress') {
          setBatchProgress({ current: payload.current, total: payload.total, personaName: payload.personaName, status: 'Initializing...' });
        } else if (type === 'status') {
          setBatchProgress(prev => prev ? { ...prev, status: payload.message } : null);
        } else if (type === 'batch-complete') {
          setBatchSummary({ passed: payload.passed, total: payload.total, results: payload.results });
          setIsBatchRunning(false);
          setBatchProgress(null);
          eventSource.close();
        }
      },
      (err) => {
        console.error('Batch failed', err);
        setIsBatchRunning(false);
        setBatchProgress(null);
        eventSource.close();
      }
    );
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-8 bg-slate-50">
      <div className="max-w-5xl mx-auto space-y-8">
        {/* Header */}
        <header className="space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-4">
              <div className="w-11 h-11 rounded-xl bg-red-50 flex items-center justify-center border border-red-200">
                <Bug className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Evidence Library</h1>
                <p className="text-xs text-slate-400">Known failing traces &amp; edge cases from LangSmith</p>
              </div>
            </div>
            {!isBatchRunning && (
              <button
                onClick={handleRunBatch}
                className="flex items-center gap-2 px-5 py-2.5 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-all"
              >
                <Play className="w-4 h-4 text-red-500" />
                <span className="text-xs font-semibold text-red-600">Run Full Regression Suite</span>
              </button>
            )}
          </div>
          <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
            These scenarios are sourced directly from LangSmith failing traces. They represent known edge cases where earlier agent versions produced hallucinations, got stuck in loops, or failed to route correctly.
          </p>
        </header>

        {/* Batch Progress */}
        {isBatchRunning && batchProgress && (
          <div className="bg-white border border-red-200 rounded-2xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-bold text-red-600">Regression Suite Running</h3>
                <p className="text-xs text-slate-500 mt-0.5">
                  Scenario {batchProgress.current} of {batchProgress.total}: <span className="font-semibold text-slate-700">{batchProgress.personaName}</span>
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Loader2 className="w-4 h-4 text-red-500 animate-spin" />
                <span className="text-sm font-bold text-slate-700">{Math.round((batchProgress.current / batchProgress.total) * 100)}%</span>
              </div>
            </div>
            <div className="w-full h-2 bg-red-100 rounded-full overflow-hidden">
              <div className="h-full bg-red-500 transition-all duration-500 ease-out rounded-full"
                style={{ width: `${(batchProgress.current / batchProgress.total) * 100}%` }} />
            </div>
            <p className="mt-3 text-[10px] text-slate-400 uppercase tracking-widest animate-pulse">{batchProgress.status}</p>
          </div>
        )}

        {/* Batch Summary */}
        {batchSummary && (
          <div className="bg-white border border-emerald-200 rounded-2xl p-6 shadow-card">
            <div className="flex items-center justify-between mb-5">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-emerald-50 flex items-center justify-center border border-emerald-200">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-slate-800">Suite Complete</h3>
                  <p className="text-xs text-slate-400">{batchSummary.passed} passed out of {batchSummary.total} scenarios</p>
                </div>
              </div>
              <button onClick={() => setBatchSummary(null)} className="text-xs font-semibold text-slate-400 hover:text-slate-600 transition-colors">
                Dismiss
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {batchSummary.results.map((res, i) => (
                <div key={i} className={`p-3 rounded-xl border flex flex-col items-center gap-1.5 ${res.success ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                  {res.success ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <XCircle className="w-4 h-4 text-red-500" />}
                  <span className="text-[10px] font-semibold text-slate-600">Score: {res.score}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Evidence list */}
        <div className="grid gap-4">
          {Array.isArray(evidence) && evidence.map((item, index) => (
            <div key={item?.persona?.id || index} className="bg-white border border-slate-200 rounded-2xl p-6 hover:border-red-200 hover:shadow-card-md transition-all group shadow-card">
              <div className="flex items-start justify-between gap-6">
                <div className="flex-1 space-y-4">
                  <div className="flex items-center gap-2.5">
                    <span className="text-[10px] font-semibold px-2 py-1 bg-slate-100 text-slate-500 rounded-lg">
                      Trace #{index + 1}
                    </span>
                    <h3 className="text-base font-bold text-slate-800 group-hover:text-red-600 transition-colors">
                      {item?.persona?.name || 'Unknown Scenario'}
                    </h3>
                  </div>
                  <p className="text-sm text-slate-500">{item?.persona?.description || 'No description available.'}</p>
                  <div className="grid grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                        <ShieldAlert className="w-3.5 h-3.5" /> Behavior Rules
                      </div>
                      <ul className="space-y-1.5">
                        {Array.isArray((item?.persona as any)?.behaviorRules) && (item.persona as any).behaviorRules.map((rule: string, i: number) => (
                          <li key={i} className="text-sm text-slate-600 flex gap-2">
                            <span className="text-red-400 mt-0.5 shrink-0">•</span>
                            <span className="leading-snug">{rule}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 uppercase tracking-widest">
                        <Cpu className="w-3.5 h-3.5" /> Success Condition
                      </div>
                      <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-sm text-slate-600 leading-relaxed">
                        {(item?.goal as any)?.successCondition || 'N/A'}
                      </div>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setCurrentView('arena')}
                  className="shrink-0 w-12 h-12 rounded-xl bg-slate-50 hover:bg-red-50 border border-slate-200 hover:border-red-200 flex items-center justify-center transition-all"
                  title="Test Scenario in Arena"
                >
                  <ArrowRight className="w-5 h-5 text-slate-400 group-hover:text-red-500 transition-colors" />
                </button>
              </div>
            </div>
          ))}

          {evidence.length === 0 && (
            <div className="py-20 text-center border border-dashed border-slate-300 rounded-2xl bg-white">
              <Bug className="w-10 h-10 text-slate-300 mx-auto mb-3" />
              <p className="text-sm text-slate-400">No evidence scenarios found in the registry.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default EvidenceView;
