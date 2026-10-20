import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AudioControls, parseMediaError } from '../components/AudioControls';
import * as apiModule from '../api';
import { VocalRangeData } from '../types';

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
    expect(screen.getByTestId('audio-error-banner')).toBeInTheDocument();
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

    // Clicking Retry Playback dismisses error, reloads, and attempts playback resumption
    const retryBtn = screen.getByRole('button', { name: /retry playback/i });
    await user.click(retryBtn);

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByTestId('audio-error-banner')).not.toBeInTheDocument();
    expect(audioEl.load).toHaveBeenCalled();
    expect(audioEl.play).toHaveBeenCalled();
  });

  it('dismisses active playback error banner when playback resumes (onPlay)', () => {
    render(<AudioControls {...defaultProps} />);
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

    Object.defineProperty(audioEl, 'error', {
      value: { code: 2, message: 'Network dropped' },
      configurable: true,
      writable: true,
    });
    fireEvent.error(audioEl);

    expect(screen.getByTestId('audio-error-banner')).toBeInTheDocument();

    fireEvent.play(audioEl);

    expect(screen.queryByTestId('audio-error-banner')).not.toBeInTheDocument();
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

  // --- Feature 42: Master Volume & Mute Controls Test Suite ---

  it('renders master volume slider and mute toggle button with initial defaults', () => {
    localStorage.clear();
    render(<AudioControls {...defaultProps} />);

    // Slider verification
    const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
    expect(slider).toBeInTheDocument();
    expect(slider.min).toBe('0');
    expect(slider.max).toBe('1');
    expect(slider.step).toBe('0.01');
    expect(slider.value).toBe('1');
    expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);

    // Mute button verification
    const muteBtn = screen.getByRole('button', { name: /mute audio/i });
    expect(muteBtn).toBeInTheDocument();
    expect(muteBtn).toHaveAttribute('aria-pressed', 'false');

    // Audio element sync verification
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    expect(audioEl.volume).toBe(1.0);
    expect(audioEl.muted).toBe(false);
  });

  it('updates volume slider, modifies audio.volume, and calls onVolumeChange', () => {
    localStorage.clear();
    const onVolumeChange = vi.fn();
    render(<AudioControls {...defaultProps} onVolumeChange={onVolumeChange} />);

    const slider = screen.getByRole('slider', { name: /master volume/i });
    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

    fireEvent.change(slider, { target: { value: '0.45' } });

    expect(slider).toHaveValue('0.45');
    expect(screen.getByText('45%')).toBeInTheDocument();
    expect(audioEl.volume).toBe(0.45);
    expect(onVolumeChange).toHaveBeenCalledWith(0.45);
    expect(localStorage.getItem('karaoke_master_volume')).toBe('0.45');
  });

  it('toggles mute button to muted state, updates aria-label, and sets audio.muted', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const onMuteChange = vi.fn();
    render(<AudioControls {...defaultProps} onMuteChange={onMuteChange} initialVolume={0.8} />);

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    const muteBtn = screen.getByRole('button', { name: /mute audio/i });

    await user.click(muteBtn);

    expect(audioEl.muted).toBe(true);
    expect(onMuteChange).toHaveBeenCalledWith(true);
    expect(localStorage.getItem('karaoke_master_muted')).toBe('true');
    expect(screen.getByRole('button', { name: /unmute audio/i })).toBeInTheDocument();
    expect(screen.getByText('Muted')).toBeInTheDocument();
  });

  it('smart unmutes and restores the previous non-zero volume', async () => {
    localStorage.clear();
    const user = userEvent.setup();
    const onVolumeChange = vi.fn();
    const onMuteChange = vi.fn();

    render(
      <AudioControls
        {...defaultProps}
        initialVolume={0.75}
        onVolumeChange={onVolumeChange}
        onMuteChange={onMuteChange}
      />
    );

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    const muteBtn = screen.getByRole('button', { name: /mute audio/i });

    // Step 1: Mute
    await user.click(muteBtn);
    expect(audioEl.muted).toBe(true);
    expect(screen.getByText('Muted')).toBeInTheDocument();

    // Step 2: Unmute -> should restore 75%
    const unmuteBtn = screen.getByRole('button', { name: /unmute audio/i });
    await user.click(unmuteBtn);

    expect(audioEl.muted).toBe(false);
    expect(audioEl.volume).toBe(0.75);
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(onVolumeChange).toHaveBeenCalledWith(0.75);
    expect(onMuteChange).toHaveBeenCalledWith(false);
  });

  it('auto-unmutes when adjusting volume slider up from 0 or while muted', () => {
    localStorage.clear();
    const onMuteChange = vi.fn();

    render(
      <AudioControls
        {...defaultProps}
        initialVolume={0.6}
        initialMuted={true}
        onMuteChange={onMuteChange}
      />
    );

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    expect(audioEl.muted).toBe(true);

    const slider = screen.getByRole('slider', { name: /master volume/i });
    fireEvent.change(slider, { target: { value: '0.85' } });

    expect(audioEl.muted).toBe(false);
    expect(audioEl.volume).toBe(0.85);
    expect(screen.getByText('85%')).toBeInTheDocument();
    expect(onMuteChange).toHaveBeenCalledWith(false);
  });

  it('syncs audio element state when native volumechange event fires', () => {
    localStorage.clear();
    const onVolumeChange = vi.fn();
    const onMuteChange = vi.fn();

    render(
      <AudioControls
        {...defaultProps}
        onVolumeChange={onVolumeChange}
        onMuteChange={onMuteChange}
      />
    );

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;

    // Simulate external audio element property update and volumechange event
    audioEl.volume = 0.3;
    audioEl.muted = true;
    fireEvent(audioEl, new Event('volumechange'));

    expect(screen.getByText('Muted')).toBeInTheDocument();
    expect(onVolumeChange).toHaveBeenCalledWith(0.3);
    expect(onMuteChange).toHaveBeenCalledWith(true);
    expect(localStorage.getItem('karaoke_master_volume')).toBe('0.3');
    expect(localStorage.getItem('karaoke_master_muted')).toBe('true');
  });

  it('initializes volume and muted states from localStorage when present', () => {
    localStorage.setItem('karaoke_master_volume', '0.62');
    localStorage.setItem('karaoke_master_muted', 'true');

    render(<AudioControls {...defaultProps} />);

    const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
    expect(slider.value).toBe('0.62');
    expect(screen.getByRole('button', { name: /unmute audio/i })).toBeInTheDocument();
    expect(screen.getByText('Muted')).toBeInTheDocument();

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    expect(audioEl.volume).toBe(0.62);
    expect(audioEl.muted).toBe(true);
  });

  it('responds to window karaoke_toggle_mute custom event', () => {
    localStorage.clear();
    const onMuteChange = vi.fn();
    render(<AudioControls {...defaultProps} onMuteChange={onMuteChange} initialVolume={0.9} />);

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    expect(audioEl.muted).toBe(false);

    // Dispatch global custom event
    window.dispatchEvent(new CustomEvent('karaoke_toggle_mute'));

    expect(audioEl.muted).toBe(true);
    expect(onMuteChange).toHaveBeenCalledWith(true);
  });

  it('re-applies volume and muted state when masterAudioUrl changes', () => {
    localStorage.clear();
    const { rerender } = render(
      <AudioControls {...defaultProps} initialVolume={0.4} initialMuted={true} />
    );

    const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
    expect(audioEl.volume).toBe(0.4);
    expect(audioEl.muted).toBe(true);

    rerender(
      <AudioControls
        {...defaultProps}
        masterAudioUrl="/static/new-track.wav"
        initialVolume={0.4}
        initialMuted={true}
      />
    );

    const updatedAudio = screen.getByTestId('audio-element') as HTMLAudioElement;
    expect(updatedAudio.volume).toBe(0.4);
    expect(updatedAudio.muted).toBe(true);
  });

  describe('Vocal Range & Smart Recommender Integration (R1)', () => {
    const mockVocalRange: VocalRangeData = {
      lowest_note: 'C#3',
      highest_note: 'E4',
      lowest_hz: 140.6,
      highest_hz: 332.7,
      tessitura_low_note: 'B3',
      tessitura_high_note: 'D#4',
      tessitura_low_hz: 246.9,
      tessitura_high_hz: 311.1,
      median_note: 'C#4',
      median_hz: 279.9,
      estimated_key: 'C# Minor',
      key_confidence: 0.88,
      is_voiced: true,
    };

    it('displays detected vocal range badge when vocalRange is passed', () => {
      render(<AudioControls {...defaultProps} vocalRange={mockVocalRange} />);

      expect(screen.getByText(/C#3–E4/i)).toBeInTheDocument();
      expect(screen.getByText(/C# Minor/i)).toBeInTheDocument();
      expect(
        screen.getByRole('button', { name: /open smart key recommender/i })
      ).toBeInTheDocument();
    });

    it('opens Smart Key Recommender modal when button is clicked', async () => {
      const user = userEvent.setup();
      render(<AudioControls {...defaultProps} vocalRange={mockVocalRange} />);

      const button = screen.getByRole('button', { name: /open smart key recommender/i });
      await user.click(button);

      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(screen.getByText('Smart Key Recommender')).toBeInTheDocument();
    });

    it('applies transposition from modal and calls onMixChange', async () => {
      const user = userEvent.setup();
      const onMixChange = vi.fn().mockResolvedValue(undefined);
      render(
        <AudioControls {...defaultProps} vocalRange={mockVocalRange} onMixChange={onMixChange} />
      );

      // Open modal
      await user.click(screen.getByRole('button', { name: /open smart key recommender/i }));

      // Select Soprano preset (requires transposition)
      const sopranoRadio = screen.getByRole('radio', { name: /^soprano$/i });
      await user.click(sopranoRadio);

      // Apply transposition
      const applyBtn = screen.getByRole('button', { name: /apply transposition/i });
      await user.click(applyBtn);

      // Modal closes and mix change is invoked
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(onMixChange).toHaveBeenCalled();
    });
  });
});
