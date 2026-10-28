/**
 * Live Lyric Display & Fullscreen TV Stage Preview Component
 *
 * Orchestrates the live stage: sub-frame time interpolation, active/upcoming line and
 * duet singer resolution, instrumental gap countdowns, and the fullscreen TV stage with
 * auto-hiding controls. Rendering is split into StageBackground, StageToolbar,
 * StageLyrics and StageFloatingControls.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LyricLine, ChordSegment, SyncDisplayMode, VisualTheme } from '../types';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import { detectInstrumentalGaps, getCountdownState } from '../utils/gapDetection';
import { DEFAULT_BOTH_COLOR, DEFAULT_SINGER2_COLOR } from '../theme/stagePresets';
import { BeatVisualizer } from './BeatVisualizer';
import { StageBackground, StageBackgroundMedia } from './stage/StageBackground';
import { StageToolbar } from './stage/StageToolbar';
import { StageLyrics } from './stage/StageLyrics';
import { StageFloatingControls } from './stage/StageFloatingControls';
import { NormalizedSinger, normalizeSingerRole } from './stage/singers';
import { cn } from '../utils/cn';
import { useRegisterCommands } from './commandPalette/context';
import { Maximize, Minimize } from 'lucide-react';

export interface LyricDisplayProps {
  lines: LyricLine[];
  currentTime: number;
  duration?: number;
  isPlaying?: boolean;
  playbackRate?: number;
  audioRef?: React.RefObject<HTMLAudioElement>;
  onSeek?: (time: number) => void;
  onTogglePlay?: () => void;
  albumArtUrl?: string;
  /** Custom background image/video shown behind the lyrics (replaces album art). */
  backgroundMedia?: StageBackgroundMedia | null;
  themeSungColor?: string;
  themeUnsungColor?: string;
  singer2SungColor?: string;
  bothSungColor?: string;
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
  fontFamily?: string;
  selectedTheme?: VisualTheme;
  // Stage Controls (Requirement UX-5)
  onSemitonesChange?: (semitones: number) => void;
  onPitchStep?: (delta: number) => void;
  volume?: number;
  onVolumeChange?: (volume: number) => void;
  isMuted?: boolean;
  onToggleMute?: () => void;
}

