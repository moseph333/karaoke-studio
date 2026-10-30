import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TransportDock } from '../components/transport/TransportDock';
import { expectTouchTarget } from './helpers/responsiveTestUtils';

describe('TransportDock', () => {
  const defaultProps = {
    masterAudioUrl: '/static/test-master.wav',
    currentTime: 15,
    duration: 120,
    isPlaying: false,
    onTogglePlay: vi.fn(),
    onSeek: vi.fn(),
  };

  beforeEach(() => {
    vi.restoreAllMocks();
    localStorage.clear();
  });

  describe('Playback surface', () => {
    it('renders a labelled transport region with formatted elapsed time and duration', () => {
      render(<TransportDock {...defaultProps} />);

      const dock = screen.getByTestId('transport-dock');
      expect(dock).toHaveAttribute('aria-label', 'Playback transport');
      expect(screen.getByTestId('transport-time')).toHaveTextContent('0:15');
      expect(screen.getByTestId('transport-duration')).toHaveTextContent('2:00');
    });

    it('toggles play/pause when the transport button is clicked', async () => {
      const user = userEvent.setup();
      const onTogglePlay = vi.fn();

      const { rerender } = render(
        <TransportDock {...defaultProps} isPlaying={false} onTogglePlay={onTogglePlay} />
      );

      const playBtn = screen.getByRole('button', { name: /start playback/i });
      expect(playBtn).toHaveAttribute('data-testid', 'transport-play-pause-btn');
      await user.click(playBtn);
      expect(onTogglePlay).toHaveBeenCalledTimes(1);

      rerender(<TransportDock {...defaultProps} isPlaying={true} onTogglePlay={onTogglePlay} />);
      expect(screen.getByRole('button', { name: /pause playback/i })).toBeInTheDocument();
    });

    it('calls onSeek(0) when the restart button is clicked', async () => {
      const user = userEvent.setup();
      const onSeek = vi.fn();
      render(<TransportDock {...defaultProps} onSeek={onSeek} />);

      await user.click(screen.getByRole('button', { name: /restart track from beginning/i }));

      expect(onSeek).toHaveBeenCalledWith(0);
    });

    it('renders exactly one native audio element bound to masterAudioUrl', () => {
      render(<TransportDock {...defaultProps} masterAudioUrl="/static/test-master.wav" />);
      const audioEls = screen.getAllByTestId('audio-element');
      expect(audioEls).toHaveLength(1);
      expect(audioEls[0].getAttribute('src')).toBe('/static/test-master.wav');
      expect(audioEls[0]).toHaveAttribute('crossorigin', 'use-credentials');
    });

    it('keeps the same audio element node when the source URL changes', () => {
      const { rerender } = render(<TransportDock {...defaultProps} />);
      const first = screen.getByTestId('audio-element');

      rerender(<TransportDock {...defaultProps} masterAudioUrl="/static/test-master-v2.wav" />);

      const second = screen.getByTestId('audio-element');
      expect(second).toBe(first);
      expect(second.getAttribute('src')).toBe('/static/test-master-v2.wav');
    });

    it('forwards the audio element to an external ref', () => {
      const audioRef = React.createRef<HTMLAudioElement>();
      render(<TransportDock {...defaultProps} audioRef={audioRef} />);
      expect(audioRef.current).toBe(screen.getByTestId('audio-element'));
    });

    it('exposes the waveform scrubber as the single timeline slider', () => {
      render(<TransportDock {...defaultProps} />);
      expect(screen.getAllByRole('slider', { name: 'Audio timeline position' })).toHaveLength(1);
      expect(screen.getByTestId('waveform-scrubber')).toBeInTheDocument();
    });

    it('publishes its rendered height as --dock-height and clears it on unmount', () => {
      const observers: Array<() => void> = [];
      const OriginalRO = window.ResizeObserver;
      window.ResizeObserver = class {
        constructor(cb: () => void) {
          observers.push(cb);
        }
        observe() {}
        unobserve() {}
        disconnect() {}
      } as unknown as typeof ResizeObserver;
      const rectSpy = vi
        .spyOn(HTMLElement.prototype, 'getBoundingClientRect')
        .mockReturnValue({ height: 132.4 } as DOMRect);

      const { unmount } = render(<TransportDock {...defaultProps} />);
      const root = document.documentElement;
      expect(root.style.getPropertyValue('--dock-height')).toBe('133px');

      rectSpy.mockReturnValue({ height: 188 } as DOMRect);
      observers.forEach((cb) => cb());
      expect(root.style.getPropertyValue('--dock-height')).toBe('188px');

      unmount();
      expect(root.style.getPropertyValue('--dock-height')).toBe('');
      window.ResizeObserver = OriginalRO;
    });

    it('keeps primary controls at touch-friendly sizes', () => {
      render(<TransportDock {...defaultProps} />);
      expectTouchTarget(screen.getByRole('button', { name: /start playback/i }));
      expectTouchTarget(screen.getByRole('button', { name: /restart track from beginning/i }));
      expectTouchTarget(screen.getByTestId('transport-key-chip'));
      expectTouchTarget(screen.getByTestId('transport-more-toggle'));
    });
  });

  describe('Key chip and secondary controls', () => {
    it('summarises the requested key and speed and opens mix settings', async () => {
      const user = userEvent.setup();
      const onOpenMixSettings = vi.fn();
      render(
        <TransportDock
          {...defaultProps}
          semitones={2}
          playbackRate={0.75}
          onOpenMixSettings={onOpenMixSettings}
        />
      );

      const chip = screen.getByTestId('transport-key-chip');
      expect(chip).toHaveAccessibleName('Open mix settings. Active key: +2 st, speed: 0.75x');
      expect(chip).toHaveTextContent('+2 st');

      await user.click(chip);
      expect(onOpenMixSettings).toHaveBeenCalledTimes(1);
    });

    it('shows the original key label at 0 semitones', () => {
      render(<TransportDock {...defaultProps} semitones={0} />);
      expect(screen.getByTestId('transport-key-chip')).toHaveTextContent('Orig key');
    });

    it('reports an in-flight re-pitch on the chip', () => {
      render(<TransportDock {...defaultProps} semitones={-3} isRemixing />);
      expect(screen.getByTestId('transport-key-chip')).toHaveTextContent('Re-pitching…');
    });

    it('expands and collapses the speed & volume drawer on small screens', async () => {
      const user = userEvent.setup();
      render(<TransportDock {...defaultProps} />);

      const toggle = screen.getByTestId('transport-more-toggle');
      const extras = screen.getByTestId('transport-extras');
      expect(toggle).toHaveAttribute('aria-controls', 'transport-extras');
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAccessibleName('Show speed and volume');
      expect(extras.className).toMatch(/\bhidden\b/);
      expect(extras.className).toMatch(/xl:flex/);

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toggle).toHaveAccessibleName('Hide speed and volume');
      expect(extras.className).not.toMatch(/\bhidden\b/);

      await user.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    });

    it('hosts the playback speed radiogroup and applies the chosen rate', async () => {
      const user = userEvent.setup();
      const onPlaybackRateChange = vi.fn();
      render(<TransportDock {...defaultProps} onPlaybackRateChange={onPlaybackRateChange} />);

      const extras = screen.getByTestId('transport-extras');
      const group = within(extras).getByRole('radiogroup', { name: 'Playback speed' });
      await user.click(within(group).getByRole('radio', { name: 'Playback speed 0.75x' }));

      expect(onPlaybackRateChange).toHaveBeenCalledWith(0.75);
      expect((screen.getByTestId('audio-element') as HTMLAudioElement).playbackRate).toBe(0.75);
    });
  });

  describe('Playback errors', () => {
    it('handles native audio onError event and displays alert with recovery retry button', async () => {
      const user = userEvent.setup();
      const onPlaybackError = vi.fn();
      const onTogglePlay = vi.fn();
      const dispatched = vi.fn();
      window.addEventListener('karaoke_audio_error', dispatched);

      render(
        <TransportDock
          {...defaultProps}
          isPlaying={true}
          onTogglePlay={onTogglePlay}
          onPlaybackError={onPlaybackError}
        />
      );

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      Object.defineProperty(audioEl, 'error', {
        value: { code: 3, message: 'Decode failed' },
        configurable: true,
        writable: true,
      });
      fireEvent.error(audioEl);

      expect(screen.getByRole('alert')).toBeInTheDocument();
      expect(screen.getByTestId('audio-error-banner')).toBeInTheDocument();
      expect(screen.getByText(/MEDIA_ERR_DECODE/i)).toBeInTheDocument();
      expect(screen.getByText(/Audio decoding failed/i)).toBeInTheDocument();
      expect(onTogglePlay).toHaveBeenCalledTimes(1);
      expect(onPlaybackError).toHaveBeenCalledWith(
        expect.objectContaining({ code: 3, codeName: 'MEDIA_ERR_DECODE' })
      );
      expect(dispatched).toHaveBeenCalledTimes(1);
      window.removeEventListener('karaoke_audio_error', dispatched);

      await user.click(screen.getByRole('button', { name: /retry playback/i }));

      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(audioEl.load).toHaveBeenCalled();
      expect(audioEl.play).toHaveBeenCalled();
    });

    it('dismisses the playback error banner when playback resumes (onPlay)', () => {
      render(<TransportDock {...defaultProps} />);
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
      render(<TransportDock {...defaultProps} />);
      const audioEl = screen.getByTestId('audio-element');

      Object.defineProperty(audioEl, 'error', {
        value: { code: 2, message: 'Network dropped' },
        configurable: true,
        writable: true,
      });
      fireEvent.error(audioEl);
      expect(screen.getByText(/Network error loading audio stream/i)).toBeInTheDocument();

      Object.defineProperty(audioEl, 'error', {
        value: { code: 4, message: 'Format not supported' },
        configurable: true,
        writable: true,
      });
      fireEvent.error(audioEl);
      expect(screen.getByText(/Audio format not supported/i)).toBeInTheDocument();
    });

    it('clears a stale error when the master source changes', () => {
      const { rerender } = render(<TransportDock {...defaultProps} />);
      const audioEl = screen.getByTestId('audio-element');
      Object.defineProperty(audioEl, 'error', {
        value: { code: 2, message: 'Network dropped' },
        configurable: true,
        writable: true,
      });
      fireEvent.error(audioEl);
      expect(screen.getByTestId('audio-error-banner')).toBeInTheDocument();

      rerender(<TransportDock {...defaultProps} masterAudioUrl="/static/remix.wav" />);
      expect(screen.queryByTestId('audio-error-banner')).not.toBeInTheDocument();
    });
  });

  describe('Master volume & mute', () => {
    it('renders master volume slider and mute toggle button with initial defaults', () => {
      render(<TransportDock {...defaultProps} />);

      const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
      expect(slider.min).toBe('0');
      expect(slider.max).toBe('1');
      expect(slider.step).toBe('0.01');
      expect(slider.value).toBe('1');
      expect(screen.getAllByText('100%').length).toBeGreaterThanOrEqual(1);

      const muteBtn = screen.getByRole('button', { name: /mute audio/i });
      expect(muteBtn).toHaveAttribute('aria-pressed', 'false');

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      expect(audioEl.volume).toBe(1.0);
      expect(audioEl.muted).toBe(false);
    });

    it('updates volume slider, modifies audio.volume, and calls onVolumeChange', () => {
      const onVolumeChange = vi.fn();
      render(<TransportDock {...defaultProps} onVolumeChange={onVolumeChange} />);

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
      const user = userEvent.setup();
      const onMuteChange = vi.fn();
      render(<TransportDock {...defaultProps} onMuteChange={onMuteChange} initialVolume={0.8} />);

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      await user.click(screen.getByRole('button', { name: /mute audio/i }));

      expect(audioEl.muted).toBe(true);
      expect(onMuteChange).toHaveBeenCalledWith(true);
      expect(localStorage.getItem('karaoke_master_muted')).toBe('true');
      expect(screen.getByRole('button', { name: /unmute audio/i })).toHaveAttribute(
        'aria-pressed',
        'true'
      );
      expect(screen.getByText('Muted')).toBeInTheDocument();
    });

    it('smart unmutes and restores the previous non-zero volume', async () => {
      const user = userEvent.setup();
      const onVolumeChange = vi.fn();
      const onMuteChange = vi.fn();
      render(
        <TransportDock
          {...defaultProps}
          initialVolume={0.75}
          onVolumeChange={onVolumeChange}
          onMuteChange={onMuteChange}
        />
      );

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      await user.click(screen.getByRole('button', { name: /mute audio/i }));
      expect(audioEl.muted).toBe(true);

      await user.click(screen.getByRole('button', { name: /unmute audio/i }));
      expect(audioEl.muted).toBe(false);
      expect(audioEl.volume).toBe(0.75);
      expect(screen.getByText('75%')).toBeInTheDocument();
      expect(onVolumeChange).toHaveBeenCalledWith(0.75);
      expect(onMuteChange).toHaveBeenCalledWith(false);
    });

    it('auto-unmutes when adjusting the volume slider while muted', () => {
      const onMuteChange = vi.fn();
      render(
        <TransportDock
          {...defaultProps}
          initialVolume={0.6}
          initialMuted={true}
          onMuteChange={onMuteChange}
        />
      );

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      expect(audioEl.muted).toBe(true);

      fireEvent.change(screen.getByRole('slider', { name: /master volume/i }), {
        target: { value: '0.85' },
      });

      expect(audioEl.muted).toBe(false);
      expect(audioEl.volume).toBe(0.85);
      expect(screen.getByText('85%')).toBeInTheDocument();
      expect(onMuteChange).toHaveBeenCalledWith(false);
    });

    it('syncs state when the native volumechange event fires', () => {
      const onVolumeChange = vi.fn();
      const onMuteChange = vi.fn();
      render(
        <TransportDock
          {...defaultProps}
          onVolumeChange={onVolumeChange}
          onMuteChange={onMuteChange}
        />
      );

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
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

      render(<TransportDock {...defaultProps} />);

      const slider = screen.getByRole('slider', { name: /master volume/i }) as HTMLInputElement;
      expect(slider.value).toBe('0.62');
      expect(screen.getByRole('button', { name: /unmute audio/i })).toBeInTheDocument();

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      expect(audioEl.volume).toBe(0.62);
      expect(audioEl.muted).toBe(true);
    });

    it('responds to the global karaoke_toggle_mute event (M shortcut)', () => {
      const onMuteChange = vi.fn();
      render(<TransportDock {...defaultProps} onMuteChange={onMuteChange} initialVolume={0.9} />);

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      expect(audioEl.muted).toBe(false);

      window.dispatchEvent(new CustomEvent('karaoke_toggle_mute'));

      expect(audioEl.muted).toBe(true);
      expect(onMuteChange).toHaveBeenCalledWith(true);
    });

    it('re-applies volume and muted state when masterAudioUrl changes', () => {
      const { rerender } = render(
        <TransportDock {...defaultProps} initialVolume={0.4} initialMuted={true} />
      );

      const audioEl = screen.getByTestId('audio-element') as HTMLAudioElement;
      expect(audioEl.volume).toBe(0.4);
      expect(audioEl.muted).toBe(true);

      rerender(
        <TransportDock
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
  });
});
