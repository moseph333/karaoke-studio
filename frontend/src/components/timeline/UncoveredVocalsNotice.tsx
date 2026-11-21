/**
 * Uncovered Vocals Notice
 *
 * Above the timeline when the vocal stem sings where no lyric line is shown, such as a hook
 * the lyrics wrote once but the song repeats: lists each stretch, and a click plays it so
 * the missing words can be added.
 */

import React from 'react';
import { AudioLines } from 'lucide-react';
import type { VocalSpan } from '../../utils/uncoveredVocals';
import { formatTime } from '../../utils/format';

export interface UncoveredVocalsNoticeProps {
  spans: VocalSpan[];
  onSeek: (time: number) => void;
}

export const UncoveredVocalsNotice: React.FC<UncoveredVocalsNoticeProps> = ({ spans, onSeek }) => {
  if (spans.length === 0) return null;
  return (
    <div
      data-testid="uncovered-vocals-notice"
      className="flex flex-wrap items-center gap-1.5 border border-theme-warning px-2.5 py-1.5 text-xs text-theme-text"
    >
      <AudioLines className="h-3.5 w-3.5 shrink-0 text-theme-warning" aria-hidden="true" />
      <span className="font-semibold">Vocals without lyrics:</span>
      {spans.map((span) => (
        <button
          key={`${span.start}-${span.end}`}
          type="button"
          onClick={() => onSeek(span.start)}
          aria-label={`Play the vocals without lyrics from ${formatTime(span.start)} to ${formatTime(span.end)}`}
          className="inline-flex min-h-[44px] items-center px-1.5 tabular-nums text-theme-text underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-theme-focus/60"
        >
          {formatTime(span.start)}–{formatTime(span.end)}
        </button>
      ))}
    </div>
  );
};
