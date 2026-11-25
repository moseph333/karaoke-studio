/**
 * First Song Card
 *
 * The getting-started steps a first-time user sees above the stage: play, check the lyrics,
 * set the key, make a video. The wording is short on purpose: four steps share one row from
 * `lg` up, in a column that is about 600px wide there. Each step is a button that goes to the place it names, and
 * "Show me around" beside the heading starts the tour that points every part out. A plain
 * section, never a dialog: the song stays playable and the keyboard shortcuts keep working
 * while it is shown. `hooks/useFirstSongGuide` decides whether it is shown.
 */

import React from 'react';
import { Download, ListChecks, Play, SlidersHorizontal, X } from 'lucide-react';
import { GUIDE_ACTION_LABELS, type GuideAction } from '../../utils/guideActions';
import { cn } from '../../utils/cn';
import { IconButton } from '../ui/IconButton';
import { focusRing } from '../ui/variants';

export interface FirstSongCardProps {
  /** How many things the song check-up says to fix. */
  toCheck: number;
  onAction: (action: GuideAction) => void;
  onDismiss: () => void;
}

interface Step {
  action: GuideAction;
  Icon: typeof Play;
  title: string;
  hint: string;
}

const textLink = cn(
  // A 44px target on phones that does not make the card taller
  '-my-3 inline-flex min-h-[44px] items-center text-left text-xs text-theme-text-muted underline decoration-theme-border underline-offset-2 hover:text-theme-text md:-my-1 md:min-h-[24px]',
  focusRing
);

const steps = (toCheck: number): Step[] => [
  { action: 'play', Icon: Play, title: 'Play and sing', hint: 'Words light up' },
  toCheck > 0
    ? {
        action: 'checkup',
        Icon: ListChecks,
        title: 'Check lyrics',
        hint: `${toCheck} to look at`,
      }
    : {
        action: 'timeline',
        Icon: ListChecks,
        title: 'Check lyrics',
        hint: 'Words and timing',
      },
  { action: 'mix', Icon: SlidersHorizontal, title: 'Set your key', hint: 'Plus guide vocal' },
  { action: 'export', Icon: Download, title: 'Make a video', hint: 'Or subtitles' },
];

export const FirstSongCard: React.FC<FirstSongCardProps> = ({ toCheck, onAction, onDismiss }) => (
  <section
    aria-labelledby="first-song-heading"
    data-testid="first-song-card"
    className="flex flex-wrap items-center gap-x-5 gap-y-1 border-y border-theme-border-subtle py-1.5"
  >
    <div className="order-1 min-w-0 flex-1 xl:flex-none">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <h2 id="first-song-heading" className="ks-display text-[22px] text-theme-text">
          Your first song
        </h2>
        <button type="button" onClick={() => onAction('tour')} className={textLink}>
          {GUIDE_ACTION_LABELS.tour}
        </button>
      </div>
      <button type="button" onClick={() => onAction('help-fix')} className={textLink}>
        Something off? Fix a problem
      </button>
    </div>
    <ol className="order-3 grid basis-full grid-cols-2 gap-2 lg:grid-cols-4 xl:order-2 xl:basis-0 xl:flex-1">
      {steps(toCheck).map(({ action, Icon, title, hint }, index) => (
        <li key={title} className="min-w-0">
          <button
            type="button"
            onClick={() => onAction(action)}
            data-step={index + 1}
            className={cn(
              'group flex min-h-[44px] w-full min-w-0 items-center gap-2 text-left',
              focusRing
            )}
          >
            <Icon className="h-4 w-4 shrink-0 text-theme-text-muted" aria-hidden="true" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-semibold text-theme-text underline-offset-4 group-hover:underline">
                <span className="sr-only">Step </span>
                {index + 1}. {title}
              </span>
              <span
                className={cn(
                  'block truncate text-xs',
                  action === 'checkup'
                    ? 'font-semibold text-theme-warning'
                    : 'text-theme-text-muted'
                )}
              >
                {hint}
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
    <IconButton
      icon={<X className="h-4 w-4" aria-hidden="true" />}
      label="Hide the first-song steps"
      tooltipAlign="end"
      onClick={onDismiss}
      wrapperClassName="order-2 xl:order-3"
    />
  </section>
);
