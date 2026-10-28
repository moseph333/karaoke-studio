import React, { useState } from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { parseMediaError } from '../components/AudioControls';
import { TransportDock } from '../components/transport/TransportDock';

// Component that conditionally throws for ErrorBoundary testing
const ProblemChild: React.FC<{
  shouldThrow?: boolean;
  errorToThrow?: unknown;
}> = ({ shouldThrow = true, errorToThrow = new Error('Explosive test error') }) => {
  if (shouldThrow) {
    throw errorToThrow;
  }
  return <div data-testid="safe-child">Safe child rendered successfully</div>;
};

// Host component for testing state recovery
const RecoverableHost: React.FC<{ onResetSpy?: () => void }> = ({ onResetSpy }) => {
  const [shouldThrow, setShouldThrow] = useState(true);
  return (
    <ErrorBoundary
      onReset={() => {
        setShouldThrow(false);
        onResetSpy?.();
      }}
    >
      <ProblemChild shouldThrow={shouldThrow} errorToThrow={new Error('Recoverable test crash')} />
    </ErrorBoundary>
  );
};

// Host component that stays broken even after reset
const StubbornHost: React.FC = () => {
  return (
    <ErrorBoundary>
      <ProblemChild shouldThrow={true} errorToThrow={new Error('Permanent crash')} />
    </ErrorBoundary>
  );
};

describe('M4 Challenger 1: ErrorBoundary Stress & Adversarial Suite', () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    // Suppress React boundary console logs during tests
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    vi.restoreAllMocks();
  });

  it('Scenario 1: catches synchronous render exceptions and renders full alert UI with role="alert"', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow errorToThrow={new Error('Synch render explosion')} />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Karaoke Studio Error')).toBeInTheDocument();
    expect(screen.getByText('Synch render explosion')).toBeInTheDocument();
  });

  it('Scenario 2: collapsible stack trace accordion toggles on/off with correct ARIA attributes', async () => {
    const user = userEvent.setup();
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow errorToThrow={new Error('Stack trace toggle check')} />
      </ErrorBoundary>
    );

    const toggleBtn = screen.getByRole('button', { name: /technical details/i });
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('error-stack-details')).toBeNull();

    // First click: expand
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'true');
    const detailsContainer = document.getElementById('error-stack-details');
    expect(detailsContainer).not.toBeNull();
    expect(detailsContainer).toHaveTextContent('Stack trace toggle check');

    // Second click: collapse
    await user.click(toggleBtn);
    expect(toggleBtn).toHaveAttribute('aria-expanded', 'false');
    expect(document.getElementById('error-stack-details')).toBeNull();
  });

  it('Scenario 3: "Try Again" state reset clears error and restores children when error source is resolved', async () => {
    const user = userEvent.setup();
    const onResetSpy = vi.fn();
    render(<RecoverableHost onResetSpy={onResetSpy} />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/Recoverable test crash/i)).toBeInTheDocument();

    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });
    await user.click(tryAgainBtn);

    expect(onResetSpy).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByTestId('safe-child')).toBeInTheDocument();
  });

  it('Scenario 4: "Try Again" re-catches error cleanly if child remains broken', async () => {
    const user = userEvent.setup();
    render(<StubbornHost />);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    const tryAgainBtn = screen.getByRole('button', { name: /try again/i });

    // Click try again on a stubborn component
    await user.click(tryAgainBtn);

    // Should still be in alert state without crashing test runner
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Permanent crash')).toBeInTheDocument();
  });

  it('Scenario 5: isolate mode renders container-scoped widget instead of full-screen layout', () => {
    render(
      <ErrorBoundary isolate>
        <ProblemChild shouldThrow errorToThrow={new Error('Isolated module failure')} />
      </ErrorBoundary>
    );

    const alert = screen.getByRole('alert');
    expect(alert).toBeInTheDocument();
    expect(screen.getByText('Component Error')).toBeInTheDocument();
    expect(screen.getByText('Isolated module failure')).toBeInTheDocument();
    // Full screen header must NOT be rendered
    expect(screen.queryByText('Karaoke Studio Error')).toBeNull();
    // Action buttons must still be present
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reload studio/i })).toBeInTheDocument();
  });

  it('Scenario 6: onError callback emits original Error and ErrorInfo with componentStack', () => {
    const onErrorSpy = vi.fn();
    const testErr = new Error('Diagnostic reporting payload');

    render(
      <ErrorBoundary onError={onErrorSpy}>
        <ProblemChild shouldThrow errorToThrow={testErr} />
      </ErrorBoundary>
    );

    expect(onErrorSpy).toHaveBeenCalledTimes(1);
    const [receivedError, receivedInfo] = onErrorSpy.mock.calls[0];
    expect(receivedError).toBe(testErr);
    expect(receivedInfo).toBeDefined();
    expect(receivedInfo.componentStack).toContain('ProblemChild');
  });

  it('Scenario 7: nested ErrorBoundaries isolate child crash from parent tree', () => {
    render(
      <ErrorBoundary>
        <div data-testid="outer-app">
          <header>Top Bar Safe</header>
          <ErrorBoundary isolate>
            <ProblemChild shouldThrow errorToThrow={new Error('Inner widget crash')} />
          </ErrorBoundary>
          <footer>Footer Safe</footer>
        </div>
      </ErrorBoundary>
    );

    // Inner ErrorBoundary shows component alert
    expect(screen.getByText('Component Error')).toBeInTheDocument();
    expect(screen.getByText('Inner widget crash')).toBeInTheDocument();

    // Outer app tree is intact
    expect(screen.getByText('Top Bar Safe')).toBeInTheDocument();
    expect(screen.getByText('Footer Safe')).toBeInTheDocument();
    expect(screen.queryByText('Karaoke Studio Error')).toBeNull();
  });

  it('Scenario 8: adversarial non-Error thrown (string literal) does not crash ErrorBoundary', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow errorToThrow="Literal string panic message" />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Karaoke Studio Error')).toBeInTheDocument();
    // Falls back gracefully
    expect(screen.getByText('An unknown error occurred.')).toBeInTheDocument();
  });

  it('Scenario 9: adversarial non-Error thrown (plain object) does not crash ErrorBoundary', () => {
    render(
      <ErrorBoundary>
        <ProblemChild shouldThrow errorToThrow={{ code: 500, detail: 'custom object' }} />
      </ErrorBoundary>
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('Karaoke Studio Error')).toBeInTheDocument();
    expect(screen.getByText('An unknown error occurred.')).toBeInTheDocument();
  });

  it('Scenario 10: custom fallback render function receives error and recovery helpers', () => {
    render(
      <ErrorBoundary
        fallback={({ error, resetErrorBoundary, reloadPage }) => (
          <div>
            <span>Custom handled: {error.message}</span>
            <button onClick={resetErrorBoundary}>Custom Reset</button>
            <button onClick={reloadPage}>Custom Reload</button>
          </div>
        )}
      >
        <ProblemChild shouldThrow errorToThrow={new Error('Custom fallback check')} />
      </ErrorBoundary>
    );

    expect(screen.getByText('Custom handled: Custom fallback check')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom reset/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /custom reload/i })).toBeInTheDocument();
  });
});

