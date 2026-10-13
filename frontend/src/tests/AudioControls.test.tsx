import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioControls, parseMediaError } from '../components/AudioControls';
import * as apiModule from '../api';

describe('AudioControls', () => {
  const defaultProps = {
    projectId: 'test-project-123',
    masterAudioUrl: '/static/test-master.wav',
    currentTime: 15,
    duration: 120,
    isPlaying: false,
    onTogglePlay: vi.fn(),
    onSeek: vi.fn(),
    onMixChange: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('renders playback duration and current time correctly formatted', () => {
    render(<AudioControls {...defaultProps} />);

    expect(screen.getByText('0:15')).toBeInTheDocument();
    expect(screen.getByText('2:00')).toBeInTheDocument();
  });

  it('toggles play/pause when the transport button is clicked', async () => {
    const user = userEvent.setup();
    const onTogglePlay = vi.fn();

    const { rerender } = render(
      <AudioControls {...defaultProps} isPlaying={false} onTogglePlay={onTogglePlay} />
    );

    const playBtn = screen.getByRole('button', { name: /start playback/i });
    await user.click(playBtn);
    expect(onTogglePlay).toHaveBeenCalledTimes(1);

    rerender(<AudioControls {...defaultProps} isPlaying={true} onTogglePlay={onTogglePlay} />);
    expect(screen.getByRole('button', { name: /pause playback/i })).toBeInTheDocument();
  });

  it('calls onSeek(0) when the restart button is clicked', async () => {
    const user = userEvent.setup();
    const onSeek = vi.fn();
    render(<AudioControls {...defaultProps} onSeek={onSeek} />);

    const restartBtn = screen.getByRole('button', { name: /restart track from beginning/i });
    await user.click(restartBtn);

    expect(onSeek).toHaveBeenCalledWith(0);
  });

  it('increments, decrements, and resets pitch transposition within -12 to +12 bounds', async () => {
    const user = userEvent.setup();
    render(<AudioControls {...defaultProps} />);

    const decBtn = screen.getByRole('button', { name: /decrease pitch/i });
    const incBtn = screen.getByRole('button', { name: /increase pitch/i });
    const resetBtn = screen.getByRole('button', { name: /reset pitch/i });

    // Initial state
    expect(screen.getByText('0 (Original)')).toBeInTheDocument();

    // Increment
    await user.click(incBtn);
    expect(screen.getByText('+1 semitones')).toBeInTheDocument();

    await user.click(incBtn);
    expect(screen.getByText('+2 semitones')).toBeInTheDocument();

    // Decrement
    await user.click(decBtn);
    expect(screen.getByText('+1 semitones')).toBeInTheDocument();

    // Reset
    await user.click(resetBtn);
    expect(screen.getByText('0 (Original)')).toBeInTheDocument();
  });

  it('calls onMixChange with semitones and guide volume when Apply Audio Mix is clicked', async () => {
    const user = userEvent.setup();
    const onMixChange = vi.fn().mockResolvedValue(undefined);
    render(<AudioControls {...defaultProps} onMixChange={onMixChange} />);

    // Increase pitch by 2
    const incBtn = screen.getByRole('button', { name: /increase pitch/i });
    await user.click(incBtn);
    await user.click(incBtn);

    // Click apply mix
    const applyBtn = screen.getByRole('button', { name: /apply audio mix settings/i });
    await user.click(applyBtn);

    expect(onMixChange).toHaveBeenCalledTimes(1);
    expect(onMixChange).toHaveBeenCalledWith(2, 0.0);
  });

  // --- Feature 37 / Feature 38: Audio Error Listener & Recovery Tests ---

  it('renders native audio element with masterAudioUrl', () => {
    render(<AudioControls {...defaultProps} masterAudioUrl="/static/test-master.wav" />);
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    expect(audioEl).toBeInTheDocument();
    expect(audioEl.getAttribute('src')).toBe('/static/test-master.wav');
  });

  it('synchronizes pitch and guide volume state with initial props', () => {
    const { rerender } = render(
      <AudioControls {...defaultProps} initialSemitones={3} initialGuideVolume={0.25} />
    );

    expect(screen.getByText('+3 semitones')).toBeInTheDocument();
    expect(screen.getByText('25%')).toBeInTheDocument();

    rerender(<AudioControls {...defaultProps} initialSemitones={-2} initialGuideVolume={0.4} />);
    expect(screen.getByText('-2 semitones')).toBeInTheDocument();
    expect(screen.getByText('40%')).toBeInTheDocument();
  });

  it('parses native MediaError codes correctly into user-friendly messages', () => {
    expect(parseMediaError({ code: 1, message: '' } as MediaError).codeName).toBe(
      'MEDIA_ERR_ABORTED'
    );
    expect(parseMediaError({ code: 2, message: '' } as MediaError).codeName).toBe(
      'MEDIA_ERR_NETWORK'
    );
    expect(parseMediaError({ code: 3, message: '' } as MediaError).codeName).toBe(
      'MEDIA_ERR_DECODE'
    );
    expect(parseMediaError({ code: 4, message: '' } as MediaError).codeName).toBe(
      'MEDIA_ERR_SRC_NOT_SUPPORTED'
    );
  });

  it('handles native audio onError event and displays alert with recovery retry button', async () => {
    const user = userEvent.setup();
    const onPlaybackError = vi.fn();
    const onTogglePlay = vi.fn();

    render(
      <AudioControls
        {...defaultProps}
        isPlaying={true}
        onTogglePlay={onTogglePlay}
        onPlaybackError={onPlaybackError}
      />
    );

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

    // Simulate MediaError 3 (MEDIA_ERR_DECODE)
    Object.defineProperty(audioEl, 'error', {
      value: { code: 3, message: 'Decode failed' },
      configurable: true,
      writable: true,
    });

    fireEvent.error(audioEl);

    // Verifies alert banner is shown
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText(/MEDIA_ERR_DECODE/i)).toBeInTheDocument();
    expect(screen.getByText(/Audio decoding failed/i)).toBeInTheDocument();

    // Verifies playing state was paused
    expect(onTogglePlay).toHaveBeenCalledTimes(1);

    // Verifies callback was invoked
    expect(onPlaybackError).toHaveBeenCalledWith(
      expect.objectContaining({
        code: 3,
        codeName: 'MEDIA_ERR_DECODE',
      })
    );

    // Clicking Retry Playback dismisses error and calls load
    const retryBtn = screen.getByRole('button', { name: /retry playback/i });
    await user.click(retryBtn);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(audioEl.load).toHaveBeenCalled();
  });

  it('maps MediaError code 2 (MEDIA_ERR_NETWORK) and code 4 (MEDIA_ERR_SRC_NOT_SUPPORTED)', () => {
    render(<AudioControls {...defaultProps} />);
    const audioEl = screen.getByTestId('audio-element');

    // Network error
    Object.defineProperty(audioEl, 'error', {
      value: { code: 2, message: 'Network dropped' },
      configurable: true,
      writable: true,
    });
    fireEvent.error(audioEl);
    expect(screen.getByText(/Network error loading audio stream/i)).toBeInTheDocument();

    // Source error
    Object.defineProperty(audioEl, 'error', {
      value: { code: 4, message: 'Format not supported' },
      configurable: true,
      writable: true,
    });
    fireEvent.error(audioEl);
    expect(screen.getByText(/Audio format not supported/i)).toBeInTheDocument();
  });

  it('handles instrumental upload failure gracefully without throwing unhandled exceptions', async () => {
    const user = userEvent.setup();
    vi.spyOn(apiModule, 'apiFetch').mockResolvedValue(
      new Response(JSON.stringify({ detail: 'Invalid WAV format' }), { status: 400 })
    );

    render(<AudioControls {...defaultProps} />);

    const uploadInput = screen.getByLabelText(/upload custom instrumental audio file/i);
    const file = new File(['corrupt-data'], 'bad.txt', { type: 'text/plain' });

    await user.upload(uploadInput, file);

    // Verifies button returns to interactive state
    expect(screen.getByRole('button', { name: /replace instrumental file/i })).not.toBeDisabled();
  });
});
