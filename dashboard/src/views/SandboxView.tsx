import React, { useState, useEffect } from 'react';
import { fetchSandboxScenarios, createSandboxScenario, deleteSandboxScenario, type CustomScenario } from '../api';
import { FlaskConical, Plus, Trash2, Play } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';

const SandboxView: React.FC<{ onStartScenario: (scenarioCtx: string) => void }> = ({ onStartScenario }) => {
  const [scenarios, setScenarios] = useState<CustomScenario[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [scenarioContext, setScenarioContext] = useState('');

  const loadScenarios = async () => {
    try {
      const data = await fetchSandboxScenarios();
      setScenarios(data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadScenarios(); }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !description || !scenarioContext) return;
    try {
      await createSandboxScenario({ title, description, scenarioContext });
      setTitle(''); setDescription(''); setScenarioContext('');
      setShowForm(false);
      loadScenarios();
    } catch (err) { console.error('Failed to create scenario', err); }
  };

  const handleDelete = async (id: string) => {
    try { await deleteSandboxScenario(id); loadScenarios(); }
    catch (err) { console.error('Failed to delete scenario', err); }
  };

  return (
    <div className="flex-1 overflow-y-auto custom-scrollbar p-8 bg-slate-50">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-emerald-50 flex items-center justify-center border border-emerald-200">
                <FlaskConical className="w-5 h-5 text-emerald-600" />
              </div>
              <div>
                <h1 className="text-xl font-bold text-slate-800">Questions Lab</h1>
                <p className="text-xs text-slate-400">Custom edge-case test scenarios</p>
              </div>
            </div>
            <p className="text-sm text-slate-500 max-w-2xl leading-relaxed">
              Create, store, and manage custom edge-case test questions and specific context scenarios. Launch these directly into the Arena.
            </p>
          </div>
          <button
            onClick={() => setShowForm(!showForm)}
            className={`flex items-center gap-2 px-5 py-2.5 rounded-xl border text-sm font-semibold transition-all ${
              showForm
                ? 'bg-slate-100 border-slate-300 text-slate-600 hover:bg-slate-200'
                : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'
            }`}
          >
            {showForm ? 'Cancel' : <><Plus className="w-4 h-4" /> New Test Case</>}
          </button>
        </header>

        {/* Create form */}
        <AnimatePresence>
          {showForm && (
            <motion.form
              initial={{ opacity: 0, y: -12, height: 0 }}
              animate={{ opacity: 1, y: 0, height: 'auto' }}
              exit={{ opacity: 0, y: -12, height: 0 }}
              onSubmit={handleSubmit}
              className="bg-white border border-slate-200 rounded-2xl p-6 shadow-card space-y-4 overflow-hidden"
            >
              <h3 className="text-sm font-semibold text-slate-700">New Test Case</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Test Case Title</label>
                  <input
                    placeholder="e.g. Broken RFID Scenario"
                    value={title} onChange={(e) => setTitle(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 placeholder:text-slate-400 transition-all"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Description</label>
                  <input
                    placeholder="Short summary of the intent"
                    value={description} onChange={(e) => setDescription(e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 placeholder:text-slate-400 transition-all"
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Initial Question / Scenario Context</label>
                <textarea
                  placeholder="Example: I'm trying to use my RFID card at Jaipur Pink Square Mall but the charger says 'Auth Failed'. I want to know why."
                  value={scenarioContext} onChange={(e) => setScenarioContext(e.target.value)}
                  className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-2.5 text-sm text-slate-700 focus:outline-none focus:ring-2 focus:ring-emerald-300 focus:border-emerald-400 placeholder:text-slate-400 transition-all min-h-[80px] resize-none"
                />
              </div>
              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={!title || !description || !scenarioContext}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold disabled:opacity-40 transition-all shadow-sm"
                >
                  Save Scenario
                </button>
              </div>
            </motion.form>
          )}
        </AnimatePresence>

        {/* Scenarios */}
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="flex items-center gap-2 text-emerald-600">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '0ms' }} />
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '150ms' }} />
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-bounce" style={{ animationDelay: '300ms' }} />
            </div>
          </div>
        ) : scenarios.length === 0 ? (
          <div className="bg-white border border-dashed border-slate-300 rounded-2xl p-20 text-center">
            <FlaskConical className="w-12 h-12 text-slate-300 mx-auto mb-3" />
            <h3 className="text-base font-semibold text-slate-500">No Custom Scenarios</h3>
            <p className="text-sm text-slate-400 mt-1">Create a test case to build your lab.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {scenarios.map(sc => (
              <div key={sc.id} className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between hover:border-emerald-200 hover:shadow-card-md transition-all group shadow-card">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <h3 className="font-bold text-slate-800 text-base leading-tight">{sc.title}</h3>
                    <button
                      onClick={() => handleDelete(sc.id)}
                      className="text-slate-400 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-all p-1 rounded-lg hover:bg-red-50"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <p className="text-sm text-slate-500 mb-4">{sc.description}</p>
                  <div className="bg-slate-50 border border-slate-200 rounded-xl p-3.5 mb-5">
                    <p className="text-xs text-slate-500 line-clamp-4 italic leading-relaxed">
                      "{sc.scenarioContext}"
                    </p>
                  </div>
                </div>
                <button
                  onClick={() => onStartScenario(sc.scenarioContext)}
                  className="w-full py-2.5 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 rounded-xl text-xs font-semibold flex items-center justify-center gap-2 transition-all border border-emerald-200 hover:border-emerald-300"
                >
                  <Play className="w-3 h-3" /> Run in Arena
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default SandboxView;
