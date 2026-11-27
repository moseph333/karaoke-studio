/**
 * Stage Window
 *
 * The page a stage window shows (`/?stage=1`): the stage alone, for a second screen. It has
 * no player and loads no song. The studio's window tells it what to draw and where the song
 * is (`utils/stageLink`), and it keeps time by itself between those updates, so the lyrics
 * on the TV move with the ones in the studio. Space and the arrow keys ask the studio to
 * play, pause and seek; F fills the screen, which a browser only allows from a key or click
 * made in this window, so a prompt asks for one.
 *
 * It saves nothing: the look, colours and lines are the studio's, sent over, so two windows
 * never write the same stage settings.
 */

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LyricDisplay } from '../LyricDisplay';
import { Button } from '../ui/Button';
import { createPlaybackClock, PlaybackClockContext } from '../../hooks/usePlaybackClock';
import { useScreenWakeLock } from '../../hooks/useScreenWakeLock';
import { isInputElement } from '../../hooks/useKeyboardShortcuts';
import { getStageLook } from '../../theme/stageLooks';
import { characterShortcutsEnabled } from '../../utils/shortcutPrefs';
import {
  PAUSED_AT_START,
  openStageLink,
  transportTime,
  type StageCommand,
  type StageLink,
  type StageState,
  type StageTransport,
} from '../../utils/stageLink';

const SEEK_STEP_SEC = 5;
/** The fill-the-screen prompt leaves this long after the pointer or a key was last used. */
const PROMPT_IDLE_MS = 4000;

const kbdCls =
  'inline-flex min-w-[24px] items-center justify-center border border-current px-1.5 py-0.5 font-mono text-xs font-semibold';

interface FollowedStage {
  /** The studio window this stage came from; commands go back to it. */
  from: string;
  state: StageState;
}

export const StageWindow: React.FC = () => {
  const [stage, setStage] = useState<FollowedStage | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  );
  const [promptVisible, setPromptVisible] = useState(true);

  const [clock] = useState(createPlaybackClock);
  const transportRef = useRef<StageTransport>(PAUSED_AT_START);
  const studioRef = useRef<string | null>(null);
  const linkRef = useRef<StageLink | null>(null);

  // A TV must not dim between songs either
  useScreenWakeLock(true);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Stage · Karaoke Studio';
    return () => {
      document.title = previous;
    };
  }, []);

  // --- Following the studio -------------------------------------------------------------
  useEffect(() => {
    clock.setLiveReader(() => transportTime(transportRef.current, Date.now()));
    const follow = (transport: StageTransport) => {
      transportRef.current = transport;
      clock.setTime(transport.time, { seek: transport.seek });
      setIsPlaying(transport.isPlaying);
      setPlaybackRate(transport.rate);
    };
    const link = openStageLink((message) => {
      if (message.type === 'state') {
        if (message.state) {
          // The studio that spoke last is the one on stage
          studioRef.current = message.from;
          setStage({ from: message.from, state: message.state });
        } else if (message.from === studioRef.current) {
          studioRef.current = null;
          setStage(null);
          follow(PAUSED_AT_START);
        }
      } else if (message.type === 'transport') {
        if (message.from === studioRef.current) follow(message.transport);
      } else if (message.type === 'who') {
        link?.post({ type: 'hello' });
      }
    });
    linkRef.current = link;
    link?.post({ type: 'hello' });
    const leave = () => link?.post({ type: 'closed' });
    window.addEventListener('pagehide', leave);
    return () => {
      window.removeEventListener('pagehide', leave);
      clock.setLiveReader(null);
      link?.close();
      linkRef.current = null;
    };
  }, [clock]);

  const send = useCallback((command: StageCommand) => {
    const to = studioRef.current;
    if (to) linkRef.current?.post({ type: 'command', to, command });
  }, []);
  const togglePlay = useCallback(
    () => send({ name: transportRef.current.isPlaying ? 'pause' : 'play' }),
    [send]
  );
  const seek = useCallback((time: number) => send({ name: 'seek', time }), [send]);

  // --- Filling the screen ---------------------------------------------------------------
  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) {
      void document.exitFullscreen?.().catch(() => {});
    } else {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  // The prompt shows while the window is being set up, and gets out of the picture after
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const wake = () => {
      setPromptVisible(true);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setPromptVisible(false), PROMPT_IDLE_MS);
    };
    wake();
    window.addEventListener('mousemove', wake);
    window.addEventListener('keydown', wake);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('mousemove', wake);
      window.removeEventListener('keydown', wake);
    };
  }, []);

  // --- Keys -----------------------------------------------------------------------------
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey) return;
      if (isInputElement(e.target)) return;
      if (e.key.toLowerCase() === 'f') {
        if (e.repeat || !characterShortcutsEnabled()) return;
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === ' ') {
        // On the prompt's button, Space presses the button
        if (e.target instanceof HTMLButtonElement) return;
        e.preventDefault();
        if (!e.repeat) togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.key === 'ArrowLeft' ? -SEEK_STEP_SEC : SEEK_STEP_SEC;
        seek(Math.max(0, clock.now() + step));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clock, seek, toggleFullscreen, togglePlay]);

  const state = stage?.state;
  return (
    <PlaybackClockContext.Provider value={clock}>
      <main
        data-testid="stage-window"
        aria-label="Stage"
        className="fixed inset-0 overflow-hidden bg-theme-bg text-theme-text"
      >
        {state ? (
          <LyricDisplay
            bare
            lines={state.lines}
            duration={state.duration}
            isPlaying={isPlaying}
            playbackRate={playbackRate}
            onTogglePlay={togglePlay}
            onSeek={seek}
            albumArtUrl={state.albumArtUrl}
            artworkUrl={state.artworkUrl}
            backgroundMedia={state.backgroundMedia}
            // The spectrum is drawn from the player's sound, which only the studio's window has
            backgroundStyle={
              state.backgroundStyle === 'spectrum' ? 'artwork' : state.backgroundStyle
            }
            backgroundPalette={state.backgroundPalette}
            themeSungColor={state.sung}
            themeUnsungColor={state.unsung}
            singer2SungColor={state.singer2}
            bothSungColor={state.both}
            partNames={state.partNames}
            aspectRatio={state.aspect}
            fontSizeScale={state.fontSizeScale}
            syncMode={state.syncMode}
            selectedTheme={getStageLook(state.lookId)}
            showVisualizer={state.showVisualizer}
            showChords={state.showChordBar}
            chords={state.chords}
            semitones={state.semitones}
            keyHint={state.keyHint}
            trackTitle={state.title}
            trackArtist={state.artist}
          />
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
            <h1 className="ks-display text-[64px] font-black text-theme-text sm:text-[128px]">
              Karaoke Studio
            </h1>
            <p className="max-w-xl text-lg text-theme-text-muted">
              Open a song in the studio and its stage shows here.
            </p>
          </div>
        )}

        {!isFullscreen && promptVisible && (
          <div className="pointer-events-none absolute inset-x-0 bottom-6 z-[60] flex justify-center px-4">
            <Button
              variant="primary"
              className="pointer-events-auto min-h-[44px] gap-2"
              onClick={toggleFullscreen}
            >
              Fill this screen
              <kbd className={kbdCls}>F</kbd>
            </Button>
          </div>
        )}
      </main>
    </PlaybackClockContext.Provider>
  );
};
