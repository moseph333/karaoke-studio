/**
 * Live Lyric Display & Fullscreen TV Stage Preview Component
 *
 * The live stage: a frame of the video in the chosen look (StageFrame draws the scene
 * utils/stageScene gives for the song time, so a paused stage is the video's frame at that
 * moment), with the toolbar in a row above it, the chord bar over it, and the fullscreen TV
 * stage with auto-hiding controls.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LyricLine, ChordSegment, SyncDisplayMode, PartNames } from '../types';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import { usePlaybackClock, usePlaybackTime } from '../hooks/usePlaybackClock';
import { useIsVisible } from '../hooks/useIsVisible';
import { isInputElement, isModalActive } from '../hooks/useKeyboardShortcuts';
import { characterShortcutsEnabled } from '../utils/shortcutPrefs';
import {
  DEFAULT_STAGE_LOOK_ID,
  frameSize,
  getStageLook,
  type StageLook,
} from '../theme/stageLooks';
import { planStage, sceneAt, type StageStyle } from '../utils/stageScene';
import { BeatVisualizer } from './BeatVisualizer';
import { StageBackground, StageBackgroundMedia } from './stage/StageBackground';
import type { StageBackgroundStyle } from '../theme/stageBackgrounds';
import { StageToolbar } from './stage/StageToolbar';
import { StageFrame } from './stage/StageFrame';
import { StageFloatingControls } from './stage/StageFloatingControls';
import { ChordBar } from './ChordBar';
import { cn } from '../utils/cn';
import { useRegisterCommands } from './commandPalette/context';
import { Maximize, Minimize } from 'lucide-react';

export interface LyricDisplayProps {
  lines: LyricLine[];
  /** Song position; omit to follow the playback clock (as the app does). */
  currentTime?: number;
  duration?: number;
  isPlaying?: boolean;
  playbackRate?: number;
  audioRef?: React.RefObject<HTMLAudioElement>;
  onSeek?: (time: number) => void;
  onTogglePlay?: () => void;
  albumArtUrl?: string;
  /** Custom background image/video shown behind the lyrics (replaces album art). */
  backgroundMedia?: StageBackgroundMedia | null;
  /** The cover art as exports draw it (the backdrop route); used instead of albumArtUrl. */
  artworkUrl?: string;
  /** What the stage shows behind the lyrics (cover art when omitted). */
  backgroundStyle?: StageBackgroundStyle;
  /** Aurora and spectrum colours. */
  backgroundPalette?: [string, string, string];
  themeSungColor?: string;
  themeUnsungColor?: string;
  singer2SungColor?: string;
  bothSungColor?: string;
  /** Names the song gave its singer parts (project.part_names). */
  partNames?: PartNames | null;
  className?: string;
  aspectRatio?: string;
  fontSizeScale?: number;
  showVisualizer?: boolean;
  onToggleVisualizer?: () => void;
  analyserNode?: AnalyserNode | null;
  // Harmonic Chord Bar (Requirement R2)
  chords?: ChordSegment[];
  showChords?: boolean;
  showChordBar?: boolean;
  onToggleChordBar?: () => void;
  semitones?: number;
  keyHint?: string | null;
  onEditChord?: (index: number, newChord: string) => void;
  // Sync Display Mode (Requirements R1, R2)
  syncMode?: SyncDisplayMode;
  onToggleSyncMode?: () => void;
  onSyncModeChange?: (mode: SyncDisplayMode) => void;
  /** The look the stage is drawn in (the default look when omitted). */
  selectedTheme?: StageLook;
  // Stage controls
  onSemitonesChange?: (semitones: number) => void;
  onPitchStep?: (delta: number) => void;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
  /** The song's title and artist, shown on the opening title card and the end card. */
  trackTitle?: string;
  trackArtist?: string;
}

/** Card text: blank values, and the backend's placeholder artist, are left out. */
function cardText(value: string | undefined, placeholder?: string): string {
  const text = value?.trim();
  if (!text) return '';
  if (placeholder && text.toLowerCase() === placeholder.toLowerCase()) return '';
  return text;
}

