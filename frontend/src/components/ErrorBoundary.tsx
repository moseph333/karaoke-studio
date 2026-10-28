/**
 * React Error Boundary Component
 *
 * Catches JavaScript errors anywhere in child component trees, logs error details,
 * and displays an accessible fallback UI with retry, reload, and error details toggling.
 */

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RotateCcw, RefreshCw, ChevronDown, ChevronUp, Bug } from 'lucide-react';
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
      const message = error?.message || 'A runtime error occurred in this module.';
      return (
        <div
          role="alert"
          aria-live="assertive"
          className="space-y-3 rounded-theme-lg border border-theme-danger/40 bg-theme-surface p-4 text-theme-text shadow-theme-md"
        >
          <div className="flex items-center gap-2 text-sm font-semibold text-theme-danger">
            <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Component Error</span>
          </div>
          <p
            title={message}
            className="truncate rounded-theme-md border border-theme-danger/25 bg-theme-danger/10 p-2.5 font-mono text-xs text-theme-text-muted"
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
        className="flex min-h-[100dvh] flex-col items-center justify-center bg-theme-bg p-4 font-theme-body text-theme-text sm:p-6"
      >
        <div className="w-full max-w-xl space-y-6 rounded-theme-xl border border-theme-border-subtle bg-theme-surface p-6 text-center shadow-theme-lg sm:p-8">
          <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-theme-lg bg-theme-warning/15 text-theme-warning shadow-theme-sm">
            <AlertTriangle className="h-8 w-8" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <h1 className="font-theme-heading text-2xl font-extrabold tracking-tight text-theme-text">
              Karaoke Studio Error
            </h1>
            <p className="mx-auto max-w-md text-sm leading-relaxed text-theme-text-muted">
              An unexpected runtime error occurred while rendering the studio interface. You can
              attempt state recovery or reload the studio.
            </p>
          </div>

          {/* Error Message Card */}
          <div className="space-y-1 rounded-theme-lg border border-theme-danger/35 bg-theme-danger/10 p-3.5 text-left">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-theme-danger">
              <Bug className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Runtime Exception</span>
            </div>
            <p className="select-all break-all font-mono text-xs text-theme-text">
              {error?.message || 'An unknown error occurred.'}
            </p>
          </div>

          {/* Collapsible Stack Trace Accordion */}
          <div className="overflow-hidden rounded-theme-lg border border-theme-border-subtle bg-theme-bg/60 text-left">
            <button
              type="button"
              onClick={this.toggleDetails}
              aria-expanded={showDetails}
              aria-controls="error-stack-details"
              className={cn(
                'flex min-h-[44px] w-full items-center justify-between px-4 py-2.5 text-xs text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text',
                focusRing
              )}
            >
              <span className="font-medium">Technical Details & Stack Trace</span>
              {showDetails ? (
                <ChevronUp className="h-4 w-4" aria-hidden="true" />
              ) : (
                <ChevronDown className="h-4 w-4" aria-hidden="true" />
              )}
            </button>
            {showDetails && (
              <div
                id="error-stack-details"
                className="max-h-56 select-all space-y-3 overflow-y-auto whitespace-pre-wrap border-t border-theme-border-subtle bg-theme-bg p-4 font-mono text-[11px] text-theme-text-muted"
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
                  <span className="italic">No stack information captured.</span>
                )}
              </div>
            )}
          </div>

          {/* Action Recovery Buttons */}
          <div className="flex flex-col items-stretch justify-center gap-3 pt-2 sm:flex-row sm:items-center">
            <Button
              variant="gradient"
              size="lg"
              onClick={this.resetErrorBoundary}
              leftIcon={<RotateCcw className="h-4 w-4" aria-hidden="true" />}
            >
              Try Again
            </Button>
            <Button
              variant="secondary"
              size="lg"
              onClick={this.handleReload}
              leftIcon={<RefreshCw className="h-4 w-4" aria-hidden="true" />}
            >
              Reload Studio
            </Button>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
