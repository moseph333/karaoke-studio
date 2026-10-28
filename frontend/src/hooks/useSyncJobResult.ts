/**
 * Watches a background lyric re-alignment for the timeline editor. Without unsaved edits the
 * editor picks up the new lines by itself; when a re-alignment the editor saw running
 * finishes while it holds unsaved edits, the new lines wait until the user loads them or
 * keeps their edits.
 */

import { useEffect, useRef, useState } from 'react';
import type { LyricLine, SyncJob } from '../types';

export interface UseSyncJobResultOptions {
  syncJob?: SyncJob | null;
  /** The song's saved lines (they change when a re-alignment finishes). */
  lines: LyricLine[];
  hasUnsavedChanges: boolean;
  onAdopt: (lines: LyricLine[]) => void;
}

export function useSyncJobResult({
  syncJob,
  lines,
  hasUnsavedChanges,
  onAdopt,
}: UseSyncJobResultOptions) {
  const [readyLines, setReadyLines] = useState<LyricLine[] | null>(null);
  const watching = useRef<string | null>(null);
  const latest = useRef({ lines, hasUnsavedChanges });
  latest.current = { lines, hasUnsavedChanges };
  const id = syncJob?.id;
  const status = syncJob?.status;

  useEffect(() => {
    if (!id) return;
    if (status === 'queued' || status === 'running') {
      watching.current = id;
      setReadyLines(null);
      return;
    }
    if (watching.current !== id) return;
    watching.current = null;
    if (status === 'done' && latest.current.hasUnsavedChanges) {
      setReadyLines(latest.current.lines);
    }
  }, [id, status]);

  return {
    hasReadyResult: readyLines !== null,
    loadResult: () => {
      if (readyLines) onAdopt(readyLines);
      setReadyLines(null);
    },
    keepEdits: () => setReadyLines(null),
  };
}
