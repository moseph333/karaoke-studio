/**
 * Media Session: OS metadata, media-key handlers, playback/position state, cleanup, and the
 * transport dock mapping previous/next track to lyric lines.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, renderHook, act } from '@testing-library/react';
import { useMediaSession, UseMediaSessionOptions } from '../../hooks/useMediaSession';
import { TransportDock } from '../../components/transport/TransportDock';

type Handler = (details: Partial<MediaSessionActionDetails>) => void;

interface FakeSession {
  metadata: unknown;
  playbackState: MediaSessionPlaybackState;
  handlers: Map<string, Handler | null>;
  setActionHandler: ReturnType<typeof vi.fn>;
  setPositionState: ReturnType<typeof vi.fn>;
}

let session: FakeSession;
const originalMediaSession = Object.getOwnPropertyDescriptor(window.navigator, 'mediaSession');
const originalMetadata = (globalThis as Record<string, unknown>).MediaMetadata;

beforeEach(() => {
  const handlers = new Map<string, Handler | null>();
  session = {
    metadata: null,
    playbackState: 'none',
    handlers,
    setActionHandler: vi.fn((action: string, handler: Handler | null) => {
      if (action === 'skipad') throw new Error('unsupported');
      handlers.set(action, handler);
    }),
    setPositionState: vi.fn(),
  };
  Object.defineProperty(window.navigator, 'mediaSession', { configurable: true, value: session });
  (globalThis as Record<string, unknown>).MediaMetadata = class {
    constructor(init: Record<string, unknown>) {
      Object.assign(this, init);
    }
  };
});

afterEach(() => {
  if (originalMediaSession) {
    Object.defineProperty(window.navigator, 'mediaSession', originalMediaSession);
  } else {
    delete (window.navigator as unknown as Record<string, unknown>).mediaSession;
  }
  (globalThis as Record<string, unknown>).MediaMetadata = originalMetadata;
});

const baseOptions = (overrides: Partial<UseMediaSessionOptions> = {}): UseMediaSessionOptions => ({
  enabled: true,
  title: 'Neon Skyline',
  artist: 'The Midnight Static',
  artworkUrl: '/static/thumbs/neon.jpg',
  isPlaying: false,
  duration: 120,
  playbackRate: 1,
  getCurrentTime: () => 30,
  onPlay: vi.fn(),
  onPause: vi.fn(),
  onSeek: vi.fn(),
  onPreviousLine: vi.fn(),
  onNextLine: vi.fn(),
  ...overrides,
});

describe('useMediaSession', () => {
  it('publishes song metadata with an absolute artwork URL', () => {
    renderHook(() => useMediaSession(baseOptions()));
    expect(session.metadata).toMatchObject({
      title: 'Neon Skyline',
      artist: 'The Midnight Static',
      album: 'Karaoke Studio',
      artwork: [{ src: new URL('/static/thumbs/neon.jpg', window.location.href).href }],
    });
  });

  it('routes media keys to the transport', () => {
    const opts = baseOptions();
    renderHook(() => useMediaSession(opts));
    const fire = (action: string, details: Partial<MediaSessionActionDetails> = {}) =>
      act(() =>
        session.handlers.get(action)?.({ action: action as MediaSessionAction, ...details })
      );

    fire('play');
    expect(opts.onPlay).toHaveBeenCalledTimes(1);
    fire('pause');
    fire('stop');
    expect(opts.onPause).toHaveBeenCalledTimes(2);
    fire('seekto', { seekTime: 42 });
    expect(opts.onSeek).toHaveBeenLastCalledWith(42);
    fire('seekbackward');
    expect(opts.onSeek).toHaveBeenLastCalledWith(20);
    fire('seekforward', { seekOffset: 100 });
    expect(opts.onSeek).toHaveBeenLastCalledWith(120);
    fire('previoustrack');
    expect(opts.onPreviousLine).toHaveBeenCalledTimes(1);
    fire('nexttrack');
    expect(opts.onNextLine).toHaveBeenCalledTimes(1);
  });

  it('reports playback and position state as playback changes', () => {
    const { rerender } = renderHook((props: UseMediaSessionOptions) => useMediaSession(props), {
      initialProps: baseOptions(),
    });
    expect(session.playbackState).toBe('paused');
    expect(session.setPositionState).toHaveBeenLastCalledWith({
      duration: 120,
      playbackRate: 1,
      position: 30,
    });

    rerender(baseOptions({ isPlaying: true, playbackRate: 1.25 }));
    expect(session.playbackState).toBe('playing');
    expect(session.setPositionState).toHaveBeenLastCalledWith({
      duration: 120,
      playbackRate: 1.25,
      position: 30,
    });
  });

  it('skips position updates until the duration is known', () => {
    renderHook(() => useMediaSession(baseOptions({ duration: 0 })));
    expect(session.setPositionState).not.toHaveBeenCalled();
  });

  it('clears everything when disabled or unmounted', () => {
    const { unmount } = renderHook(() => useMediaSession(baseOptions({ isPlaying: true })));
    unmount();
    expect(session.metadata).toBeNull();
    expect(session.playbackState).toBe('none');
    for (const action of ['play', 'pause', 'seekto', 'nexttrack']) {
      expect(session.handlers.get(action)).toBeNull();
    }
  });

  it('does nothing when the browser has no Media Session API', () => {
    delete (window.navigator as unknown as Record<string, unknown>).mediaSession;
    expect(() => renderHook(() => useMediaSession(baseOptions()))).not.toThrow();
  });
});

describe('TransportDock media keys', () => {
  it('maps previous/next track to lyric lines and seeks refresh the OS position', () => {
    const onSeek = vi.fn();
    const audioRef = React.createRef<HTMLAudioElement>();
    render(
      <TransportDock
        masterAudioUrl="/static/output/master.wav"
        lines={[
          { id: 1, text: 'One', start_time: 2, end_time: 5 },
          { id: 2, text: 'Two', start_time: 8, end_time: 11 },
          { id: 3, text: 'Three', start_time: 14, end_time: 18 },
        ]}
        currentTime={9}
        duration={60}
        isPlaying={false}
        onTogglePlay={vi.fn()}
        onSeek={onSeek}
        audioRef={audioRef}
        mediaTitle="Neon Skyline"
      />
    );
    const audio = audioRef.current as HTMLAudioElement;
    audio.currentTime = 9;

    act(() => session.handlers.get('nexttrack')?.({ action: 'nexttrack' }));
    expect(onSeek).toHaveBeenLastCalledWith(14);
    act(() => session.handlers.get('previoustrack')?.({ action: 'previoustrack' }));
    expect(onSeek).toHaveBeenLastCalledWith(2);
    expect(session.metadata).toMatchObject({ title: 'Neon Skyline' });

    session.setPositionState.mockClear();
    act(() => {
      audio.dispatchEvent(new Event('seeked'));
    });
    expect(session.setPositionState).toHaveBeenCalledWith(
      expect.objectContaining({ duration: 60, position: 9 })
    );
  });
});
