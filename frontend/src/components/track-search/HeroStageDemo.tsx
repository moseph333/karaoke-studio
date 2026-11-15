/**
 * Hero Stage Demo
 *
 * A small self-playing karaoke stage on the home screen: lyrics that light up word by word
 * over a moving spectrum, the way a finished song looks in the studio. It shows a first-time
 * visitor the result before they have made a song. No audio, no network.
 *
 * Decorative for assistive tech (one image label); the pause button is real, so the motion
 * can be stopped, and it never starts for viewers who ask for reduced motion.
 */

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MicOff, Music2, Pause, Play } from 'lucide-react';
import { cn } from '../../utils/cn';
import { focusRing } from '../ui/variants';
import { useIsVisible } from '../../hooks/useIsVisible';
import { usePrefersReducedMotion } from '../../hooks/usePrefersReducedMotion';

interface DemoWord {
  text: string;
  /** How long the word is sung, in milliseconds. */
  ms: number;
}

/** Lyrics written for this project (the seeded demo song); free to use. */
const line = (...words: Array<[string, number]>): DemoWord[] =>
  words.map(([text, ms]) => ({ text, ms }));

const DEMO_LINES: DemoWord[][] = [
  line(['City', 420], ['lights', 400], ['are', 240], ['humming', 560], ['low', 760]),
  line(
    ['I', 220],
    ['can', 240],
    ['hear', 400],
    ['it', 220],
    ['in', 220],
    ['the', 220],
    ['rain', 800]
  ),
  line(['We', 300], ['are', 260], ['neon', 560], ['on', 240], ['the', 220], ['skyline', 900]),
  line(['Sing', 440], ['it', 240], ['louder,', 600], ['sing', 400], ['with', 280], ['me', 860]),
];

/** Pause between the last word of a line and the first word of the next. */
const LINE_GAP_MS = 520;

const TOTAL_MS = DEMO_LINES.reduce(
  (sum, words) => sum + LINE_GAP_MS + words.reduce((s, w) => s + w.ms, 0),
  0
);

/** Where a step (line, word) starts in the loop; word -1 is the pause before the line. */
function elapsedBefore(lineIdx: number, wordIdx: number): number {
  let ms = 0;
  for (let l = 0; l < lineIdx; l++) {
    ms += LINE_GAP_MS + DEMO_LINES[l].reduce((s, w) => s + w.ms, 0);
  }
  if (wordIdx >= 0) {
    ms += LINE_GAP_MS;
    for (let w = 0; w < wordIdx; w++) ms += DEMO_LINES[lineIdx][w].ms;
  }
  return ms;
}

const BAR_COUNT = 26;

export interface HeroStageDemoProps {
  className?: string;
}

