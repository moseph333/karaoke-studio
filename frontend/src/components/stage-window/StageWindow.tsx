/**
 * Stage Window
 *
 * The page a stage window shows (`/?stage=1`): the stage alone, for a second screen. It has
 * no sign-in and loads no song. The studio's window tells it what to draw and where the song
 * is (`utils/stageLink`), and it keeps time by itself between those updates, so the lyrics
 * on the TV move with the ones in the studio. Space and the arrow keys ask the studio to
 * play, pause and seek; F fills the screen, which a browser only allows from a key or click
 * made in this window, so a prompt asks for one.
 *
 * A show's host screen (`/?show=1`) also sends a `scene`: a card between singers, or a
 * karaoke video, which plays here (`StageVideo`) and reports back to the host. With a scene
 * of `lyrics`, or none, the window shows the lyrics stage it is sent.
 *
 * Several windows may send a stage: two studio tabs, or a studio tab beside a show. Each
 * sender's stage is kept apart. While a show's scene is on, the stage drawn is the one the
 * host itself sends (its messages carry the host's name) and no other, so a song open in a
 * studio tab never replaces the singer's lyrics. Without a show it is the studio that spoke
 * last.
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
  type PlayerReport,
  type StageCommand,
  type StageLink,
  type StageScene,
  type StageState,
  type StageTransport,
} from '../../utils/stageLink';
import { ShowIdleCard, StudioIdleCard, UpNextCard } from './StageCards';
import { FileVideo, YouTubeVideo, type StageVideoHandle } from './StageVideo';

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

interface HostedScene {
  /** The show's host window; a video's reports go back to it. */
  from: string;
  scene: StageScene;
}

export const StageWindow: React.FC = () => {
  const [stage, setStage] = useState<FollowedStage | null>(null);
  const [hosted, setHosted] = useState<HostedScene | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(
    () => typeof document !== 'undefined' && Boolean(document.fullscreenElement)
  );
  const [promptVisible, setPromptVisible] = useState(true);

  const [clock] = useState(createPlaybackClock);
  const transportRef = useRef<StageTransport>(PAUSED_AT_START);
  /** Every sender's stage, the one that spoke last at the end; and where each one's song is. */
  const stagesRef = useRef(new Map<string, FollowedStage>());
  const transportsRef = useRef(new Map<string, StageTransport>());
  /** The sender whose stage is drawn; commands go back to it. */
  const studioRef = useRef<string | null>(null);
  const hostRef = useRef<string | null>(null);
  const linkRef = useRef<StageLink | null>(null);
  const videoRef = useRef<StageVideoHandle>(null);

  // A TV must not dim between songs either
  useScreenWakeLock(true);

  useEffect(() => {
    const previous = document.title;
    document.title = 'Stage · Karaoke Studio';
    return () => {
      document.title = previous;
    };
  }, []);

  // --- Following the studio, and a show's host --------------------------------------------
  useEffect(() => {
    clock.setLiveReader(() => transportTime(transportRef.current, Date.now()));
    const follow = (transport: StageTransport) => {
      transportRef.current = transport;
      clock.setTime(transport.time, { seek: transport.seek });
      setIsPlaying(transport.isPlaying);
      setPlaybackRate(transport.rate);
    };
    // Whose stage is drawn: the host's own while a show's scene is on, else the studio that
    // spoke last. A show's song whose stage has not arrived yet draws nothing for that moment
    const lead = () => {
      const stages = stagesRef.current;
      const from = hostRef.current ?? Array.from(stages.keys()).pop() ?? null;
      const drawn = (from && stages.get(from)) || null;
      setStage(drawn);
      const leader = drawn?.from ?? null;
      if (leader === studioRef.current) return;
      studioRef.current = leader;
      follow((leader && transportsRef.current.get(leader)) || PAUSED_AT_START);
    };
    const link = openStageLink((message) => {
      if (message.type === 'state') {
        // Set again, a sender goes to the end: it is the one that spoke last
        stagesRef.current.delete(message.from);
        if (message.state) {
          stagesRef.current.set(message.from, { from: message.from, state: message.state });
        } else {
          transportsRef.current.delete(message.from);
        }
        lead();
      } else if (message.type === 'transport') {
        transportsRef.current.set(message.from, message.transport);
        if (message.from === studioRef.current) follow(message.transport);
      } else if (message.type === 'scene') {
        if (message.scene) {
          hostRef.current = message.from;
          setHosted({ from: message.from, scene: message.scene });
          lead();
        } else if (message.from === hostRef.current) {
          hostRef.current = null;
          setHosted(null);
          lead();
        }
      } else if (message.type === 'player') {
        if (message.from === hostRef.current) videoRef.current?.command(message.command);
      } else if (message.type === 'who') {
        link?.post({ type: 'hello' });
      } else if (message.type === 'ping') {
        // Still here: a host that hears nothing for a while takes this window to be gone
        link?.post({ type: 'pong', to: message.from });
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
  const report = useCallback((update: PlayerReport) => {
    const to = hostRef.current;
    if (to) linkRef.current?.post({ type: 'report', to, report: update });
  }, []);

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
  const scene = hosted?.scene ?? null;
  const showsVideo = scene?.kind === 'youtube' || scene?.kind === 'file';
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
        if (e.repeat) return;
        // A video plays in this window; a song plays in the studio's
        if (showsVideo) videoRef.current?.toggle();
        else togglePlay();
      } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        const step = e.key === 'ArrowLeft' ? -SEEK_STEP_SEC : SEEK_STEP_SEC;
        if (showsVideo) videoRef.current?.nudge(step);
        else seek(Math.max(0, clock.now() + step));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [clock, seek, showsVideo, toggleFullscreen, togglePlay]);

  const state = stage?.state;
  // A show's cards and videos take the stage; otherwise it is the lyrics stage, when sent
  let content: React.ReactNode;
  if (scene?.kind === 'youtube') {
    content = (
      <YouTubeVideo
        key={`${scene.videoId}:${scene.play}`}
        ref={videoRef}
        videoId={scene.videoId}
        play={scene.play}
        at={scene.at}
        onReport={report}
      />
    );
  } else if (scene?.kind === 'file') {
    content = (
      <FileVideo
        key={`${scene.url}:${scene.play}`}
        ref={videoRef}
        url={scene.url}
        play={scene.play}
        at={scene.at}
        onReport={report}
      />
    );
  } else if (scene?.kind === 'upnext') {
    content = <UpNextCard title={scene.title} now={scene.now} next={scene.next} />;
  } else if (scene?.kind === 'idle') {
    content = <ShowIdleCard title={scene.title} next={scene.next} />;
  } else if (state) {
    content = (
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
        backgroundStyle={state.backgroundStyle === 'spectrum' ? 'artwork' : state.backgroundStyle}
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
    );
  } else {
    // A show's song whose stage has not arrived yet stays dark for that moment
    content = scene ? null : <StudioIdleCard />;
  }

  return (
    <PlaybackClockContext.Provider value={clock}>
      <main
        data-testid="stage-window"
        data-scene={scene?.kind ?? (state ? 'lyrics' : 'none')}
        aria-label="Stage"
        className="fixed inset-0 overflow-hidden bg-theme-bg text-theme-text"
      >
        {content}

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
