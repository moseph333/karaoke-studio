/**
 * Live Lyric Display & Progressive Karaoke Preview Component
 *
 * Renders animated word-by-word progressive karaoke sweeps with sub-frame time
 * interpolation, supporting both 16:9 landscape and 9:16 portrait viewports.
 */

import React from 'react';
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
  albumArtUrl?: string;
  themeSungColor?: string;
  themeUnsungColor?: string;
  className?: string;
  aspectRatio?: string;
}

export const LyricDisplay: React.FC<LyricDisplayProps> = ({
  lines,
  currentTime,
  isPlaying = false,
  playbackRate = 1.0,
  audioRef,
  onSeek,
  albumArtUrl,
  themeSungColor = '#facc15',
  themeUnsungColor = '#ffffff',
  className = '',
  aspectRatio = '16:9',
}) => {
  const effectiveTime = useInterpolatedTime({
    currentTime,
    isPlaying,
    playbackRate,
    audioRef,
  });

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

  return (
    <div
      data-testid="lyric-display-stage"
      className={`relative ${
        aspectRatio === '9:16' ? 'aspect-[9/16] max-w-xs mx-auto' : 'aspect-video w-full'
      } rounded-2xl overflow-hidden shadow-2xl border border-slate-800 bg-slate-950 flex flex-col justify-end p-3 sm:p-6 md:p-8 select-none ${className}`}
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

      {/* Live Badge */}
      <div className="absolute top-2.5 left-2.5 flex items-center gap-1.5 sm:gap-2 px-2.5 py-0.5 sm:px-3 sm:py-1 rounded-full bg-slate-900/80 border border-slate-700/60 backdrop-blur text-[10px] sm:text-xs font-medium text-slate-300">
        <span
          className="w-2 h-2 rounded-full bg-red-500 motion-safe:animate-pulse"
          aria-hidden="true"
        />
        Live Visual Preview
      </div>

      {/* Countdown Cue Display */}
      {showCountdown && (
        <div
          data-testid="countdown-cue"
          className="absolute top-1/3 left-1/2 -translate-x-1/2 flex items-center gap-3 text-cyan-400 font-extrabold text-3xl font-['Montserrat'] motion-safe:animate-bounce motion-reduce:animate-none"
          aria-label={`Starting in ${countdownSeconds} seconds`}
        >
          <span
            className={countdownSeconds >= 3 ? 'text-yellow-400 scale-125' : 'text-slate-600'}
            aria-hidden="true"
          >
            ●
          </span>
          <span
            className={countdownSeconds >= 2 ? 'text-yellow-400 scale-125' : 'text-slate-600'}
            aria-hidden="true"
          >
            ●
          </span>
          <span
            className={countdownSeconds >= 1 ? 'text-yellow-400 scale-125' : 'text-slate-600'}
            aria-hidden="true"
          >
            ●
          </span>
        </div>
      )}

      {/* Lyrics Display */}
      <div className="relative z-10 space-y-4 text-center max-w-4xl mx-auto w-full">
        {/* Active Line (Line 1) */}
        <div className="min-h-[3rem] sm:min-h-[4.5rem] flex items-center justify-center">
          {currentLine ? (
            <div
              data-testid="active-lyrics-line"
              className="text-xl sm:text-3xl md:text-5xl font-extrabold font-['Montserrat'] tracking-tight flex flex-wrap justify-center gap-x-2 sm:gap-x-3 gap-y-1"
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
                        transition: 'none', // Direct sub-frame RAF interpolation eliminates stutter
                      }}
                    >
                      {w.word}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-sm sm:text-base md:text-xl text-slate-500 font-medium italic">
              {effectiveTime < (lines[0]?.start_time || 0)
                ? '♪ Instrumental Intro ♪'
                : '♪ Instrumental Break ♪'}
            </p>
          )}
        </div>

        {/* Upcoming Line (Line 2) */}
        <div className="min-h-[1.5rem] sm:min-h-[2rem] flex items-center justify-center">
          {nextLine ? (
            <p className="text-sm sm:text-lg md:text-xl font-bold font-['Montserrat'] text-slate-400/80 drop-shadow">
              {nextLine.text}
            </p>
          ) : (
            <span className="text-xs sm:text-sm text-slate-600">-- End of song --</span>
          )}
        </div>
      </div>
    </div>
  );
};
