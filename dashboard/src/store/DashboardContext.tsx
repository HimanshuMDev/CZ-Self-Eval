import { createContext, useContext, useState, type ReactNode } from 'react';

type ViewType = 'arena' | 'chat' | 'evidence' | 'history' | 'sandbox' | 'chat-history' | 'eval-review' | 'metrics' | 'golden' | 'eval-score';

/** A single question in the Questions Lab pool */
export interface LabQuestion {
  text: string;
  source: 'history' | 'bot' | 'custom' | 'library';
  batchId?: string;
}

const LS_KEY = 'cz_selected_questions';

function loadFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveToStorage(qs: string[]) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(qs)); } catch {}
}

interface DashboardContextType {
  currentView: ViewType;
  setView: (view: ViewType) => void;
  isStreaming: boolean;
  setIsStreaming: (val: boolean) => void;
  lastSimResult: any;
  setLastSimResult: (res: any) => void;
  // Selected questions — persisted to localStorage
  pinnedQuestions: string[];
  setPinnedQuestions: (qs: string[]) => void;
  // Persisted lab question pool — survives navigation between views
  labQuestions: LabQuestion[];
  setLabQuestions: (qs: LabQuestion[]) => void;
  latestBatchId: string | null;
  setLatestBatchId: (id: string | null) => void;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export const DashboardProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentView, setView] = useState<ViewType>('arena');
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastSimResult, setLastSimResult] = useState(null);
  // Initialise from localStorage so selections survive page refresh
  const [pinnedQuestions, setPinnedQuestionsState] = useState<string[]>(loadFromStorage);
  const [labQuestions, setLabQuestions] = useState<LabQuestion[]>([]);
  const [latestBatchId, setLatestBatchId] = useState<string | null>(null);

  // Wrap setter so every change is also persisted
  const setPinnedQuestions = (qs: string[]) => {
    setPinnedQuestionsState(qs);
    saveToStorage(qs);
  };

  return (
    <DashboardContext.Provider value={{
      currentView,
      setView,
      isStreaming,
      setIsStreaming,
      lastSimResult,
      setLastSimResult,
      pinnedQuestions,
      setPinnedQuestions,
      labQuestions,
      setLabQuestions,
      latestBatchId,
      setLatestBatchId,
    }}>
      {children}
    </DashboardContext.Provider>
  );
};

export const useDashboard = () => {
  const context = useContext(DashboardContext);
  if (!context) throw new Error('useDashboard must be used within DashboardProvider');
  return context;
};
