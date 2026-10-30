/**
 * Stage Lyrics
 *
 * The lyric area of the live stage: chord bar, lead-in countdown ring, duet singer
 * badge, the active line with its progressive word sweep, instrumental gap countdown
 * and the upcoming line.
 */

import React from 'react';
import { ChordBar } from '../ChordBar';
import { ChordSegment, LyricLine, SyncDisplayMode, WordTiming } from '../../types';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';
import { lyricOutline } from '../../theme/stageBackgrounds';
import { NormalizedSinger, SINGER_CONFIG } from './singers';

export interface StageGapState {
  hasGap: boolean;
  isIntro: boolean;
  countdownSeconds: number;
  progressPct: number;
}

export interface StageLyricsProps {
  lines: LyricLine[];
  currentLine: LyricLine | null;
  nextLine: LyricLine | null;
  time: number;
  syncMode: SyncDisplayMode;
  fontSizeScale: number;
  fontFamily: string;
  isFullscreen: boolean;
  tone: 'dark' | 'light';
  unsungColor: string;
  activeSinger: NormalizedSinger;
  activeSungColor: string;
  hasMultipleSingers: boolean;
  nextSinger: NormalizedSinger | null;
  nextSungColor: string;
  gap: StageGapState | null;
  upcomingSingerColor: string;
  countdown: { show: boolean; seconds: number; remaining: number; color: string };
  chords?: ChordSegment[];
  showChordBar: boolean;
  semitones: number;
  keyHint?: string | null;
  onSeek?: (time: number) => void;
  onEditChord?: (index: number, newChord: string) => void;
}

const wordButton = cn(
  'relative inline-block cursor-pointer rounded-theme-sm border-0 bg-transparent p-0.5 font-inherit text-inherit transition-transform hover:scale-[1.04]',
  focusRing
);

/** Circular lead-in countdown (3-2-1) drawn as a draining ring. */
const CountdownRing: React.FC<{ seconds: number; remaining: number; color: string }> = ({
  seconds,
  remaining,
  color,
}) => {
  const radius = 15;
  const circumference = 2 * Math.PI * radius;
  const fraction = Math.max(0, Math.min(1, remaining / 3));
  return (
    <div
      data-testid="countdown-cue"
      aria-label={`Starting in ${seconds} seconds`}
      className="inline-flex items-center gap-2 rounded-theme-pill border border-white/15 bg-black/50 py-1 pl-1 pr-3 text-white shadow-theme-md backdrop-blur-md"
    >
      <span className="relative grid h-8 w-8 place-items-center">
        <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90" aria-hidden="true">
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke="currentColor"
            strokeOpacity="0.2"
            strokeWidth="3"
          />
          <circle
            cx="18"
            cy="18"
            r={radius}
            fill="none"
            stroke={color}
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={circumference * (1 - fraction)}
          />
        </svg>
        <span className="font-mono text-sm font-black" style={{ color }}>
          {seconds}
        </span>
      </span>
      <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/80">
        Get ready
      </span>
    </div>
  );
};

