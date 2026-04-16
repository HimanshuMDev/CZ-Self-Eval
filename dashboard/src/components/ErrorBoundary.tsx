import { Component, type ErrorInfo, type ReactNode } from 'react';
import { AlertCircle, RefreshCcw } from 'lucide-react';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('[ErrorBoundary] Uncaught error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="h-screen w-full flex items-center justify-center bg-background p-6">
          <div className="max-w-md w-full glass p-10 rounded-[40px] border-red-500/20 text-center space-y-6 glow">
            <div className="w-20 h-20 bg-red-500/10 rounded-3xl flex items-center justify-center mx-auto border border-red-500/20">
              <AlertCircle className="w-10 h-10 text-red-500" />
            </div>
            
            <div className="space-y-2">
              <h2 className="text-xl font-black uppercase tracking-widest text-white">Interface Fault</h2>
              <p className="text-sm text-gray-400 leading-relaxed">
                A runtime exception occurred in the dashboard engine. Safety protocols have isolated the error.
              </p>
            </div>

            <div className="p-4 bg-black/40 rounded-xl border border-white/5 text-left">
              <p className="text-[10px] font-bold text-red-400 uppercase tracking-widest mb-1">System Log</p>
              <p className="text-xs font-mono text-gray-500 line-clamp-3">
                {this.state.error?.message || 'Unknown execution failure'}
              </p>
            </div>

            <button
              onClick={() => window.location.reload()}
              className="w-full py-4 bg-primary hover:bg-primary/90 rounded-2xl flex items-center justify-center gap-3 font-black uppercase text-sm tracking-widest transition-all glow"
            >
              <RefreshCcw className="w-5 h-5" />
              Reset Engine
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
