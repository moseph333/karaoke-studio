import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw, ChevronDown, ChevronUp, Bug } from 'lucide-react';

export interface ErrorBoundaryFallbackProps {
  error: Error;
  errorInfo: ErrorInfo | null;
  resetErrorBoundary: () => void;
  reloadPage: () => void;
}

export interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: ReactNode | ((props: ErrorBoundaryFallbackProps) => ReactNode);
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  onReset?: () => void;
  isolate?: boolean;
}

export interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
  errorInfo: ErrorInfo | null;
  showDetails: boolean;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public override state: ErrorBoundaryState = {
    hasError: false,
    error: null,
    errorInfo: null,
    showDetails: false,
  };

  public static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    this.setState({ errorInfo });
    console.error('Uncaught error caught by ErrorBoundary:', error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  public resetErrorBoundary = (): void => {
    this.setState({
      hasError: false,
      error: null,
      errorInfo: null,
      showDetails: false,
    });
    this.props.onReset?.();
  };

  public handleReload = (): void => {
    if (typeof window !== 'undefined' && window.location) {
      window.location.reload();
    }
  };

  public toggleDetails = (): void => {
    this.setState((prev) => ({ showDetails: !prev.showDetails }));
  };

  public override render(): ReactNode {
    const { hasError, error, errorInfo, showDetails } = this.state;
    const { children, fallback, isolate } = this.props;

    if (!hasError) {
      return children;
    }

    if (fallback) {
      if (typeof fallback === 'function') {
        return fallback({
          error: error || new Error('Unknown error'),
          errorInfo,
          resetErrorBoundary: this.resetErrorBoundary,
          reloadPage: this.handleReload,
        });
      }
      return fallback;
    }

    // Isolated (compact widget) fallback UI
    if (isolate) {
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="p-4 rounded-xl bg-slate-900/90 border border-red-800/80 text-slate-100 shadow-xl space-y-3"
        >
          <div className="flex items-center gap-2 text-red-400 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>Component Error</span>
          </div>
          <p className="text-xs text-slate-300 font-mono bg-red-950/40 p-2.5 rounded-lg border border-red-900/50 truncate">
            {error?.message || 'A runtime error occurred in this module.'}
          </p>
          <div className="flex items-center gap-2 pt-1">
            <button
              type="button"
              onClick={this.resetErrorBoundary}
              className="px-3 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
              Reload Studio
            </button>
          </div>
        </div>
      );
    }

    // Full Studio Fallback UI
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="min-h-screen bg-[#0d0f17] text-slate-100 flex flex-col items-center justify-center p-6 font-['Inter']"
      >
        <div className="max-w-xl w-full bg-slate-900/90 border border-slate-800 rounded-2xl p-6 sm:p-8 shadow-2xl backdrop-blur-md text-center space-y-6">
          <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-amber-500/20 to-red-500/20 border border-amber-500/30 text-amber-400 mx-auto flex items-center justify-center shadow-lg shadow-amber-500/10">
            <AlertTriangle className="w-8 h-8" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <h1 className="text-2xl font-extrabold text-white font-['Montserrat'] tracking-tight">
              Karaoke Studio Error
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
              An unexpected runtime error occurred while rendering the studio interface. You can
              attempt state recovery or reload the studio.
            </p>
          </div>

          {/* Error Message Card */}
          <div className="text-left bg-red-950/40 border border-red-800/60 rounded-xl p-3.5 space-y-1">
            <div className="flex items-center gap-1.5 text-red-400 text-xs font-semibold">
              <Bug className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Runtime Exception</span>
            </div>
            <p className="text-xs text-red-200 font-mono break-all select-all">
              {error?.message || 'An unknown error occurred.'}
            </p>
          </div>

          {/* Collapsible Stack Trace Accordion */}
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-950/60 text-left">
            <button
              type="button"
              onClick={this.toggleDetails}
              aria-expanded={showDetails}
              aria-controls="error-stack-details"
              className="w-full px-4 py-2.5 flex items-center justify-between text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-800/40 transition-colors"
            >
              <span className="font-medium">Technical Details & Stack Trace</span>
              {showDetails ? (
                <ChevronUp className="w-4 h-4 text-slate-500" aria-hidden="true" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-500" aria-hidden="true" />
              )}
            </button>
            {showDetails && (
              <div
                id="error-stack-details"
                className="p-4 border-t border-slate-800/80 bg-black/40 text-[11px] font-mono text-slate-400 max-h-56 overflow-y-auto whitespace-pre-wrap select-all space-y-3"
              >
                {error?.stack && (
                  <div>
                    <span className="text-slate-500 font-semibold block mb-1">Stack:</span>
                    <span className="text-red-300/80">{error.stack}</span>
                  </div>
                )}
                {errorInfo?.componentStack && (
                  <div>
                    <span className="text-slate-500 font-semibold block mb-1">
                      Component Stack:
                    </span>
                    <span className="text-slate-400">{errorInfo.componentStack}</span>
                  </div>
                )}
                {!error?.stack && !errorInfo?.componentStack && (
                  <span className="text-slate-500 italic">No stack information captured.</span>
                )}
              </div>
            )}
          </div>

          {/* Action Recovery Buttons */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 pt-2">
            <button
              type="button"
              onClick={this.resetErrorBoundary}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs sm:text-sm transition-all shadow-lg shadow-cyan-500/20 flex items-center justify-center gap-2 active:scale-95 focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              Try Again
            </button>
            <button
              type="button"
              onClick={this.handleReload}
              className="w-full sm:w-auto px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-semibold text-xs sm:text-sm border border-slate-700 transition-colors flex items-center justify-center gap-2 active:scale-95 focus:outline-none focus:ring-2 focus:ring-slate-400"
            >
              <RefreshCw className="w-4 h-4" aria-hidden="true" />
              Reload Studio
            </button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
