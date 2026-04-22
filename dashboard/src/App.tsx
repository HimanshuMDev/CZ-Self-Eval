import { DashboardProvider, useDashboard } from './store/DashboardContext';
import NavigationRail from './components/NavigationRail';
import ArenaView from './views/ArenaView';
import SandboxView from './views/SandboxView';
import ManualChatView from './views/ManualChatView';
import ChatHistoryView from './views/ChatHistoryView';
import EvalReviewView from './views/EvalReviewView';
import EvalEvidenceView from './views/EvalEvidenceView';
import EvalScoreView from './views/EvalScoreView';
import ErrorBoundary from './components/ErrorBoundary';

import { useRef } from 'react';

const VIEW_LABELS: Record<string, { title: string; sub: string; emoji: string }> = {
  arena:          { title: 'Dual-Agent Arena',    sub: 'Simulate personas vs. your AI agent',   emoji: '⚡' },
  chat:           { title: 'Live Chat',            sub: 'Real-time WhatsApp simulation',          emoji: '💬' },
  'chat-history': { title: 'Chat History',         sub: 'Review & compare saved sessions',        emoji: '📋' },
  'eval-review':  { title: 'Chat Review',          sub: 'Flagged replies & comments across sessions', emoji: '🔍' },
  sandbox:        { title: 'Questions Lab',        sub: 'Custom edge-case scenarios',             emoji: '🧪' },
  'eval-evidence':{ title: 'Eval Evidence',         sub: 'All agent datasets · grouped by agent', emoji: '🗂️' },
  'eval-score':   { title: 'CZ Agent Eval Score',   sub: 'Multi-judge composite score · CI-gated', emoji: '📈' },
};

const ViewSwitcher = () => {
  const { currentView, setView } = useDashboard();
  const arenaRef = useRef<{ handleCustomLaunch: (scenarioCtx: string) => void } | null>(null);

  const handleStartScenario = (scenarioCtx: string) => {
    setView('arena');
    setTimeout(() => { arenaRef.current?.handleCustomLaunch(scenarioCtx); }, 100);
  };

  switch (currentView) {
    case 'arena':        return <ArenaView ref={arenaRef} />;
    case 'chat':         return <ManualChatView />;
    case 'chat-history': return <ChatHistoryView />;
    case 'eval-review':  return <EvalReviewView />;
    case 'sandbox':      return <SandboxView onStartScenario={handleStartScenario} />;
    case 'eval-evidence': return <EvalEvidenceView />;
    case 'eval-score':   return <EvalScoreView />;
    default:             return <ArenaView ref={arenaRef} />;
  }
};

const AppContent = () => {
  const { currentView } = useDashboard();
  const meta = VIEW_LABELS[currentView] ?? VIEW_LABELS['arena'];

  return (
    <div
      className="h-screen w-full text-slate-800 flex overflow-hidden font-sans selection:bg-orange-100"
      style={{ background: '#F7F8FB' }}
    >
      <NavigationRail />

      <main className="flex-1 flex flex-col overflow-hidden">
        {/* Top header */}
        <header
          className="h-[60px] shrink-0 flex items-center px-7 justify-between"
          style={{
            background: '#ffffff',
            borderBottom: '1px solid #F0F1F5',
            boxShadow: '0 1px 8px rgba(0,0,0,0.04)',
          }}
        >
          {/* Left: view title */}
          <div className="flex items-center gap-3">
            {/* Orange accent bar */}
            <div
              className="w-1 h-8 rounded-full shrink-0"
              style={{ background: 'linear-gradient(180deg, #F97316, #fb923c)' }}
            />
            <div>
              <h1
                className="text-[14px] font-black leading-tight"
                style={{ color: '#0f172a', letterSpacing: '-0.02em' }}
              >
                {meta.title}
              </h1>
              <p className="text-[11px] leading-tight mt-0.5" style={{ color: '#94a3b8' }}>
                {meta.sub}
              </p>
            </div>
          </div>

          {/* Right: status + user */}
          <div className="flex items-center gap-4">
            {/* Live status pill */}
            <div
              className="flex items-center gap-2 px-3 py-1.5 rounded-full"
              style={{
                background: 'rgba(249,115,22,0.07)',
                border: '1px solid rgba(249,115,22,0.18)',
              }}
            >
              <span className="relative flex h-2 w-2">
                <span
                  className="animate-ping absolute inline-flex h-full w-full rounded-full opacity-60"
                  style={{ background: '#F97316' }}
                />
                <span
                  className="relative inline-flex rounded-full h-2 w-2"
                  style={{ background: '#F97316' }}
                />
              </span>
              <span
                className="text-[11px] font-bold tracking-wide"
                style={{ color: '#ea580c' }}
              >
                Live
              </span>
            </div>

            {/* Separator */}
            <div className="w-px h-6 rounded-full" style={{ background: '#EEF0F5' }} />

            {/* User */}
            <div className="flex items-center gap-2.5 cursor-pointer group">
              <div className="text-right">
                <p
                  className="text-[12px] font-bold leading-tight group-hover:text-orange-600 transition-colors"
                  style={{ color: '#1e293b' }}
                >
                  Admin
                </p>
                <p className="text-[10px] leading-tight" style={{ color: '#94a3b8' }}>Superuser</p>
              </div>
              <div
                className="w-9 h-9 rounded-2xl flex items-center justify-center text-white text-[13px] font-black group-hover:scale-105 transition-transform"
                style={{
                  background: 'linear-gradient(135deg, #F97316 0%, #fb923c 100%)',
                  boxShadow: '0 3px 12px rgba(249,115,22,0.38)',
                  letterSpacing: '-0.02em',
                }}
              >
                A
              </div>
            </div>
          </div>
        </header>

        <ViewSwitcher />
      </main>
    </div>
  );
};

function App() {
  return (
    <DashboardProvider>
      <ErrorBoundary>
        <AppContent />
      </ErrorBoundary>
    </DashboardProvider>
  );
}

export default App;