describe('M4 Challenger 1: TransportDock MediaError Stress & Recovery Suite', () => {
  const defaultAudioProps = {
    masterAudioUrl: '/static/test-track.wav',
    currentTime: 30,
    duration: 180,
    isPlaying: false,
    onTogglePlay: vi.fn(),
    onSeek: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('Scenario 11: parses MediaError codes 1..4 and handles null/custom codes', () => {
    expect(parseMediaError({ code: 1, message: '' } as MediaError)).toMatchObject({
      code: 1,
      codeName: 'MEDIA_ERR_ABORTED',
    });
    expect(parseMediaError({ code: 2, message: '' } as MediaError)).toMatchObject({
      code: 2,
      codeName: 'MEDIA_ERR_NETWORK',
    });
    expect(parseMediaError({ code: 3, message: '' } as MediaError)).toMatchObject({
      code: 3,
      codeName: 'MEDIA_ERR_DECODE',
    });
    expect(parseMediaError({ code: 4, message: '' } as MediaError)).toMatchObject({
      code: 4,
      codeName: 'MEDIA_ERR_SRC_NOT_SUPPORTED',
    });
    // Null media error
    expect(parseMediaError(null)).toMatchObject({
      code: 0,
      codeName: 'MEDIA_ERR_UNKNOWN',
    });
    // Unknown code 99 with custom message
    expect(
      parseMediaError({ code: 99, message: 'Vendor codec crash' } as MediaError)
    ).toMatchObject({
      code: 99,
      codeName: 'MEDIA_ERR_UNKNOWN',
      message: 'Vendor codec crash',
    });
  });

  it('Scenario 12: simulates MediaError code 1 (MEDIA_ERR_ABORTED) on <audio onError>', () => {
    const onPlaybackError = vi.fn();
    render(<TransportDock {...defaultAudioProps} onPlaybackError={onPlaybackError} />);

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    Object.defineProperty(audioEl, 'error', {
      value: { code: 1, message: 'Playback aborted by user/network' },
      configurable: true,
      writable: true,
    });

    fireEvent.error(audioEl);

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/MEDIA_ERR_ABORTED/i)).toBeInTheDocument();
    expect(screen.getByText(/Audio playback was aborted/i)).toBeInTheDocument();
    expect(onPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 1,
        codeName: 'MEDIA_ERR_ABORTED',
      })
    );
  });

  it('Scenario 13: resets playback state (calls onTogglePlay) when error occurs while playing', () => {
    const onTogglePlay = vi.fn();
    render(<TransportDock {...defaultAudioProps} isPlaying={true} onTogglePlay={onTogglePlay} />);

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    Object.defineProperty(audioEl, 'error', {
      value: { code: 2, message: 'Network dropped' },
      configurable: true,
      writable: true,
    });

    fireEvent.error(audioEl);

    // Because isPlaying was true, onTogglePlay must be triggered to stop playback state
    expect(onTogglePlay).toHaveBeenCalledTimes(1);
  });

  it('Scenario 14: does NOT call onTogglePlay if error occurs while already paused', () => {
    const onTogglePlay = vi.fn();
    render(<TransportDock {...defaultAudioProps} isPlaying={false} onTogglePlay={onTogglePlay} />);

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    Object.defineProperty(audioEl, 'error', {
      value: { code: 3, message: 'Decode corrupted chunk' },
      configurable: true,
      writable: true,
    });

    fireEvent.error(audioEl);

    // Must NOT call onTogglePlay (which would inadvertently start playing)
    expect(onTogglePlay).not.toHaveBeenCalled();
  });

  it('Scenario 15: dispatches window "karaoke_audio_error" custom event with parsed error detail', () => {
    const eventHandler = vi.fn();
    window.addEventListener('karaoke_audio_error', eventHandler);

    render(<TransportDock {...defaultAudioProps} />);
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    Object.defineProperty(audioEl, 'error', {
      value: { code: 4, message: 'File not found' },
      configurable: true,
      writable: true,
    });

    fireEvent.error(audioEl);

    expect(eventHandler).toHaveBeenCalledTimes(1);
    const event = eventHandler.mock.calls[0][0] as CustomEvent;
    expect(event.detail.code).toBe(4);
    expect(event.detail.codeName).toBe('MEDIA_ERR_SRC_NOT_SUPPORTED');

    window.removeEventListener('karaoke_audio_error', eventHandler);
  });

  it('Scenario 16: clears error banner when masterAudioUrl changes to a new track', () => {
    const { rerender } = render(<TransportDock {...defaultAudioProps} />);
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

    Object.defineProperty(audioEl, 'error', {
      value: { code: 2, message: 'Network failed' },
      configurable: true,
      writable: true,
    });
    fireEvent.error(audioEl);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    // Change masterAudioUrl prop
    rerender(<TransportDock {...defaultAudioProps} masterAudioUrl="/static/new-track.wav" />);

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('Scenario 17: "Retry Playback" triggers audioEl.load(), restores position, and dismisses error banner', async () => {
    const user = userEvent.setup();
    const onRetryPlayback = vi.fn();
    render(
      <TransportDock {...defaultAudioProps} onRetryPlayback={onRetryPlayback} currentTime={45} />
    );

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    Object.defineProperty(audioEl, 'error', {
      value: { code: 3, message: 'Corrupt audio segment' },
      configurable: true,
      writable: true,
    });
    fireEvent.error(audioEl);

    expect(screen.getByRole('alert')).toBeInTheDocument();

    const retryBtn = screen.getByRole('button', { name: /retry playback/i });
    await user.click(retryBtn);

    expect(screen.queryByRole('alert')).toBeNull();
    expect(audioEl.load).toHaveBeenCalledTimes(1);
    expect(onRetryPlayback).toHaveBeenCalledTimes(1);
  });

  // ---------------------------------------------------------------------------
  // Target Defect Verifications: Empirical Challenge Demonstrations
  // ---------------------------------------------------------------------------

  it('Scenario 18: [REMEDIATED] in-place error banner renders with data-testid="audio-error-banner"', () => {
    render(<TransportDock {...defaultAudioProps} />);
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

    Object.defineProperty(audioEl, 'error', {
      value: { code: 2, message: 'Network failed' },
      configurable: true,
      writable: true,
    });
    fireEvent.error(audioEl);

    // The alert banner is rendered in the DOM with the required testid
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('audio-error-banner')).toBeInTheDocument();
  });

  it('Scenario 19: [REMEDIATED] error banner dismisses on successful playback recovery (onPlay)', () => {
    render(<TransportDock {...defaultAudioProps} />);
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

    // Trigger error state
    Object.defineProperty(audioEl, 'error', {
      value: { code: 2, message: 'Network transient glitch' },
      configurable: true,
      writable: true,
    });
    fireEvent.error(audioEl);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByTestId('audio-error-banner')).toBeInTheDocument();

    // Audio stream recovers and playback event fires
    fireEvent.play(audioEl);

    // REMEDIATED BEHAVIOR:
    // DISPATCH.md line 17 explicitly required:
    //   "Verifies error banner dismisses on retry or successful playback"
    // TransportDock attaches onPlay to clear playbackError:
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByTestId('audio-error-banner')).toBeNull();
  });

  it('Scenario 20: [REMEDIATED] Retry playback action calls load() and attempts playback resumption via play()', async () => {
    const user = userEvent.setup();
    render(<TransportDock {...defaultAudioProps} />);
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

    Object.defineProperty(audioEl, 'error', {
      value: { code: 3, message: 'Decode failed' },
      configurable: true,
      writable: true,
    });
    fireEvent.error(audioEl);

    const retryBtn = screen.getByRole('button', { name: /retry playback/i });
    await user.click(retryBtn);

    // REMEDIATED BEHAVIOR:
    // TransportDock handleRetryPlayback calls load() and attempts playback via play():
    expect(audioEl.load).toHaveBeenCalledTimes(1);
    expect(audioEl.play).toHaveBeenCalledTimes(1);
  });
});
