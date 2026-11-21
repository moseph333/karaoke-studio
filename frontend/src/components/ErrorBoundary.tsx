/**
 * React Error Boundary Component
 *
 * Catches JavaScript errors anywhere in child component trees, logs error details,
 * and displays an accessible fallback UI with retry, reload, and error details toggling.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react';
import { Button } from './ui/Button';
import { focusRing } from './ui/variants';
import { cn } from '../utils/cn';

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
  /** Clears a caught error when this value changes (e.g. a dialog being opened again). */
  resetKey?: unknown;
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

  public override componentDidUpdate(prevProps: ErrorBoundaryProps): void {
    if (this.state.hasError && prevProps.resetKey !== this.props.resetKey) {
      this.resetErrorBoundary();
    }
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
      const message = error?.message || 'A runtime error occurred in this module.';
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="space-y-3 border border-theme-danger bg-theme-surface p-4 text-theme-text"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-theme-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Component Error</span>
          </div>
          <p
            title={message}
            className="truncate border border-theme-danger p-2.5 tabular-nums text-xs text-theme-text-muted"
          >
            {message}
          </p>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              variant="primary"
              size="sm"
              onClick={this.resetErrorBoundary}
              leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              Try Again
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={this.handleReload}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" aria-hidden="true" />}
            >
              Reload Studio
            </Button>
          </div>
        </div>
      );
    }

    // Full Studio Fallback UI
    return (
      <div
        role="alert"
        aria-live="assertive"
        className="flex min-h-[100dvh] flex-col justify-center bg-theme-bg p-4 font-theme-body text-theme-text sm:p-8"
      >
        <div className="w-full max-w-2xl space-y-6">
          <div className="space-y-2">
            <h1 className="ks-display text-[44px] font-black leading-[0.9] text-theme-danger sm:text-[72px]">
              Karaoke Studio Error
            </h1>
            <p className="max-w-xl border-t-2 border-theme-border pt-4 text-[19px] text-theme-text">
              An unexpected runtime error occurred while rendering the studio interface. You can
              attempt state recovery or reload the studio.
            </p>
          </div>

          {/* Error Message Card */}
          <div className="space-y-1 border-l-2 border-theme-danger pl-3">
            <div className="text-sm font-semibold text-theme-text">
              <span>Runtime Exception</span>
            </div>
            <p className="select-all break-all font-mono text-xs text-theme-text-muted">
              {error?.message || 'An unknown error occurred.'}
            </p>
          </div>

          {/* Collapsible Stack Trace Accordion */}
          <div className="overflow-hidden">
            <button
              type="button"
              onClick={this.toggleDetails}
              aria-expanded={showDetails}
              aria-controls="error-stack-details"
              className={cn(
                'flex min-h-[44px] items-center gap-2 text-sm font-semibold text-theme-text-muted transition-colors hover:text-theme-text',
                focusRing
              )}
            >
              <span>Technical Details & Stack Trace</span>
              {showDetails ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            {showDetails && (
              <div
                id="error-stack-details"
                className="max-h-56 select-all space-y-3 overflow-y-auto whitespace-pre-wrap border-l-2 border-theme-border-subtle pl-3 font-mono text-xs text-theme-text-muted"
              >
                {error?.stack && (
                  <div>
                    <span className="mb-1 block font-semibold text-theme-text">Stack:</span>
                    <span className="text-theme-danger">{error.stack}</span>
                  </div>
                )}
                {errorInfo?.componentStack && (
                  <div>
                    <span className="mb-1 block font-semibold text-theme-text">
                      Component Stack:
                    </span>
                    <span>{errorInfo.componentStack}</span>
                  </div>
                )}
                {!error?.stack && !errorInfo?.componentStack && (
                  <span>No stack information captured.</span>
                )}
              </div>
            )}
          </div>

          {/* Action Recovery Buttons */}
          <div className="flex flex-col items-stretch gap-3 pt-2 sm:flex-row sm:items-center">
            <Button variant="primary" size="lg" onClick={this.resetErrorBoundary}>
              Try Again
            </Button>
            <Button variant="secondary" size="lg" onClick={this.handleReload}>
              Reload Studio
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
