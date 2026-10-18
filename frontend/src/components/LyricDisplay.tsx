/**
 * Live Lyric Display & Fullscreen TV Stage Preview Component
 *
 * Renders animated word-by-word progressive karaoke sweeps with sub-frame time
 * interpolation, custom sung/unsung color styling, typography scaling, and
 * a Fullscreen TV Stage Mode featuring auto-hiding floating playback controls.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Maximize, Minimize, Play, Pause } from 'lucide-react';
import { LyricLine, WordTiming } from '../types';
import { useInterpolatedTime } from '../hooks/useInterpolatedTime';

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
  className?: string;
  aspectRatio?: string;
  fontSizeScale?: number;
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
  className = '',
  aspectRatio = '16:9',
  fontSizeScale = 1.0,
}) => {
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

  // Active line detection (-1.5s lead-in to +1.0s lead-out)
  const activeLineIndex = lines.findIndex(
    (l) => effectiveTime >= l.start_time - 1.5 && effectiveTime <= l.end_time + 1.0
  );

  const currentLine = activeLineIndex >= 0 ? lines[activeLineIndex] : null;
  const nextLine =
    activeLineIndex >= 0 && activeLineIndex + 1 < lines.length
      ? lines[activeLineIndex + 1]
      : !currentLine && lines.length > 0
        ? lines[0]
        : null;

  // Word sweep progression calculation (0 to 100%)
  const getWordProgress = (word: WordTiming) => {
    if (effectiveTime < word.start_time) return 0;
    if (effectiveTime >= word.end_time) return 100;
    const dur = word.end_time - word.start_time;
    if (dur <= 0) return 100;
    return Math.min(100, Math.max(0, ((effectiveTime - word.start_time) / dur) * 100));
  };

  // 3-2-1 Countdown cues
  const showCountdown =
    currentLine &&
    currentLine.start_time - effectiveTime > 0 &&
    currentLine.start_time - effectiveTime <= 3.0;
  const countdownSeconds = showCountdown ? Math.ceil(currentLine!.start_time - effectiveTime) : 0;

  // Fullscreen vs normal styling container classes
  const containerClasses = isFullscreen
    ? `fixed inset-0 z-50 bg-slate-950 w-screen h-screen flex flex-col justify-between p-6 sm:p-12 overflow-hidden ${
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

      {/* Top Header Controls: Live Badge & Fullscreen Toggle */}
      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 sm:gap-2 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur text-[10px] sm:text-xs font-medium text-slate-300 z-20">
        <span
          className="w-2 h-2 rounded-full bg-red-500 motion-safe:animate-pulse"
          aria-hidden="true"
        />
        {isFullscreen ? 'TV Stage Mode' : 'Live Visual Preview'}
      </div>

      <button
        type="button"
        data-testid="stage-fullscreen-toggle"
        aria-label={isFullscreen ? 'Exit Fullscreen Stage' : 'Enter Fullscreen TV Stage (F)'}
        onClick={toggleFullscreen}
        className="absolute top-2.5 right-2.5 p-1.5 sm:p-2 rounded-xl bg-slate-900/80 hover:bg-slate-800 border border-slate-700/60 backdrop-blur text-slate-300 hover:text-white transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 min-h-[36px] min-w-[36px] flex items-center justify-center shadow-lg z-20"
        title={isFullscreen ? 'Exit Stage (Esc / F)' : 'Enter TV Stage Mode (F)'}
      >
        {isFullscreen ? (
          <Minimize className="w-4 h-4 text-cyan-400" />
        ) : (
          <Maximize className="w-4 h-4 text-cyan-400" />
        )}
      </button>

      {/* Countdown Cue Display */}
      {showCountdown && (
        <div
          data-testid="countdown-cue"
          className="absolute top-1/3 left-1/2 -translate-x-1/2 flex items-center gap-3 font-extrabold text-3xl font-['Montserrat'] motion-safe:animate-bounce motion-reduce:animate-none z-20"
          style={{ color: themeSungColor }}
          aria-label={`Starting in ${countdownSeconds} seconds`}
        >
          <span
            className={countdownSeconds >= 3 ? 'scale-125' : 'text-slate-600'}
            style={{ color: countdownSeconds >= 3 ? themeSungColor : undefined }}
            aria-hidden="true"
          >
            ●
          </span>
          <span
            className={countdownSeconds >= 2 ? 'scale-125' : 'text-slate-600'}
            style={{ color: countdownSeconds >= 2 ? themeSungColor : undefined }}
            aria-hidden="true"
          >
            ●
          </span>
          <span
            className={countdownSeconds >= 1 ? 'scale-125' : 'text-slate-600'}
            style={{ color: countdownSeconds >= 1 ? themeSungColor : undefined }}
            aria-hidden="true"
          >
            ●
          </span>
        </div>
      )}

      {/* Lyrics Display */}
      <div
        className={`relative z-10 space-y-4 text-center max-w-5xl mx-auto w-full ${
          isFullscreen ? 'my-auto' : ''
        }`}
      >
        {/* Active Line (Line 1) */}
        <div className="min-h-[3rem] sm:min-h-[4.5rem] flex items-center justify-center">
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
                      className="absolute inset-0 overflow-hidden whitespace-nowrap drop-shadow-[0_0_12px_rgba(250,204,21,0.6)]"
                      style={{
                        width: `${progress.toFixed(2)}%`,
                        clipPath: `inset(0 ${(100 - progress).toFixed(2)}% 0 0)`,
                        color: themeSungColor,
                        transition: 'none',
                      }}
                    >
                      {w.word}
                    </span>
                  </button>
                );
              })}
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
        <div className="min-h-[1.5rem] sm:min-h-[2rem] flex items-center justify-center">
          {nextLine ? (
            <p
              style={{ fontSize: `${Math.max(0.7, fontSizeScale * 0.75)}em` }}
              className="text-sm sm:text-lg md:text-xl font-bold font-['Montserrat'] text-slate-400/80 drop-shadow"
            >
              {nextLine.text}
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
          className={`relative z-30 max-w-3xl mx-auto w-full bg-slate-900/90 border border-slate-700/70 backdrop-blur-lg px-4 sm:px-6 py-3 rounded-2xl shadow-2xl flex items-center gap-3 sm:gap-4 transition-opacity duration-500 ${
            showControls ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'
          }`}
        >
          {/* Play/Pause Button */}
          <button
            type="button"
            data-testid="stage-play-pause-btn"
            aria-label={isPlaying ? 'Pause audio' : 'Play audio'}
            onClick={() => onTogglePlay?.()}
            className="p-2 sm:p-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold transition-all min-h-[40px] min-w-[40px] flex items-center justify-center shadow-md shadow-cyan-500/20"
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

          {/* Exit Fullscreen Button */}
          <button
            type="button"
            data-testid="stage-exit-btn"
            aria-label="Exit Fullscreen Stage"
            onClick={toggleFullscreen}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition-colors min-h-[40px] min-w-[40px] flex items-center justify-center"
            title="Exit Fullscreen Stage (Esc)"
          >
            <Minimize className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
};
