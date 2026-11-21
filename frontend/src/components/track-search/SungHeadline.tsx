/**
 * Sung Headline
 *
 * The home screen's headline, sung once like a karaoke line when the app first opens: each
 * word fills with the lit colour in turn and the line stays lit. It is the page's one
 * flourish, so it does not loop and does not replay when the home screen comes back.
 *
 * The lit copy of each word is hidden from assistive tech, which reads the plain sentence.
 * Viewers who ask for reduced motion get the line already lit.
 */

import React, { useEffect, useState } from 'react';
import { cn } from '../../utils/cn';

/** The headline as two sung lines: each word and how long it is held, in milliseconds. */
const LINES: Array<Array<[word: string, ms: number]>> = [
  [
    ['Turn', 300],
    ['any', 260],
    ['song', 560],
  ],
  [
    ['into', 320],
    ['karaoke', 900],
  ],
];

/** The pause before the first word, so the page has settled when the line starts. */
const LEAD_IN_MS = 450;

// Sung on the first arrival only: returning from a song shows the line already lit
let alreadySung = false;

export interface SungHeadlineProps {
  /** One smaller line, for visitors who have songs and came for the search box. */
  compact?: boolean;
  className?: string;
}

export const SungHeadline: React.FC<SungHeadlineProps> = ({ compact = false, className }) => {
  const [sing] = useState(() => !alreadySung);
  useEffect(() => {
    alreadySung = true;
  }, []);

  let startsAt = LEAD_IN_MS;
  return (
    <h1
      tabIndex={-1}
      data-view-heading
      className={cn(
        'ks-display font-black text-theme-text focus:outline-none',
        compact
          ? 'text-[clamp(44px,7vw,96px)] leading-[0.9]'
          : 'text-[clamp(64px,13vw,180px)] leading-[0.84]',
        className
      )}
    >
      {LINES.map((words, lineIndex) => (
        <span key={lineIndex} className={cn(!compact && 'block')}>
          {words.map(([word, ms]) => {
            const delay = startsAt;
            startsAt += ms;
            return (
              <React.Fragment key={word}>
                <span className="relative inline-block">
                  {word}
                  <span
                    aria-hidden="true"
                    data-sung-word
                    className={cn(
                      'absolute inset-0 text-theme-accent',
                      sing && 'motion-safe:animate-word-sweep'
                    )}
                    style={
                      sing
                        ? { animationDelay: `${delay}ms`, animationDuration: `${ms}ms` }
                        : undefined
                    }
                  >
                    {word}
                  </span>
                </span>{' '}
              </React.Fragment>
            );
          })}
        </span>
      ))}
    </h1>
  );
};
