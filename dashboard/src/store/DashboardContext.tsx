import { createContext, useContext, useState, type ReactNode } from 'react';

type ViewType = 'arena' | 'chat' | 'evidence' | 'history' | 'sandbox' | 'chat-history' | 'eval-review';

interface DashboardContextType {
  currentView: ViewType;
  setView: (view: ViewType) => void;
  isStreaming: boolean;
  setIsStreaming: (val: boolean) => void;
  lastSimResult: any;
  setLastSimResult: (res: any) => void;
}

const DashboardContext = createContext<DashboardContextType | undefined>(undefined);

export const DashboardProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentView, setView] = useState<ViewType>('arena');
  const [isStreaming, setIsStreaming] = useState(false);
  const [lastSimResult, setLastSimResult] = useState(null);

  return (
    <DashboardContext.Provider value={{ 
      currentView, 
      setView, 
      isStreaming, 
      setIsStreaming,
      lastSimResult,
      setLastSimResult
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