export const LyricDisplay: React.FC<LyricDisplayProps> = ({
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
  themeSungColor = '#facc15',
  themeUnsungColor = '#ffffff',
  singer2SungColor = DEFAULT_SINGER2_COLOR,
  bothSungColor = DEFAULT_BOTH_COLOR,
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
  fontFamily,
  selectedTheme,
  onSemitonesChange,
  onPitchStep,
  volume,
  onVolumeChange,
  isMuted,
  onToggleMute,
}) => {
  const stageFontFamily =
    fontFamily || selectedTheme?.fontFamily || 'var(--karaoke-font-family, sans-serif)';
  const stageTone: 'dark' | 'light' = selectedTheme?.tone ?? 'dark';
  const stageBaseColor = selectedTheme?.stageBg || selectedTheme?.previewBg || undefined;

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
  const handleToggleVisualizer = onToggleVisualizer || (() => setInternalShowViz((v) => !v));

  const [internalShowChordBar, setInternalShowChordBar] = useState(false);
  const isChordBarVisible =
    showChords !== undefined
      ? showChords
      : showChordBar !== undefined
        ? showChordBar
        : internalShowChordBar;
  const handleToggleChordBar = onToggleChordBar || (() => setInternalShowChordBar((v) => !v));

  // --- Fullscreen & auto-hiding controls -------------------------------------------
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveTime = useInterpolatedTime({ currentTime, isPlaying, playbackRate, audioRef });

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

  // 'F' toggles the fullscreen stage, 'Escape' exits
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const isInput =
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable);
      if (isInput) return;

      if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleFullscreen, isFullscreen]);

  // --- Lines, gaps and singers ---------------------------------------------------------
  const instrumentalGaps = useMemo(() => detectInstrumentalGaps(lines), [lines]);
  const countdownState = getCountdownState(effectiveTime, instrumentalGaps);

  // While an instrumental gap (>= 4s) runs, singing has not begun: no active line until
  // the gap ends. Otherwise lines get a 1.5s lead-in and a 1.0s lead-out.
  const activeLineIndex = lines.findIndex((l) => {
    const leadIn = countdownState.hasGap ? 0.0 : 1.5;
    return effectiveTime >= l.start_time - leadIn && effectiveTime <= l.end_time + 1.0;
  });

  const currentLine = activeLineIndex >= 0 ? lines[activeLineIndex] : null;
  const nextLine =
    activeLineIndex >= 0 && activeLineIndex + 1 < lines.length
      ? lines[activeLineIndex + 1]
      : !currentLine && lines.length > 0
        ? countdownState.hasGap
          ? countdownState.gap?.nextLine || lines[0]
          : lines[0]
        : null;

  const singerColor = useCallback(
    (role: NormalizedSinger): string =>
      role === 'singer2' ? singer2SungColor : role === 'both' ? bothSungColor : themeSungColor,
    [singer2SungColor, bothSungColor, themeSungColor]
  );

  const hasMultipleSingers = useMemo(
    () => lines.some((l) => normalizeSingerRole(l.singer) !== 'singer1'),
    [lines]
  );

  const activeSinger = normalizeSingerRole(currentLine?.singer);
  const activeSungColor = singerColor(activeSinger);
  const nextSinger = nextLine ? normalizeSingerRole(nextLine.singer) : null;
  const nextSungColor = nextSinger ? singerColor(nextSinger) : themeSungColor;

  const upcomingSingerRole = countdownState.gap
    ? normalizeSingerRole(countdownState.gap.nextLine?.singer)
    : nextSinger || 'singer1';
  const upcomingSingerColor = singerColor(upcomingSingerRole);

  // 3-2-1 lead-in countdown into the active line or out of an instrumental gap
  const leadInRemaining = countdownState.hasGap
    ? countdownState.remainingTime
    : currentLine
      ? currentLine.start_time - effectiveTime
      : 0;
  const showCountdown = countdownState.hasGap
    ? countdownState.isLeadIn
    : Boolean(currentLine && leadInRemaining > 0 && leadInRemaining <= 3.0);
  const countdownSeconds = countdownState.hasGap
    ? countdownState.countdownSeconds
    : currentLine
      ? Math.ceil(currentLine.start_time - effectiveTime)
      : 0;

  const containerClasses = isFullscreen
    ? cn(
        'fixed inset-0 z-50 flex h-screen w-screen flex-col justify-between overflow-hidden bg-theme-bg p-4 font-theme-heading text-theme-text sm:p-8 md:p-12',
        !showControls && 'cursor-none'
      )
    : cn(
        'relative',
        aspectRatio === '9:16'
          ? 'aspect-[9/16] max-w-xs mx-auto md:ks-stage-fit-portrait'
          : 'aspect-video w-full min-h-[340px] sm:min-h-0 md:mx-auto md:ks-stage-fit',
        'ks-stage-container flex select-none flex-col justify-end overflow-hidden rounded-theme-xl border border-theme-border-subtle bg-theme-bg px-3 pb-5 pt-16 font-theme-heading text-theme-text shadow-theme-lg sm:px-6 sm:pb-6 sm:pt-16 md:px-8 md:pb-8',
        className
      );

  return (
    <div
      ref={stageRef}
      data-testid="lyric-display-stage"
      data-fullscreen={isFullscreen ? 'true' : 'false'}
      data-sync-mode={activeSyncMode}
      data-tone={stageTone}
      onMouseMove={resetIdleTimer}
      onClick={resetIdleTimer}
      className={containerClasses}
      style={{ backgroundColor: stageBaseColor, fontFamily: stageFontFamily }}
    >
      <StageBackground
        baseColor={stageBaseColor}
        albumArtUrl={albumArtUrl}
        media={backgroundMedia}
        tone={stageTone}
      />

      {isVisualizerActive && (
        <BeatVisualizer
          analyserNode={analyserNode ?? null}
          isPlaying={isPlaying}
          themeSungColor={activeSungColor}
          themeUnsungColor={themeUnsungColor}
          className="pointer-events-none absolute inset-0 z-[1]"
        />
      )}

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

      <StageLyrics
        lines={lines}
        currentLine={currentLine}
        nextLine={nextLine}
        time={effectiveTime}
        syncMode={activeSyncMode}
        fontSizeScale={fontSizeScale}
        fontFamily={stageFontFamily}
        isFullscreen={isFullscreen}
        tone={stageTone}
        unsungColor={themeUnsungColor}
        activeSinger={activeSinger}
        activeSungColor={activeSungColor}
        hasMultipleSingers={hasMultipleSingers}
        nextSinger={nextSinger}
        nextSungColor={nextSungColor}
        gap={
          countdownState.hasGap && countdownState.gap
            ? {
                hasGap: true,
                isIntro: countdownState.gap.isIntro,
                countdownSeconds: countdownState.countdownSeconds,
                progressPct: countdownState.progressPct,
              }
            : null
        }
        upcomingSingerColor={upcomingSingerColor}
        countdown={{
          show: showCountdown,
          seconds: countdownSeconds,
          remaining: leadInRemaining,
          color: countdownState.hasGap ? upcomingSingerColor : activeSungColor,
        }}
        chords={chords}
        showChordBar={isChordBarVisible}
        semitones={effectiveSemitones}
        keyHint={keyHint}
        onSeek={onSeek}
        onEditChord={onEditChord}
      />

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
