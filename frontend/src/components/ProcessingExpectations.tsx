/**
 * Processing Expectations
 *
 * What to expect from a song while it is being made, on the processing screen under the
 * tips: how long it takes, that the page can be left, and that the result is automatic and
 * sometimes needs a fix the studio points out. Always the same text, unlike the rotating
 * tips, and outside the live region that announces the stage.
 */

import React from 'react';
const EXPECTATIONS: string[] = [
  'Most songs take a few minutes. The estimate above settles once the vocals are being separated.',
  'You do not have to wait here. The song will be in your library when it is done.',
  'It is all automatic, so now and then a lyric is wrong or a line is out of time. The studio marks what to check and has a fix for each.',
];

export const ProcessingExpectations: React.FC = () => (
  <section
    aria-labelledby="processing-expectations-heading"
    data-testid="processing-expectations"
    className="max-w-xl space-y-2"
  >
    <h2
      id="processing-expectations-heading"
      className="ks-display text-[28px] font-black text-theme-text"
    >
      What to expect
    </h2>
    <ul className="space-y-1.5">
      {EXPECTATIONS.map((text) => (
        <li key={text} className="text-pretty text-base text-theme-text-muted">
          {text}
        </li>
      ))}
    </ul>
  </section>
);
