/**
 * Timeline Filter Hook
 *
 * Derives the review state of the lyric timeline (which lines need attention and why)
 * and the list of rows to show for the active filter.
 */

import { useMemo, useState } from 'react';
import { LyricLine } from '../types';
import { collectLineIssues, LineIssue } from '../utils/timelineReview';

export type TimelineFilter = 'all' | 'review';

export interface TimelineRow {
  line: LyricLine;
  /** Position of the line in the full (unfiltered) list. */
  index: number;
}

export interface UseTimelineFilterReturn {
  filter: TimelineFilter;
  setFilter: (filter: TimelineFilter) => void;
  issuesById: Map<number, LineIssue[]>;
  reviewCount: number;
  rows: TimelineRow[];
}

export function useTimelineFilter(lines: LyricLine[]): UseTimelineFilterReturn {
  const [filter, setFilter] = useState<TimelineFilter>('all');
  const issuesById = useMemo(() => collectLineIssues(lines), [lines]);
  const rows = useMemo(() => {
    const all = lines.map((line, index) => ({ line, index }));
    return filter === 'review' ? all.filter((row) => issuesById.has(row.line.id)) : all;
  }, [lines, filter, issuesById]);

  return { filter, setFilter, issuesById, reviewCount: issuesById.size, rows };
}
