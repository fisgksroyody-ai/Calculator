/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as React from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
  errorInfo: React.ErrorInfo | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
    errorInfo: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error, errorInfo: null };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[CalculatorVault Global Failsafe] Uncaught runtime exception:", error, errorInfo);
    this.setState({ errorInfo });
  }

  private handleReset = () => {
    try {
      localStorage.clear();
      sessionStorage.clear();
      window.location.reload();
    } catch {
      window.location.reload();
    }
  };

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-zinc-950 text-gray-100 flex flex-col justify-center items-center p-6 text-center select-none antialiased animate-fadeIn">
          <div className="w-16 h-16 bg-amber-950/40 rounded-full flex items-center justify-center border border-amber-500/30 mb-6 animate-pulse">
            <AlertTriangle className="text-amber-500 w-9 h-9" />
          </div>
          <h1 className="text-2xl font-bold font-sans tracking-tight text-white mb-2">
            EMERGENCY RECOVERY RUNTIME
          </h1>
          <p className="text-gray-400 max-w-sm text-sm mb-6 font-sans">
            The application encountered an unexpected runtime error. To prevent data corruption, active memory components have been safely isolated.
          </p>
          
          <div className="w-full max-w-lg bg-zinc-900 border border-zinc-800 rounded-lg p-4 mb-6 text-left font-mono text-xs overflow-auto max-h-60 shadow-inner">
            <p className="text-red-400 font-bold mb-1">Error: {this.state.error?.message || "Unknown error"}</p>
            {this.state.error?.stack && (
              <pre className="text-gray-500 whitespace-pre-wrap leading-relaxed mt-2" style={{ fontSize: '10px' }}>
                {this.state.error.stack}
              </pre>
            )}
            {this.state.errorInfo?.componentStack && (
              <pre className="text-gray-600 whitespace-pre-wrap leading-relaxed mt-2" style={{ fontSize: '10px' }}>
                Component Trace:
                {this.state.errorInfo.componentStack}
              </pre>
            )}
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <button
              onClick={() => window.location.reload()}
              className="flex items-center justify-center gap-2 px-5 py-2.5 bg-zinc-800 hover:bg-zinc-700 active:bg-zinc-600 rounded-lg text-sm font-medium transition-all cursor-pointer border border-zinc-700/50 text-gray-200"
            >
              <RefreshCw className="w-4 h-4 text-zinc-400" />
              Direct Reload
            </button>
            <button
              onClick={this.handleReset}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 active:bg-amber-700 rounded-lg text-sm font-medium text-white transition-all cursor-pointer shadow-lg shadow-amber-900/20"
            >
              Clear Cache & Reset Application
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