export const HeroStageDemo: React.FC<HeroStageDemoProps> = ({ className }) => {
  const rootRef = useRef<HTMLDivElement>(null);
  const onScreen = useIsVisible(rootRef);
  const reducedMotion = usePrefersReducedMotion();
  const [paused, setPaused] = useState(false);
  // word -1: the short pause before a line starts (nothing sung yet)
  const [step, setStep] = useState({ line: 0, word: -1 });
  const running = !paused && !reducedMotion && onScreen;

  useEffect(() => {
    if (!running) return;
    const words = DEMO_LINES[step.line];
    const wait = step.word < 0 ? LINE_GAP_MS : words[step.word].ms;
    const timer = window.setTimeout(() => {
      setStep((prev) =>
        prev.word + 1 < DEMO_LINES[prev.line].length
          ? { line: prev.line, word: prev.word + 1 }
          : { line: (prev.line + 1) % DEMO_LINES.length, word: -1 }
      );
    }, wait);
    return () => window.clearTimeout(timer);
  }, [running, step]);

  // Reduced motion: a still frame with the first line half sung
  const shown = reducedMotion ? { line: 0, word: 2 } : step;
  const words = DEMO_LINES[shown.line];
  const nextWords = DEMO_LINES[(shown.line + 1) % DEMO_LINES.length];
  const stepMs = shown.word < 0 ? LINE_GAP_MS : words[shown.word].ms;
  const progressAfterStep =
    (elapsedBefore(shown.line, shown.word) + (reducedMotion ? 0 : stepMs)) / TOTAL_MS;

  // Heights and tempos that look like a spectrum without repeating visibly
  const bars = useMemo(
    () =>
      Array.from({ length: BAR_COUNT }, (_, i) => ({
        height: 30 + ((i * 37) % 67),
        duration: 620 + ((i * 53) % 540),
        delay: -((i * 97) % 900),
      })),
    []
  );

  return (
    <div
      ref={rootRef}
      data-testid="hero-stage-demo"
      data-playing={running}
      className={cn('relative', className)}
    >
      {/* Glow behind the screen */}
      <div
        aria-hidden="true"
        className="ks-aurora pointer-events-none absolute -inset-6 -z-10 opacity-80 blur-2xl sm:-inset-10"
      />

      <div className="overflow-hidden rounded-theme-xl border border-theme-border-subtle bg-theme-surface shadow-theme-lg">
        <div
          role="img"
          aria-label="Preview of a finished song: the lyrics light up word by word in time with the music"
          className="relative isolate flex aspect-[16/10] flex-col items-center justify-center overflow-hidden bg-theme-bg px-4 @container sm:aspect-video"
        >
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-gradient-stage" />
          <div
            aria-hidden="true"
            className={cn(
              'ks-aurora absolute -inset-[20%] -z-10 motion-safe:animate-aurora-drift',
              !running && '[animation-play-state:paused]'
            )}
          />

          <span
            aria-hidden="true"
            className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-theme-pill border border-theme-border-subtle bg-theme-bg/60 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-theme-text backdrop-blur-sm"
          >
            <span className="relative flex h-1.5 w-1.5">
              {running && (
                <span className="absolute inline-flex h-full w-full rounded-full bg-theme-danger opacity-75 motion-safe:animate-ping" />
              )}
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-theme-danger" />
            </span>
            Live preview
          </span>

          <div aria-hidden="true" className="w-full select-none space-y-2 text-center sm:space-y-3">
            <p
              key={shown.line}
              className="flex min-h-[2.5em] flex-wrap content-center justify-center gap-x-[0.28em] font-karaoke text-[clamp(1.1rem,5.4cqw,2.5rem)] font-extrabold leading-[1.2] tracking-tight motion-safe:animate-rise-in"
            >
              {words.map((w, i) => {
                const state = i < shown.word ? 'sung' : i === shown.word ? 'active' : 'ahead';
                return (
                  <span
                    key={i}
                    data-word-state={state}
                    className="relative inline-block whitespace-nowrap text-theme-unsung [text-shadow:0_2px_8px_rgb(var(--theme-bg-rgb)/0.5)]"
                  >
                    {w.text}
                    {state !== 'ahead' && (
                      <span
                        className={cn(
                          'absolute inset-0 text-theme-sung [text-shadow:0_0_16px_rgb(var(--theme-sung-rgb)/0.6)]',
                          state === 'active' && !reducedMotion && 'animate-word-sweep',
                          state === 'active' && !running && '[animation-play-state:paused]'
                        )}
                        style={state === 'active' ? { animationDuration: `${w.ms}ms` } : undefined}
                      >
                        {w.text}
                      </span>
                    )}
                  </span>
                );
              })}
            </p>
            <p
              key={`next-${shown.line}`}
              className="font-karaoke text-[clamp(0.75rem,3cqw,1.2rem)] font-bold text-theme-unsung/55 motion-safe:animate-fade-in"
            >
              {nextWords.map((w) => w.text).join(' ')}
            </p>
          </div>

          {/* Spectrum */}
          <div
            aria-hidden="true"
            className="absolute inset-x-0 bottom-0 grid h-[24%] items-end gap-[1.4%] px-[4%] opacity-45 [mask-image:linear-gradient(to_top,black_35%,transparent)]"
            style={{ gridTemplateColumns: `repeat(${BAR_COUNT}, minmax(0, 1fr))` }}
          >
            {bars.map((bar, i) => (
              <span
                key={i}
                className={cn(
                  'origin-bottom rounded-t-full bg-gradient-accent motion-safe:animate-eq',
                  !running && '[animation-play-state:paused]'
                )}
                style={{
                  height: `${bar.height}%`,
                  animationDuration: `${bar.duration}ms`,
                  animationDelay: `${bar.delay}ms`,
                }}
              />
            ))}
          </div>
        </div>

        {/* Mini transport: the pause button stops the preview */}
        <div className="flex items-center gap-3 border-t border-theme-border-subtle bg-theme-surface px-3 py-1.5">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            disabled={reducedMotion}
            aria-label={paused ? 'Play the lyric preview' : 'Pause the lyric preview'}
            aria-pressed={paused}
            className={cn(
              'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-theme-pill text-theme-text transition-colors hover:bg-theme-surface-subtle disabled:opacity-50',
              focusRing
            )}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-theme-pill bg-gradient-accent text-theme-accent-text shadow-theme-glow">
              {paused || reducedMotion ? (
                <Play className="ml-0.5 h-3.5 w-3.5 fill-current" aria-hidden="true" />
              ) : (
                <Pause className="h-3.5 w-3.5 fill-current" aria-hidden="true" />
              )}
            </span>
          </button>
          <div
            aria-hidden="true"
            className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-theme-pill bg-theme-surface-raised"
          >
            <div
              className="h-full origin-left rounded-theme-pill bg-gradient-accent"
              style={{
                transform: `scaleX(${progressAfterStep.toFixed(4)})`,
                // A new loop snaps back to the start instead of sweeping backwards
                transition:
                  running && !(shown.line === 0 && shown.word < 0)
                    ? `transform ${stepMs}ms linear`
                    : 'none',
              }}
            />
          </div>
          <span
            aria-hidden="true"
            className="hidden shrink-0 items-center gap-1.5 text-[11px] font-medium text-theme-text-muted sm:inline-flex"
          >
            <MicOff className="h-3.5 w-3.5 text-theme-highlight" />
            Vocals removed
          </span>
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-theme-pill border border-theme-border-subtle px-2 py-0.5 font-mono text-[11px] font-semibold text-theme-text-muted"
          >
            <Music2 className="h-3 w-3 text-theme-highlight" />
            Key +2
          </span>
        </div>
      </div>
    </div>
  );
};
