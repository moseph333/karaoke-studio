/**
 * Timeline Empty State
 *
 * What the timeline shows for a song without lyric lines: the way to get lyrics (search for
 * them or paste them, in the Re-import dialog) and, for writing them by hand, the first line.
 */

import React from 'react';
import { Plus, Search } from 'lucide-react';
import { Button } from '../ui/Button';

export interface TimelineEmptyStateProps {
  onFindLyrics: () => void;
  onAddLine: () => void;
}

export const TimelineEmptyState: React.FC<TimelineEmptyStateProps> = ({
  onFindLyrics,
  onAddLine,
}) => (
  <div
    data-testid="timeline-empty-state"
    className="border border-dashed border-theme-border-subtle px-4 py-8 text-center"
  >
    <p className="text-sm font-semibold text-theme-text">No lyric lines yet.</p>
    <p className="mx-auto mb-3 mt-1 max-w-sm text-pretty text-xs text-theme-text-muted">
      Search for the song&apos;s lyrics or paste them, and the studio times every word to the
      singing. Or write them line by line.
    </p>
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button
        onClick={onFindLyrics}
        data-testid="find-lyrics-btn"
        variant="primary"
        size="sm"
        leftIcon={<Search className="h-4 w-4" />}
      >
        Find or paste lyrics
      </Button>
      <Button
        onClick={onAddLine}
        aria-label="+ Add First Lyric Line"
        data-testid="add-line-btn"
        variant="secondary"
        size="sm"
        leftIcon={<Plus className="h-4 w-4" />}
      >
        + Add First Lyric Line
      </Button>
    </div>
  </div>
);