const LyricDisplayView: React.FC<LyricDisplayProps> = ({
  lines,
  currentTime,
  duration = 0,
  isPlaying = false,
  playbackRate = 1.0,
  audioRef,
  onSeek,
  onTogglePlay,
  albumArtUrl,
  backgroundMedia,
  artworkUrl,
  backgroundStyle,
  backgroundPalette,
  themeSungColor,
  themeUnsungColor,
  singer2SungColor,
  bothSungColor,
  partNames,
  className = '',
  aspectRatio = '16:9',
  fontSizeScale = 1.0,
  showVisualizer,
  onToggleVisualizer,
  analyserNode,
  chords,
  showChords,
  showChordBar,
  onToggleChordBar,
  semitones = 0,
  keyHint,
  onEditChord,
  syncMode = 'word',
  onToggleSyncMode,
  onSyncModeChange,
  selectedTheme,
  onSemitonesChange,
  onPitchStep,
  volume,
  onVolumeChange,
  isMuted,
  onToggleMute,
  trackTitle,
  trackArtist,
}) => {
  const look = selectedTheme ?? getStageLook(DEFAULT_STAGE_LOOK_ID);
  const aspect = aspectRatio === '9:16' ? '9:16' : '16:9';
  // The video's visualizer is 240 px tall in a frame whose short side is 1080 px (100 u), on
  // the bottom edge of the picture
  const pictureHeight = look.frames[aspect].picture?.h ?? frameSize(aspect).height;
  const visualizerShare = Math.min(1, 240 / 10.8 / pictureHeight);
  const sungColor = themeSungColor ?? look.palette.sung;
  const unsungColor = themeUnsungColor ?? look.palette.unsung;
  // The colour that marks the look's words (the words to sing, in a look that dims the sung)
  const leadColor = look.emphasis === 'unsung' ? unsungColor : sungColor;
  const singer2Color = singer2SungColor ?? look.palette.singer2;
  const bothColor = bothSungColor ?? look.palette.both;

  // --- Key (fullscreen steppers) -------------------------------------------------
  const [internalSemitones, setInternalSemitones] = useState(semitones);
  useEffect(() => {
    setInternalSemitones(semitones);
  }, [semitones]);
  const effectiveSemitones = semitones !== undefined ? semitones : internalSemitones;

  const stepPitch = useCallback(
    (delta: number) => {
      const next = Math.max(-12, Math.min(12, effectiveSemitones + delta));
      setInternalSemitones(next);
      onSemitonesChange?.(next);
      onPitchStep?.(delta);
    },
    [effectiveSemitones, onSemitonesChange, onPitchStep]
  );

  // --- Stage volume (fullscreen) ---------------------------------------------------
  const [internalVolume, setInternalVolume] = useState<number>(volume ?? 1);
  const [internalMuted, setInternalMuted] = useState<boolean>(isMuted ?? false);

  useEffect(() => {
    if (volume !== undefined) setInternalVolume(volume);
  }, [volume]);

  useEffect(() => {
    if (isMuted !== undefined) setInternalMuted(isMuted);
  }, [isMuted]);

  const effectiveVolume = volume !== undefined ? volume : internalVolume;
  const effectiveMuted = isMuted !== undefined ? isMuted : internalMuted;

  const handleToggleStageMute = useCallback(() => {
    const nextMuted = !effectiveMuted;
    setInternalMuted(nextMuted);
    if (audioRef?.current) audioRef.current.muted = nextMuted;
    onToggleMute?.();
  }, [effectiveMuted, audioRef, onToggleMute]);

  const handleStageVolumeChange = useCallback(
    (val: number) => {
      setInternalVolume(val);
      if (effectiveMuted && val > 0) {
        setInternalMuted(false);
        if (audioRef?.current) audioRef.current.muted = false;
      }
      if (audioRef?.current) audioRef.current.volume = val;
      onVolumeChange?.(val);
    },
    [effectiveMuted, audioRef, onVolumeChange]
  );

  // --- View toggles -------------------------------------------------------------------
  const [internalSyncMode, setInternalSyncMode] = useState<SyncDisplayMode>(syncMode);
  const activeSyncMode = syncMode !== undefined ? syncMode : internalSyncMode;

  const handleSyncModeChange = useCallback(
    (nextMode: SyncDisplayMode) => {
      if (nextMode === activeSyncMode) return;
      if (onSyncModeChange) {
        onSyncModeChange(nextMode);
      } else if (onToggleSyncMode) {
        onToggleSyncMode();
      } else {
        setInternalSyncMode(nextMode);
      }
    },
    [activeSyncMode, onSyncModeChange, onToggleSyncMode]
  );

  const [internalShowViz, setInternalShowViz] = useState(false);
  const isVisualizerActive = showVisualizer !== undefined ? showVisualizer : internalShowViz;
  const toggleInternalViz = useCallback(() => setInternalShowViz((v) => !v), []);
  const handleToggleVisualizer = onToggleVisualizer || toggleInternalViz;

  const [internalShowChordBar, setInternalShowChordBar] = useState(false);
  const isChordBarVisible =
    showChords !== undefined
      ? showChords
      : showChordBar !== undefined
        ? showChordBar
        : internalShowChordBar;
  const toggleInternalChordBar = useCallback(() => setInternalShowChordBar((v) => !v), []);
  const handleToggleChordBar = onToggleChordBar || toggleInternalChordBar;

  // --- Fullscreen & auto-hiding controls -------------------------------------------
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Frame-rate work (the sweep clock, visualizer, moving backgrounds) stops while the stage
  // is off screen, as on the phone's Timeline and Mix tabs where it stays mounted but hidden;
  // so does following the playback clock, which is read again when the stage reappears
  const isOnScreen = useIsVisible(stageRef);
  const isAnimating = isPlaying && isOnScreen;
  const clock = usePlaybackClock();
  const anchorTime = usePlaybackTime(currentTime, { live: isOnScreen });
  const effectiveTime = useInterpolatedTime({
    currentTime: anchorTime,
    isPlaying: isAnimating,
    playbackRate,
    audioRef,
    getLiveTime: currentTime === undefined ? clock?.now : undefined,
  });

  const resetIdleTimer = useCallback(() => {
    setShowControls(true);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (isPlaying && isFullscreen) {
      idleTimerRef.current = setTimeout(() => setShowControls(false), 3000);
    }
  }, [isPlaying, isFullscreen]);

  // Keep controls always visible while paused
  useEffect(() => {
    if (!isPlaying) {
      setShowControls(true);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
    } else if (isFullscreen) {
      resetIdleTimer();
    }
    return () => {
      if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    };
  }, [isPlaying, isFullscreen, resetIdleTimer]);

  const toggleFullscreen = useCallback(async () => {
    const nextState = !isFullscreen;
    setIsFullscreen(nextState);
    setShowControls(true);
    try {
      if (nextState) {
        if (stageRef.current?.requestFullscreen) {
          await stageRef.current.requestFullscreen().catch(() => {});
        }
      } else if (typeof document !== 'undefined' && document.fullscreenElement) {
        await document.exitFullscreen().catch(() => {});
      }
    } catch {
      // Pseudo-fullscreen keeps working without the native Fullscreen API
    }
  }, [isFullscreen]);

  useRegisterCommands('stage-fullscreen', [
    {
      id: 'stage-fullscreen',
      title: isFullscreen ? 'Exit fullscreen stage' : 'Enter fullscreen stage',
      group: 'Stage',
      icon: isFullscreen ? <Minimize /> : <Maximize />,
      shortcut: ['F'],
      keywords: ['tv', 'big screen', 'present'],
      run: toggleFullscreen,
    },
  ]);

  // Sync state when the user leaves native fullscreen (Esc / F11)
  useEffect(() => {
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement && isFullscreen) setIsFullscreen(false);
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen]);

  // The studio passes no volume or mute, so the fullscreen controls show the player's own:
  // read when the stage goes fullscreen and followed from there (the transport dock or the
  // M shortcut may change it). The player is the one `<audio>` element both controls set.
  const ownsVolume = volume === undefined && isMuted === undefined;
  useEffect(() => {
    const el = audioRef?.current;
    if (!ownsVolume || !isFullscreen || !el) return;
    const follow = () => {
      setInternalVolume(el.volume);
      setInternalMuted(el.muted);
    };
    follow();
    el.addEventListener('volumechange', follow);
    return () => el.removeEventListener('volumechange', follow);
  }, [ownsVolume, isFullscreen, audioRef]);

  // 'F' toggles the fullscreen stage, 'Escape' exits
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Any key brings the hidden fullscreen controls back, so keyboard users see focus
      if (isFullscreen) resetIdleTimer();
      if (e.defaultPrevented || isInputElement(e.target)) return;

      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        // Not behind a dialog: fullscreen would cover it
        if (e.repeat || isModalActive() || !characterShortcutsEnabled()) return;
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFullscreen, isFullscreen, resetIdleTimer]);

  // KTV's typeface draws Japanese itself; its 118 slices are declared only once the look is
  // on, and each is fetched only when one of its characters is on the stage
  const needsJapaneseFace = look.id === 'ktv';
  useEffect(() => {
    if (needsJapaneseFace) void import('../stageFonts.ktv.css');
  }, [needsJapaneseFace]);

  // --- The scene ------------------------------------------------------------------------
  // Where every line goes is worked out once per song and style; each frame only asks what
  // is on the stage at that time
  const style = useMemo<StageStyle>(
    () => ({
      look,
      aspect,
      sung: sungColor,
      unsung: unsungColor,
      singer2: singer2Color,
      both: bothColor,
      scale: fontSizeScale,
      syncMode: activeSyncMode,
      cues: true,
      partNames,
    }),
    [
      look,
      aspect,
      sungColor,
      unsungColor,
      singer2Color,
      bothColor,
      fontSizeScale,
      activeSyncMode,
      partNames,
    ]
  );
  const cardTitle = cardText(trackTitle);
  const cardArtist = cardText(trackArtist, 'Unknown Artist');
  const plan = useMemo(
    () => planStage(lines, duration, style, { title: cardTitle, artist: cardArtist }),
    [lines, duration, style, cardTitle, cardArtist]
  );
  const scene = sceneAt(plan, effectiveTime);

  const containerClasses = isFullscreen
    ? cn(
        'fixed inset-0 z-50 flex h-screen w-screen flex-col overflow-hidden bg-theme-bg font-theme-heading text-theme-text',
        !showControls && 'cursor-none'
      )
    : cn(
        'relative flex select-none flex-col font-theme-heading text-theme-text',
        aspect === '9:16'
          ? 'ks-stage-fit-phone-portrait mx-auto max-w-xs md:ks-stage-fit-portrait'
          : 'w-full md:mx-auto md:ks-stage-fit',
        className
      );
  // The screen is the video's shape inline; fullscreen it takes what the display has and the
  // frame sits centred in it
  const screenClasses = isFullscreen
    ? 'relative min-h-0 flex-1'
    : cn(
        'relative overflow-hidden border border-theme-border-subtle',
        aspect === '9:16' ? 'aspect-[9/16]' : 'aspect-video'
      );
  // The export's own cover-art still already has the look's picture frame in it; every other
  // background is drawn inside that frame
  const movingArt = !backgroundMedia && backgroundStyle === 'drift';
  const stillArt = !backgroundMedia && (backgroundStyle ?? 'artwork') === 'artwork';

  return (
    <div
      ref={stageRef}
      data-testid="lyric-display-stage"
      data-guide="stage"
      data-fullscreen={isFullscreen ? 'true' : 'false'}
      data-sync-mode={activeSyncMode}
      data-tone={look.tone}
      data-look={look.id}
      onMouseMove={resetIdleTimer}
      onClick={resetIdleTimer}
      onFocus={resetIdleTimer}
      className={containerClasses}
    >
      <StageToolbar
        isFullscreen={isFullscreen}
        visible={!isFullscreen || showControls}
        syncMode={activeSyncMode}
        onSyncModeChange={handleSyncModeChange}
        isVisualizerActive={isVisualizerActive}
        onToggleVisualizer={handleToggleVisualizer}
        isChordBarVisible={isChordBarVisible}
        onToggleChordBar={handleToggleChordBar}
        onToggleFullscreen={toggleFullscreen}
      />

      <div
        data-testid="stage-screen"
        className={screenClasses}
        style={{ backgroundColor: look.palette.ground }}
      >
        <StageFrame
          look={look}
          aspect={aspect}
          scene={scene}
          time={effectiveTime}
          onSeek={onSeek}
          pictureOnly={!(stillArt && Boolean(artworkUrl))}
        >
          <StageBackground
            baseColor={look.palette.ground}
            albumArtUrl={albumArtUrl}
            artworkUrl={artworkUrl}
            media={backgroundMedia}
            mediaTreatment={look.art.upload}
            tone={look.tone}
            style={backgroundStyle}
            // Only moving styles use the time; a still background then skips frame re-renders
            time={
              movingArt || (!backgroundMedia && backgroundStyle === 'aurora') ? effectiveTime : 0
            }
            palette={backgroundPalette}
            aspect={aspect}
            analyserNode={analyserNode}
            isPlaying={isAnimating}
          />
          {isVisualizerActive && (
            // The band the video draws its bars in: the bottom 240 px of the picture
            <div
              data-testid="stage-visualizer-band"
              className="pointer-events-none absolute inset-x-0 bottom-0"
              style={{ height: `${(visualizerShare * 100).toFixed(2)}%` }}
            >
              <BeatVisualizer
                analyserNode={analyserNode ?? null}
                isPlaying={isAnimating}
                themeSungColor={leadColor}
                themeUnsungColor={unsungColor}
                className="pointer-events-none absolute inset-0"
              />
            </div>
          )}
        </StageFrame>

        {isChordBarVisible && chords && chords.length > 0 && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center px-2 pt-2">
            <ChordBar
              chords={chords}
              currentTime={effectiveTime}
              semitones={effectiveSemitones}
              keyHint={keyHint}
              visible={isChordBarVisible}
              onSeek={onSeek}
              onEditChord={onEditChord}
              className="pointer-events-auto mx-auto max-w-xl"
            />
          </div>
        )}
      </div>

      {isFullscreen && (
        <StageFloatingControls
          visible={showControls}
          isPlaying={isPlaying}
          onTogglePlay={onTogglePlay}
          time={effectiveTime}
          duration={duration}
          onSeek={onSeek}
          semitones={effectiveSemitones}
          onPitchDown={() => stepPitch(-1)}
          onPitchUp={() => stepPitch(1)}
          volume={effectiveVolume}
          muted={effectiveMuted}
          onToggleMute={handleToggleStageMute}
          onVolumeChange={handleStageVolumeChange}
        />
      )}
    </div>
  );
};

// Memoized: inside the timeline editor it would otherwise re-render with every edit and
// word boundary; it follows the playback clock itself
export const LyricDisplay = React.memo(LyricDisplayView);
