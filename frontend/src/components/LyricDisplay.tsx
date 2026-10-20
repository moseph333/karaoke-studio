/**
 * Live Lyric Display & Fullscreen TV Stage Preview Component
 *
 * Renders animated word-by-word progressive karaoke sweeps with sub-frame time
 * interpolation, custom sung/unsung color styling, multi-singer duet part visual
 * treatments (Singer 1 Lead, Singer 2 Partner, Both/Duet), color-blind accessible
 * badges, upcoming singer cues, typography scaling, and a Fullscreen TV Stage Mode
 * featuring auto-hiding floating playback controls.
 */

import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Maximize, Minimize, Play, Pause, Activity } from 'lucide-react';
import { LyricLine, WordTiming } from '../types';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';
import { detectInstrumentalGaps, getCountdownState } from '../utils/gapDetection';
import { BeatVisualizer } from './BeatVisualizer';

type NormalizedSinger = 'singer1' | 'singer2' | 'both';

function normalizeSingerRole(singer?: string | null): NormalizedSinger {
  if (!singer) return 'singer1';
  const s = singer.toLowerCase().trim();
  if (s === 'singer2' || s === 'partner') return 'singer2';
  if (s === 'both' || s === 'unison' || s === 'duet' || s === 'all') return 'both';
  return 'singer1';
}

interface SingerVisualConfig {
  label: string;
  tag: string;
  icon: string;
}

const SINGER_CONFIG: Record<NormalizedSinger, SingerVisualConfig> = {
  singer1: {
    label: 'Singer 1 / Lead',
    tag: '[Singer 1]',
    icon: '🎤',
  },
  singer2: {
    label: 'Singer 2 / Partner',
    tag: '[Singer 2]',
    icon: '🎤',
  },
  both: {
    label: 'Both / Duet',
    tag: '[Both / Duet]',
    icon: '👥',
  },
};

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
}

