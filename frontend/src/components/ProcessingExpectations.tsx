/**
 * Processing Expectations
 *
 * What to expect from a song while it is being made, on the processing screen under the
 * tips: how long it takes, that the page can be left, and that the result is automatic and
 * sometimes needs a fix the studio points out. Always the same text, unlike the rotating
 * tips, and outside the live region that announces the stage.
 */

import React from 'react';
import { Clock, DoorOpen, Wand2 } from 'lucide-react';

const EXPECTATIONS: { Icon: typeof Clock; text: string }[] = [
  {
    Icon: Clock,
    text: 'Most songs take a few minutes. The estimate above settles once the vocals are being separated.',
  },
  {
    Icon: DoorOpen,
    text: 'You do not have to wait here. The song will be in your library when it is done.',
  },
  {
    Icon: Wand2,
    text: 'It is all automatic, so now and then a lyric is wrong or a line is out of time. The studio marks what to check and has a fix for each.',
  },
];

export const ProcessingExpectations: React.FC = () => (
  <section
    aria-labelledby="processing-expectations-heading"
    data-testid="processing-expectations"
    className="mx-auto max-w-md space-y-2 text-left"
  >
    <h2
      id="processing-expectations-heading"
      className="text-[11px] font-semibold uppercase tracking-[0.12em] text-theme-text-muted"
    >
      What to expect
    </h2>
    <ul className="space-y-1.5">
      {EXPECTATIONS.map(({ Icon, text }) => (
        <li key={text} className="flex items-start gap-2.5 text-xs text-theme-text-muted">
          <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-theme-highlight" aria-hidden="true" />
          <span className="min-w-0 text-pretty">{text}</span>
        </li>
      ))}
    </ul>
  </section>
);
