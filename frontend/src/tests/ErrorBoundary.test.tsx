import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../components/ErrorBoundary';

const ProblemChild: React.FC<{ shouldThrow?: boolean; message?: string }> = ({
  shouldThrow = true,
  message = 'Explosive test error',
}) => {
  if (shouldThrow) {
    throw new Error(message);
  }
  return <div>Safe child content</div>;
};

const RecoverableHost: React.FC = () => {
  const [shouldThrow, setShouldThrow] = useState(true);
  return (
    <ErrorBoundary onReset={() => setShouldThrow(false)}>
      <ProblemChild shouldThrow={shouldThrow} message="Recoverable crash" />
    </ErrorBoundary>
  );
};

describe('ErrorBoundary', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Suppress React internal error boundary logs in test output
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('renders children normally when no error occurs', () => {
    render(
      <ErrorBoundary>
        <div>Child rendered successfully</div>
      </ErrorBoundary>
    );

    expect(screen.getByText('Child rendered successfully')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('catches render error, renders alert role, and displays error message', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow message="Component threw unexpected error" />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText(/Karaoke Studio Error/i)).toBeInTheDocument();
    expect(screen.getByText(/Component threw unexpected error/i)).toBeInTheDocument();
  });

  it('invokes onError callback with error and errorInfo', () => {
    const onError = vi.fn();
    render(
      <ErrorBoundary onError={onError}>
        <ProblemChild shouldThrow message="Reported error" />
      </ErrorBoundary>
    );

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][0]).toBeInstanceOf(Error);
    expect(onError.mock.calls[0][0].message).toBe('Reported error');
    expect(onError.mock.calls[0][1]).toHaveProperty('componentStack');
  });

  it('expands collapsible technical details accordion upon button click', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow message="Detailed stack check" />
      </ErrorBoundary>
    );

    const toggleBtn = screen.getByRole('button', { name: /technical details/i });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');

    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    const detailsEl = document.getElementById('error-stack-details');
    expect(detailsEl).toBeInTheDocument();
    expect(detailsEl).toHaveTextContent(/Detailed stack check/i);
  });

  it('resets error state when clicking Try Again button', async () => {
    const user = userEvent.setup();
    render(<RecoverableHost />);

    expect(screen.getByText(/Karaoke Studio Error/i)).toBeInTheDocument();

    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
    await user.click(tryAgainBtn);

    expect(screen.getByText('Safe child content')).toBeInTheDocument();
    expect(screen.queryByText(/Karaoke Studio Error/i)).not.toBeInTheDocument();
  });

  it('triggers window.location.reload when clicking Reload Studio', async () => {
    const user = userEvent.setup();
    const reloadMock = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload: reloadMock },
    });

    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow message="Reload needed" />
      </ErrorBoundary>
    );

    const reloadBtn = screen.getByRole('button', { name: /reload studio/i });
    await user.click(reloadBtn);

    expect(reloadMock).toHaveBeenCalledTimes(1);
  });

  it('renders custom function fallback when fallback prop is provided', () => {
    render(
      <ErrorBoundary
        fallback={({ error, resetErrorBoundary }) => (
          <div>
            <span>Custom fallback: {error.message}</span>
            <button onClick={resetErrorBoundary}>Custom Reset</button>
          </div>
        )}
      >
        <ProblemChild shouldThrow message="Custom error test" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom fallback: Custom error test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom reset/i })).toBeInTheDocument();
  });

  it('renders compact inline alert when isolate prop is true', () => {
    render(
      <ErrorBoundary isolate>
        <ProblemChild shouldThrow message="Isolated widget failure" />
      </ErrorBoundary>
    );

    expect(screen.getByText('Component Error')).toBeInTheDocument();
    expect(screen.getByText(/Isolated widget failure/i)).toBeInTheDocument();
    expect(screen.queryByText(/Karaoke Studio Error/i)).not.toBeInTheDocument();
  });
});