export const StageLyrics: React.FC<StageLyricsProps> = ({
  lines,
  currentLine,
  nextLine,
  time,
  syncMode,
  fontSizeScale,
  fontFamily,
  isFullscreen,
  tone,
  unsungColor,
  activeSinger,
  activeSungColor,
  hasMultipleSingers,
  nextSinger,
  nextSungColor,
  gap,
  upcomingSingerColor,
  countdown,
  chords,
  showChordBar,
  semitones,
  keyHint,
  onSeek,
  onEditChord,
}) => {
  const activeConfig = SINGER_CONFIG[activeSinger];
  const nextConfig = nextSinger ? SINGER_CONFIG[nextSinger] : null;
  const ActiveIcon = activeConfig.Icon;
  // Helper text sits over cover art too: it keeps its muted colour and gets the lyric outline
  const mutedText = tone === 'light' ? 'text-black/55' : 'text-white/55';
  // The outline the exported video draws around the lyrics
  const outline = lyricOutline(tone);

  const wordProgress = (word: WordTiming) => {
    if (syncMode === 'line') {
      return !currentLine || time < currentLine.start_time ? 0 : 100;
    }
    if (time < word.start_time) return 0;
    if (time >= word.end_time) return 100;
    const dur = word.end_time - word.start_time;
    if (dur <= 0) return 100;
    return Math.min(100, Math.max(0, ((time - word.start_time) / dur) * 100));
  };

  return (
    <div
      className={cn(
        'ks-stage-lyrics relative z-10 mx-auto my-auto w-full max-w-5xl space-y-3 text-center sm:my-0 sm:space-y-4',
        isFullscreen && 'sm:my-auto'
      )}
    >
      {showChordBar && chords && chords.length > 0 && (
        <div className="mb-1.5 flex w-full justify-center px-2 sm:mb-3">
          <ChordBar
            chords={chords}
            currentTime={time}
            semitones={semitones}
            keyHint={keyHint}
            visible={showChordBar}
            onSeek={onSeek}
            onEditChord={onEditChord}
            className="mx-auto max-w-xl"
          />
        </div>
      )}

      {countdown.show && (
        <div className="mb-1 flex justify-center sm:mb-2">
          <CountdownRing
            seconds={countdown.seconds}
            remaining={countdown.remaining}
            color={countdown.color}
          />
        </div>
      )}

      {currentLine && hasMultipleSingers && (
        <div className="mb-1 flex justify-center sm:mb-2">
          <div
            data-testid="active-singer-badge"
            data-singer={activeSinger}
            role="status"
            aria-label={`Current Singer: ${activeConfig.label}`}
            className={cn(
              'inline-flex select-none items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-wider shadow-md backdrop-blur-sm transition-all sm:px-4 sm:py-1.5 sm:text-sm',
              isFullscreen && 'mb-2 scale-110 sm:scale-125'
            )}
            style={{
              borderColor: activeSungColor,
              color: activeSungColor,
              backgroundColor: `${activeSungColor}1a`,
              boxShadow: `0 0 16px ${activeSungColor}33`,
            }}
          >
            <ActiveIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" aria-hidden="true" />
            <span>{activeConfig.label}</span>
          </div>
        </div>
      )}

      {/* Active Line (Line 1) */}
      <div className="ks-stage-line flex min-h-[3rem] items-center justify-center text-xl sm:min-h-[4.5rem] sm:text-3xl md:text-5xl">
        {currentLine ? (
          <div
            data-testid="active-lyrics-line"
            data-font-scale={fontSizeScale}
            data-sync-mode={syncMode}
            style={{ fontSize: `${fontSizeScale}em`, fontFamily }}
            className="flex flex-wrap justify-center gap-x-2 gap-y-1 text-xl font-extrabold tracking-tight transition-all sm:gap-x-3 sm:text-3xl md:text-5xl"
          >
            {currentLine.words && currentLine.words.length > 0 ? (
              currentLine.words.map((w, idx) => {
                const progress = wordProgress(w);
                return (
                  <button
                    type="button"
                    key={idx}
                    onClick={() => onSeek?.(w.start_time)}
                    aria-label={`Jump playback to word ${w.word} at ${w.start_time.toFixed(2)} seconds`}
                    className={wordButton}
                    title={`${w.word} (${w.start_time.toFixed(2)}s - ${w.end_time.toFixed(2)}s)`}
                  >
                    <span
                      style={{ color: unsungColor, textShadow: outline }}
                      className="drop-shadow-md"
                    >
                      {w.word}
                    </span>
                    {progress > 0 && (
                      // Glow layer: its clip extends past the word on three sides so the halo
                      // is not cut into a box; only the sweep edge on the right is hard.
                      <span
                        aria-hidden="true"
                        className="pointer-events-none absolute inset-0 whitespace-nowrap"
                        style={{
                          color: 'transparent',
                          textShadow: `0 0 14px ${activeSungColor}8c`,
                          clipPath: `inset(-1em ${(100 - progress).toFixed(2)}% -1em -1em)`,
                        }}
                      >
                        {w.word}
                      </span>
                    )}
                    <span
                      aria-hidden="true"
                      data-testid={`word-sung-${idx}`}
                      className="absolute inset-0 overflow-hidden whitespace-nowrap"
                      style={{
                        width: `${progress.toFixed(2)}%`,
                        clipPath: `inset(0 ${(100 - progress).toFixed(2)}% 0 0)`,
                        color: activeSungColor,
                        transition: 'none',
                      }}
                    >
                      {w.word}
                    </span>
                  </button>
                );
              })
            ) : (
              <button
                type="button"
                onClick={() => onSeek?.(currentLine.start_time)}
                aria-label={`Jump playback to line at ${currentLine.start_time.toFixed(2)} seconds`}
                className={wordButton}
                title={`${currentLine.text} (${currentLine.start_time.toFixed(2)}s - ${currentLine.end_time.toFixed(2)}s)`}
              >
                <span
                  style={{
                    textShadow: outline,
                    color: time >= currentLine.start_time ? activeSungColor : unsungColor,
                    filter:
                      time >= currentLine.start_time
                        ? `drop-shadow(0 0 12px ${activeSungColor}99)`
                        : undefined,
                  }}
                  className="drop-shadow-md"
                >
                  {currentLine.text}
                </span>
              </button>
            )}
          </div>
        ) : gap && gap.hasGap ? (
          <div
            data-testid="gap-countdown-indicator"
            className="mx-auto flex w-full max-w-xs select-none flex-col items-center justify-center gap-2 px-2 transition-all sm:max-w-md sm:gap-3"
          >
            <p
              style={{
                fontSize: `${fontSizeScale}em`,
                color: upcomingSingerColor,
                fontFamily,
                textShadow: outline,
              }}
              className="text-base font-bold tracking-wide transition-colors sm:text-xl md:text-2xl"
            >
              {gap.isIntro ? '♪ Instrumental Intro ♪' : '♪ Instrumental Solo ♪'}
            </p>
            <div
              data-testid="gap-countdown-time"
              className={cn('font-mono text-xs font-semibold tracking-wider sm:text-sm', mutedText)}
              style={{ textShadow: outline }}
            >
              Next vocals in {gap.countdownSeconds}s
            </div>
            <div
              data-testid="gap-countdown-progressbar"
              role="progressbar"
              aria-valuenow={Math.round(gap.progressPct)}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Instrumental countdown"
              className="h-2 w-full overflow-hidden rounded-full border border-white/10 bg-black/40 p-0.5 shadow-inner sm:h-2.5"
            >
              <div
                data-testid="gap-countdown-progressbar-fill"
                className="h-full rounded-full shadow-sm transition-all duration-100 ease-linear"
                style={{
                  width: `${gap.progressPct.toFixed(1)}%`,
                  backgroundColor: upcomingSingerColor,
                  boxShadow: `0 0 10px ${upcomingSingerColor}66`,
                }}
              />
            </div>
          </div>
        ) : (
          <p
            style={{ fontSize: `${fontSizeScale}em`, textShadow: outline }}
            className={cn('text-sm font-medium italic sm:text-base md:text-xl', mutedText)}
          >
            {time < (lines[0]?.start_time || 0)
              ? '♪ Instrumental Intro ♪'
              : '♪ Instrumental Break ♪'}
          </p>
        )}
      </div>

      {/* Upcoming Line (Line 2) */}
      <div className="ks-stage-next flex min-h-[1.5rem] items-center justify-center text-sm sm:min-h-[2rem] sm:text-lg md:text-xl">
        {nextLine ? (
          <p
            data-testid="upcoming-lyrics-line"
            style={{ fontSize: `${Math.max(0.7, fontSizeScale * 0.75)}em`, fontFamily }}
            className={cn(
              'flex flex-wrap items-center justify-center gap-2 font-bold drop-shadow',
              mutedText
            )}
          >
            {hasMultipleSingers && nextConfig && nextSinger && (
              <span
                data-testid="next-singer-tag"
                data-singer={nextSinger}
                className="inline-flex shrink-0 items-center rounded border bg-black/30 px-2 py-0.5 text-xs font-semibold sm:text-sm"
                style={{ color: nextSungColor, borderColor: `${nextSungColor}40` }}
                title={`Next cue: ${nextConfig.label}`}
              >
                {nextConfig.tag}
              </span>
            )}
            <span style={{ textShadow: outline }}>{nextLine.text}</span>
          </p>
        ) : (
          <span className={cn('text-xs sm:text-sm', mutedText)} style={{ textShadow: outline }}>
            -- End of song --
          </span>
        )}
      </div>
    </div>
  );
};
