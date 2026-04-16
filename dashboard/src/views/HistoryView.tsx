import React, { useState, useEffect } from 'react';
import { fetchHistory, addComment, saveReport } from '../api';
import { History, CheckCircle2, AlertCircle, Hash, ChevronRight, ChevronDown, Check, MessageSquare, FileText, User } from 'lucide-react';

const HistoryView: React.FC = () => {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commentText, setCommentText] = useState<string>('');

  const loadHistory = () => {
    fetchHistory()
      .then(data => { setHistory(Array.isArray(data) ? data : []); setLoading(false); })
      .catch((err) => { console.error(err); setLoading(false); });
  };

  useEffect(() => { loadHistory(); }, []);

  const handleAddComment = async (simulationId: string) => {
    if (!commentText.trim()) return;
    try {
      await addComment(simulationId, commentText);
      setCommentText('');
      loadHistory();
    } catch (err) { console.error('Failed to add comment', err); }
  };

  const generateAndSaveReport = async (record: any) => {
    if (!record) return;
    const transcriptText = Array.isArray(record.transcript)
      ? record.transcript.map((t: any) => {
          const role = t?.role === 'agent' ? 'CZ SUPPORT' : 'CUSTOMER';
          let text = `${role}: ${t?.content || '[Empty Message]'}`;
          if (t?.metadata?.thought) text += `\n[INTERNAL REASONING]: ${t.metadata.thought}`;
          return text;
        }).join('\n\n')
      : 'No transcript available for this session.';

    const fullText = `# SIMULATION REPORT\n**ID:** ${record.simulationId || 'N/A'}\n**Persona:** ${record.persona?.name || 'Unknown'}\n**Goal:** ${record.goal?.objective || 'Unknown'}\n**Result:** ${record.success ? 'PASSED ✅' : 'FAILED ❌'}\n**Score:** ${record.score ?? 0}%\n**Turns:** ${record.totalTurns ?? 0}\n\n---\n\n## CONVERSATION TRANSCRIPT\n\n${transcriptText}\n\n---\n\n## JUDGE REASONING\n${record.judgeReasoning || 'No reasoning provided.'}\n\n---\n\n## COMMENTS\n${record.comments?.map((c: any) => `* **${new Date(c.timestamp).toLocaleString()}**: ${c.text}`).join('\n') || 'No comments yet.'}`.trim();

    try {
      await saveReport(record.simulationId, fullText);
      navigator.clipboard.writeText(fullText);
      setCopiedId(record.simulationId);
      loadHistory();
      setTimeout(() => setCopiedId(null), 2000);
    } catch (err) { console.error('Failed to save or copy text:', err); }
  };

  const passRate = history.length > 0 ? Math.round((history.filter(h => h.success).length / history.length) * 100) : 0;

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-8 bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-orange-50 flex items-center justify-center border border-orange-200">
                <History className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Session History</h1>
                <p className="text-xs text-slate-400">Permanent record of evaluation trajectory</p>
              </div>
            </div>
            <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
              Review past simulation results, judicial scores, and performance metrics over time.
            </p>
          </div>
          <div className="hidden md:flex gap-3">
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex flex-col items-center shadow-card min-w-[80px]">
              <span className="text-2xl font-black text-slate-800">{history.length}</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">Total</span>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl px-5 py-4 flex flex-col items-center shadow-card min-w-[80px]">
              <span className={`text-2xl font-black ${passRate >= 80 ? 'text-emerald-600' : passRate >= 50 ? 'text-amber-600' : 'text-red-600'}`}>{passRate}%</span>
              <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-widest mt-0.5">Pass Rate</span>
            </div>
          </div>
        </header>

        {loading ? (
          <div className="flex justify-center py-20">
            <div className="flex items-center gap-2 text-primary">
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-primary animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : history.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-20 text-center">
            <History className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-500">No history found</h3>
            <p className="text-sm text-slate-400 mt-1">Run a duel in the Arena view to populate this log.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {history.map((record, index) => (
              <div key={record.simulationId || index} className="space-y-0">
                <div
                  onClick={() => setExpandedId(expandedId === record.simulationId ? null : record.simulationId)}
                  className="group bg-white border border-slate-200 rounded-2xl p-5 hover:border-orange-200 hover:shadow-card-md transition-all flex items-center gap-5 cursor-pointer shadow-card"
                  style={{ borderBottomLeftRadius: expandedId === record.simulationId ? '0' : undefined, borderBottomRightRadius: expandedId === record.simulationId ? '0' : undefined }}
                >
                  {/* Status indicator */}
                  <div className={`shrink-0 w-12 h-12 rounded-xl flex items-center justify-center border ${
                    record.success ? 'bg-emerald-50 border-emerald-200 text-emerald-600' : 'bg-red-50 border-red-200 text-red-500'
                  }`}>
                    {record.success ? <CheckCircle2 className="w-5 h-5" /> : <AlertCircle className="w-5 h-5" />}
                  </div>

                  {/* Main details */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2.5 mb-1">
                      <span className="text-[10px] font-mono text-slate-400 bg-slate-100 px-2 py-0.5 rounded flex items-center gap-1">
                        <Hash className="w-2.5 h-2.5" />{record.simulationId?.split('_').pop() || '000'}
                      </span>
                      {record.agentVersion && (
                        <span className="text-[10px] font-semibold text-primary bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                          v{record.agentVersion}
                        </span>
                      )}
                      <h3 className="text-sm font-semibold text-slate-700 truncate">{record.persona?.name || 'Unknown Persona'}</h3>
                      {record.comments?.length > 0 && (
                        <span className="flex items-center gap-1 text-[10px] font-semibold text-primary bg-orange-50 px-2 py-0.5 rounded-full border border-orange-200">
                          <MessageSquare className="w-2.5 h-2.5" /> {record.comments.length}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate">{record.goal?.objective}</p>
                  </div>

                  {/* Score & Turns */}
                  <div className="flex items-center gap-6 px-5 border-x border-slate-100">
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Score</span>
                      <span className={`text-lg font-black ${record.score >= 80 ? 'text-emerald-600' : record.score >= 50 ? 'text-amber-600' : 'text-red-500'}`}>
                        {record.score}%
                      </span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[10px] font-semibold text-slate-400 uppercase tracking-wider mb-1">Turns</span>
                      <span className="text-lg font-black text-slate-700">{record.totalTurns}</span>
                    </div>
                  </div>

                  {/* Reasoning preview */}
                  <div className="w-56 shrink-0 px-2 hidden xl:block">
                    <p className="text-xs text-slate-400 line-clamp-2 italic">"{record.judgeReasoning}"</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={(e) => { e.stopPropagation(); generateAndSaveReport(record); }}
                      className={`shrink-0 w-9 h-9 rounded-xl flex items-center justify-center transition-all border ${
                        copiedId === record.simulationId
                          ? 'bg-emerald-50 border-emerald-200 text-emerald-600'
                          : 'bg-slate-50 border-slate-200 text-slate-400 hover:bg-orange-50 hover:border-orange-200 hover:text-primary'
                      }`}
                      title="Generate Clean MD Report"
                    >
                      {copiedId === record.simulationId ? <Check className="w-3.5 h-3.5" /> : <FileText className="w-3.5 h-3.5" />}
                    </button>
                    <div className="shrink-0 w-9 h-9 rounded-xl flex items-center justify-center bg-slate-50 border border-slate-200 group-hover:bg-orange-50 group-hover:border-orange-200 text-slate-400 group-hover:text-primary transition-all">
                      {expandedId === record.simulationId ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                    </div>
                  </div>
                </div>

                {/* Expanded details */}
                {expandedId === record.simulationId && (
                  <div className="bg-slate-50 border border-slate-200 border-t-0 rounded-b-2xl p-5 space-y-5">
                    <div>
                      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 mb-2">Judge Full Reasoning</h4>
                      <p className="text-sm text-slate-600 leading-relaxed bg-white p-4 rounded-xl border border-slate-200">
                        {record.judgeReasoning}
                      </p>
                    </div>
                    <div className="space-y-3">
                      <h4 className="text-[10px] font-semibold uppercase tracking-widest text-slate-500 flex items-center gap-2">
                        <MessageSquare className="w-3.5 h-3.5" /> Evaluator Comments
                      </h4>
                      {record.comments && record.comments.length > 0 ? (
                        <div className="space-y-2">
                          {record.comments.map((comment: any, i: number) => (
                            <div key={i} className="bg-white border border-slate-200 p-3 rounded-xl flex items-start gap-2.5">
                              <User className="w-3.5 h-3.5 text-primary mt-0.5 shrink-0" />
                              <div>
                                <p className="text-sm text-slate-700">{comment.text}</p>
                                <span className="text-[10px] text-slate-400">{new Date(comment.timestamp).toLocaleString()}</span>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-sm text-slate-400 italic">No comments yet.</p>
                      )}
                      <div className="flex gap-2">
                        <input
                          type="text" value={commentText}
                          onChange={(e) => setCommentText(e.target.value)}
                          placeholder="Add a comment to this run..."
                          className="flex-1 bg-white border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary placeholder:text-slate-400 transition-all"
                          onKeyDown={(e) => { if (e.key === 'Enter') handleAddComment(record.simulationId); }}
                        />
                        <button
                          onClick={() => handleAddComment(record.simulationId)}
                          disabled={!commentText.trim()}
                          className="px-4 py-2.5 bg-primary hover:bg-primary-dark text-white rounded-xl text-sm font-semibold transition-all disabled:opacity-40 shadow-orange"
                        >
                          Send
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default HistoryView;