function formatStageTime(seconds?: number): string {
  if (seconds === undefined || seconds === null || isNaN(seconds) || seconds < 0) return '0:00';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
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
  themeSungColor = '#facc15',
  themeUnsungColor = '#ffffff',
  singer2SungColor = '#ec4899',
  bothSungColor = '#10b981',
  className = '',
  aspectRatio = '16:9',
  fontSizeScale = 1.0,
  showVisualizer,
  onToggleVisualizer,
  analyserNode,
}) => {
  const [internalShowViz, setInternalShowViz] = useState(false);
  const isVisualizerActive = showVisualizer !== undefined ? showVisualizer : internalShowViz;
  const handleToggleVisualizer = onToggleVisualizer || (() => setInternalShowViz((v) => !v));

  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const stageRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const effectiveTime = useInterpolatedTime({
    currentTime,
    isPlaying,
    playbackRate,
    audioRef,
  });

  // Reset idle timer to keep floating controls visible
  const resetIdleTimer = useCallback(() => {
    setShowControls(true);
    if (idleTimerRef.current) {
      clearTimeout(idleTimerRef.current);
      idleTimerRef.current = null;
    }
    if (isPlaying && isFullscreen) {
      idleTimerRef.current = setTimeout(() => {
        setShowControls(false);
      }, 3000);
    }
  }, [isPlaying, isFullscreen]);

  // Keep controls always visible when playback is paused
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
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
      }
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
      } else {
        if (typeof document !== 'undefined' && document.fullscreenElement) {
          await document.exitFullscreen().catch(() => {});
        }
      }
    } catch {
      // Fallback pseudo-fullscreen operates gracefully without native Fullscreen API
    }
  }, [isFullscreen]);

  // Sync fullscreen state if user exits via browser ESC or F11
  useEffect(() => {
    const handleFullscreenChange = () => {
      const isNativeFull = Boolean(document.fullscreenElement);
      if (!isNativeFull && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, [isFullscreen]);

  // Keyboard shortcut: 'F' toggles Fullscreen stage, 'Escape' exits
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

  // Instrumental gap detection (intro >= 4.0s, inter-line >= 4.0s)
  const instrumentalGaps = useMemo(() => detectInstrumentalGaps(lines), [lines]);
  const countdownState = getCountdownState(effectiveTime, instrumentalGaps);

  // Active line detection:
  // When an instrumental gap >= 4.0s is active, singing has not begun yet, so currentLine is null until gap.endTime.
  // Otherwise, active line has standard -1.5s lead-in to +1.0s lead-out.
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

  // Multi-Singer color resolution
  const getSingerSungColor = useCallback(
    (role: NormalizedSinger): string => {
      switch (role) {
        case 'singer2':
          return singer2SungColor;
        case 'both':
          return bothSungColor;
        case 'singer1':
        default:
          return themeSungColor;
      }
    },
    [singer2SungColor, bothSungColor, themeSungColor]
  );

  const activeSinger = normalizeSingerRole(currentLine?.singer);
  const activeSungColor = getSingerSungColor(activeSinger);
  const activeSingerConfig = SINGER_CONFIG[activeSinger];

  const nextSinger = nextLine ? normalizeSingerRole(nextLine.singer) : null;
  const nextSungColor = nextSinger ? getSingerSungColor(nextSinger) : themeSungColor;
  const nextSingerConfig = nextSinger ? SINGER_CONFIG[nextSinger] : null;

  // Upcoming singer resolution for instrumental gaps
  const upcomingSingerRole = countdownState.gap
    ? normalizeSingerRole(countdownState.gap.nextLine?.singer)
    : nextSinger || 'singer1';
  const upcomingSingerColor = getSingerSungColor(upcomingSingerRole);

  // Word sweep progression calculation (0 to 100%)
  const getWordProgress = (word: WordTiming) => {
    if (effectiveTime < word.start_time) return 0;
    if (effectiveTime >= word.end_time) return 100;
    const dur = word.end_time - word.start_time;
    if (dur <= 0) return 100;
    return Math.min(100, Math.max(0, ((effectiveTime - word.start_time) / dur) * 100));
  };

  // 3-2-1 Countdown cues leading into active line or during gap lead-in
  const showCountdown = countdownState.hasGap
    ? countdownState.isLeadIn
    : currentLine &&
      currentLine.start_time - effectiveTime > 0 &&
      currentLine.start_time - effectiveTime <= 3.0;

  const countdownSeconds = countdownState.hasGap
    ? countdownState.countdownSeconds
    : currentLine
      ? Math.ceil(currentLine.start_time - effectiveTime)
      : 0;

  const cueColor = countdownState.hasGap ? upcomingSingerColor : activeSungColor;

  // Fullscreen vs normal styling container classes
  const containerClasses = isFullscreen
    ? `fixed inset-0 z-50 bg-slate-950 w-screen h-screen flex flex-col justify-between p-4 sm:p-8 md:p-12 overflow-hidden ${
        !showControls ? 'cursor-none' : ''
      }`
    : `relative ${
        aspectRatio === '9:16' ? 'aspect-[9/16] max-w-xs mx-auto' : 'aspect-video w-full'
      } rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-950 flex flex-col justify-end p-3 sm:p-6 md:p-8 select-none ${className}`;

  return (
    <div
      ref={stageRef}
      data-testid="lyric-display-stage"
      data-fullscreen={isFullscreen ? 'true' : 'false'}
      onMouseMove={resetIdleTimer}
      onClick={resetIdleTimer}
      className={containerClasses}
    >
      {/* Dynamic blurred album background */}
      {albumArtUrl && (
        <div
          data-testid="stage-album-art"
          className="absolute inset-0 bg-cover bg-center filter blur-3xl opacity-35 scale-110 pointer-events-none transition-all duration-700"
          style={{ backgroundImage: `url(${albumArtUrl})` }}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-slate-950/90 via-slate-950/40 to-transparent pointer-events-none" />

      {/* Beat-Reactive Visualizer Layer (behind lyrics, pointer-events-none) */}
      {isVisualizerActive && (
        <BeatVisualizer
          analyserNode={analyserNode ?? null}
          isPlaying={isPlaying}
          themeSungColor={activeSungColor}
          themeUnsungColor={themeUnsungColor}
          className="absolute inset-0 z-[1] pointer-events-none"
        />
      )}

      {/* Top Header Controls: Live Badge & Fullscreen Toggle */}
      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 sm:gap-2 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur text-[10px] sm:text-xs font-medium text-slate-300 z-20">
        <span
          className="w-2 h-2 rounded-full bg-red-500 motion-safe:animate-pulse"
          aria-hidden="true"
        />
        {isFullscreen ? 'TV Stage Mode' : 'Live Visual Preview'}
      </div>

      <div className="absolute top-2.5 right-2.5 flex items-center gap-2 z-20">
        <button
          type="button"
          data-testid="toggle-visualizer-btn"
          aria-label={
            isVisualizerActive ? 'Disable beat visualizer (V)' : 'Enable beat visualizer (V)'
          }
          aria-pressed={isVisualizerActive}
          onClick={handleToggleVisualizer}
          className={`p-2 rounded-xl border backdrop-blur text-xs font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 min-h-[44px] min-w-[44px] flex items-center justify-center shadow-lg ${
            isVisualizerActive
              ? 'bg-cyan-500/20 border-cyan-500 text-cyan-300 shadow-cyan-500/20'
              : 'bg-slate-900/80 hover:bg-slate-800 border-slate-700/60 text-slate-400 hover:text-slate-200'
          }`}
          title={isVisualizerActive ? 'Disable Beat Visualizer (V)' : 'Enable Beat Visualizer (V)'}
        >
          <Activity className="w-4 h-4" />
        </button>

        <button
          type="button"
          data-testid="stage-fullscreen-toggle"
          aria-label={isFullscreen ? 'Exit Fullscreen Stage' : 'Enter Fullscreen TV Stage (F)'}
          onClick={toggleFullscreen}
          className="p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 backdrop-blur text-slate-300 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 min-h-[44px] min-w-[44px] flex items-center justify-center shadow-lg"
          title={isFullscreen ? 'Exit Stage (Esc / F)' : 'Enter TV Stage Mode (F)'}
        >
          {isFullscreen ? (
            <Minimize className="w-4 h-4 text-cyan-400" />
          ) : (
            <Maximize className="w-4 h-4 text-cyan-400" />
          )}
        </button>
      </div>

      {/* Countdown Cue Display */}
      {showCountdown && (
        <div
          data-testid="countdown-cue"
          className="absolute top-1/3 left-1/2 -translate-x-1/2 flex items-center gap-3 font-extrabold text-3xl font-['Montserrat'] motion-safe:animate-bounce motion-reduce:animate-none z-20"
          style={{ color: cueColor }}
          aria-label={`Starting in ${countdownSeconds} seconds`}
        >
          <span
            className={countdownSeconds >= 3 ? 'scale-125' : 'text-slate-600'}
            style={{ color: countdownSeconds >= 3 ? cueColor : undefined }}
            aria-hidden="true"
          >
            ●
          </span>
          <span
            className={countdownSeconds >= 2 ? 'scale-125' : 'text-slate-600'}
            style={{ color: countdownSeconds >= 2 ? cueColor : undefined }}
            aria-hidden="true"
          >
            ●
          </span>
          <span
            className={countdownSeconds >= 1 ? 'scale-125' : 'text-slate-600'}
            style={{ color: countdownSeconds >= 1 ? cueColor : undefined }}
            aria-hidden="true"
          >
            ●
          </span>
        </div>
      )}

      {/* Lyrics Display */}
      <div
        className={`relative z-10 space-y-3 sm:space-y-4 text-center max-w-5xl mx-auto w-full ${
          isFullscreen ? 'my-auto' : ''
        }`}
      >
        {/* Active Singer Badge: Color-blind accessible indicator (Icon + Explicit Text) */}
        {currentLine && (
          <div className="flex justify-center mb-1 sm:mb-2">
            <div
              data-testid="active-singer-badge"
              data-singer={activeSinger}
              role="status"
              aria-label={`Current Singer: ${activeSingerConfig.label}`}
              className={`inline-flex items-center gap-1.5 px-3 py-1 sm:px-4 sm:py-1.5 rounded-full text-xs sm:text-sm font-bold uppercase tracking-wider border shadow-md backdrop-blur-sm transition-all select-none ${
                isFullscreen ? 'scale-110 sm:scale-125 mb-2' : ''
              }`}
              style={{
                borderColor: activeSungColor,
                color: activeSungColor,
                backgroundColor: `${activeSungColor}1a`,
                boxShadow: `0 0 16px ${activeSungColor}33`,
              }}
            >
              <span aria-hidden="true" className="text-sm sm:text-base">
                {activeSingerConfig.icon}
              </span>{' '}
              <span>{activeSingerConfig.label}</span>
            </div>
          </div>
        )}

        {/* Active Line (Line 1) */}
        <div className="min-h-[3rem] sm:min-h-[4.5rem] flex items-center justify-center text-xl sm:text-3xl md:text-5xl">
          {currentLine ? (
            <div
              data-testid="active-lyrics-line"
              data-font-scale={fontSizeScale}
              style={{ fontSize: `${fontSizeScale}em` }}
              className="text-xl sm:text-3xl md:text-5xl font-extrabold font-['Montserrat'] tracking-tight flex flex-wrap justify-center gap-x-2 sm:gap-x-3 gap-y-1 transition-all"
            >
              {currentLine.words.map((w, idx) => {
                const progress = getWordProgress(w);
                return (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => onSeek?.(w.start_time)}
                    aria-label={`Jump playback to word ${w.word} at ${w.start_time.toFixed(2)} seconds`}
                    className="relative cursor-pointer transition-transform hover:scale-105 focus:outline-none focus:ring-2 focus:ring-cyan-400 rounded p-0.5 bg-transparent border-0 inline-block text-inherit font-inherit"
                    title={`${w.word} (${w.start_time.toFixed(2)}s - ${w.end_time.toFixed(2)}s)`}
                  >
                    {/* Unsung text */}
                    <span style={{ color: themeUnsungColor }} className="drop-shadow-md">
                      {w.word}
                    </span>
                    {/* Progressive Sung overlay clip with sub-frame fluid precision */}
                    <span
                      aria-hidden="true"
                      data-testid={`word-sung-${idx}`}
                      className="absolute inset-0 overflow-hidden whitespace-nowrap"
                      style={{
                        width: `${progress.toFixed(2)}%`,
                        clipPath: `inset(0 ${(100 - progress).toFixed(2)}% 0 0)`,
                        color: activeSungColor,
                        filter: `drop-shadow(0 0 12px ${activeSungColor}99)`,
                        transition: 'none',
                      }}
                    >
                      {w.word}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : countdownState.hasGap && countdownState.gap ? (
            <div
              data-testid="gap-countdown-indicator"
              className="flex flex-col items-center justify-center gap-2 sm:gap-3 w-full max-w-xs sm:max-w-md mx-auto transition-all select-none px-2"
            >
              {/* Gap Title */}
              <p
                style={{ fontSize: `${fontSizeScale}em`, color: upcomingSingerColor }}
                className="text-base sm:text-xl md:text-2xl font-bold font-['Montserrat'] tracking-wide transition-colors"
              >
                {countdownState.gap.isIntro ? '♪ Instrumental Intro ♪' : '♪ Instrumental Solo ♪'}
              </p>

              {/* Countdown Seconds Readout */}
              <div
                data-testid="gap-countdown-time"
                className="font-mono text-xs sm:text-sm font-semibold tracking-wider text-slate-300"
              >
                Next vocals in {countdownState.countdownSeconds}s
              </div>

              {/* Visual Progress Bar */}
              <div
                data-testid="gap-countdown-progressbar"
                role="progressbar"
                aria-valuenow={Math.round(countdownState.progressPct)}
                aria-valuemin={0}
                aria-valuemax={100}
                aria-label="Instrumental countdown"
                className="w-full h-2 sm:h-2.5 rounded-full bg-slate-800/80 border border-slate-700/60 overflow-hidden p-0.5 shadow-inner"
              >
                <div
                  data-testid="gap-countdown-progressbar-fill"
                  className="h-full rounded-full transition-all duration-100 ease-linear shadow-sm"
                  style={{
                    width: `${countdownState.progressPct.toFixed(1)}%`,
                    backgroundColor: upcomingSingerColor,
                    boxShadow: `0 0 10px ${upcomingSingerColor}66`,
                  }}
                />
              </div>
            </div>
          ) : (
            <p
              style={{ fontSize: `${fontSizeScale}em` }}
              className="text-sm sm:text-base md:text-xl text-slate-500 font-medium italic"
            >
              {effectiveTime < (lines[0]?.start_time || 0)
                ? '♪ Instrumental Intro ♪'
                : '♪ Instrumental Break ♪'}
            </p>
          )}
        </div>

        {/* Upcoming Line (Line 2) */}
        <div className="min-h-[1.5rem] sm:min-h-[2rem] flex items-center justify-center text-sm sm:text-lg md:text-xl">
          {nextLine ? (
            <p
              style={{ fontSize: `${Math.max(0.7, fontSizeScale * 0.75)}em` }}
              className="text-sm sm:text-lg md:text-xl font-bold font-['Montserrat'] text-slate-400/80 drop-shadow flex items-center justify-center gap-2 flex-wrap"
            >
              {nextSingerConfig && (
                <span
                  data-testid="next-singer-tag"
                  data-singer={nextSinger}
                  className="text-xs sm:text-sm font-semibold px-2 py-0.5 rounded border border-slate-700/80 bg-slate-900/60 inline-flex items-center shrink-0"
                  style={{
                    color: nextSungColor,
                    borderColor: `${nextSungColor}40`,
                  }}
                  title={`Next cue: ${nextSingerConfig.label}`}
                >
                  {nextSingerConfig.tag}
                </span>
              )}
              <span>{nextLine.text}</span>
            </p>
          ) : (
            <span className="text-xs sm:text-sm text-slate-600">-- End of song --</span>
          )}
        </div>
      </div>

      {/* Floating Auto-Hiding Playback Controls (TV Stage Mode) */}
      {isFullscreen && (
        <div
          data-testid="stage-floating-controls"
          className={`relative z-30 max-w-3xl mx-auto w-full bg-slate-900/90 border border-slate-700/70 backdrop-blur-lg px-3 sm:px-6 py-2.5 sm:py-3 rounded-2xl shadow-2xl flex items-center gap-2 sm:gap-4 transition-opacity duration-500 ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Play/Pause Button */}
          <button
            type="button"
            data-testid="stage-play-pause-btn"
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
            onClick={() => onTogglePlay?.()}
            className="p-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all min-h-[44px] min-w-[44px] flex items-center justify-center shadow-md shadow-cyan-500/20"
          >
            {isPlaying ? (
              <Pause className="w-4 h-4 fill-current" />
            ) : (
              <Play className="w-4 h-4 fill-current ml-0.5" />
            )}
          </button>

          {/* Scrubber Slider */}
          <div className="flex-1 flex items-center gap-2">
            <input
              type="range"
              data-testid="stage-scrubber"
              aria-label="Playback progress scrubber"
              min={0}
              max={duration || 100}
              step={0.1}
              value={effectiveTime}
              onChange={(e) => onSeek?.(parseFloat(e.target.value))}
              className="w-full h-2 rounded-lg bg-slate-800 accent-cyan-400 cursor-pointer"
            />
          </div>

          {/* Time Display */}
          <div
            data-testid="stage-time-display"
            className="font-mono text-xs sm:text-sm text-slate-300 font-semibold shrink-0"
          >
            {formatStageTime(effectiveTime)} / {formatStageTime(duration)}
          </div>

          {/* Visualizer Toggle Button */}
          <button
            type="button"
            data-testid="toggle-visualizer-btn"
            aria-label={
              isVisualizerActive ? 'Disable beat visualizer (V)' : 'Enable beat visualizer (V)'
            }
            aria-pressed={isVisualizerActive}
            onClick={handleToggleVisualizer}
            className={`p-2.5 rounded-xl border transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center ${
              isVisualizerActive
                ? 'bg-cyan-500/30 border-cyan-400 text-cyan-300'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white border-slate-700'
            }`}
            title={
              isVisualizerActive ? 'Disable Beat Visualizer (V)' : 'Enable Beat Visualizer (V)'
            }
          >
            <Activity className="w-4 h-4" />
          </button>

          {/* Exit Fullscreen Button */}
          <button
            type="button"
            data-testid="stage-exit-btn"
            aria-label="Exit Fullscreen Stage"
            onClick={toggleFullscreen}
            className="p-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors min-h-[44px] min-w-[44px] flex items-center justify-center"
            title="Exit Fullscreen Stage (Esc)"
          >
            <Minimize className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
