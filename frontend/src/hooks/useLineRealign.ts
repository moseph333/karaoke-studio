/**
 * Re-align one lyric line: asks the server where the line is sung near its current timing
 * (POST /api/project/:id/realign-line) and hands the re-timed line back as an undoable edit.
 */

import { useCallback, useRef, useState } from 'react';
import { apiFetch } from '../api';
import type { LyricLine, RealignLineResult } from '../types';
import { realignBounds } from '../utils/lineRealign';
import { useToast } from './useToast';

export interface UseLineRealignOptions {
  projectId?: string;
  lines: LyricLine[];
  /** Applies the re-timed line (the editor records it for undo). */
  onApply: (lineId: number, line: LyricLine) => void;
}

const sameTiming = (a: LyricLine, b: LyricLine) =>
  a.text === b.text && a.start_time === b.start_time && a.end_time === b.end_time;

export function useLineRealign({ projectId, lines, onApply }: UseLineRealignOptions) {
  const { toast } = useToast();
  const [realigningLineId, setRealigningLineId] = useState<number | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const onApplyRef = useRef(onApply);
  onApplyRef.current = onApply;
  const busyRef = useRef(false);

  const realignLine = useCallback(
    async (lineId: number) => {
      const all = linesRef.current;
      const index = all.findIndex((l) => l.id === lineId);
      if (!projectId || index < 0 || busyRef.current) return;
      const line = all[index];
      busyRef.current = true;
      setRealigningLineId(lineId);
      try {
        const res = await apiFetch(`/api/project/${projectId}/realign-line`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ line, ...realignBounds(all, index) }),
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          throw new Error(typeof data?.detail === 'string' ? data.detail : 'Could not re-align');
        }
        const result = data as RealignLineResult;
        if (result.status !== 'ok') {
          toast.info(result.detail || 'No singing found near this line');
          return;
        }
        // Keep a hand edit made while the server was working
        const latest = linesRef.current.find((l) => l.id === lineId);
        if (!latest || !sameTiming(latest, line)) {
          toast.info('This line was edited meanwhile, so your edit was kept');
          return;
        }
        onApplyRef.current(lineId, { ...result.line, id: lineId, singer: line.singer });
        const moved = result.line.start_time - line.start_time;
        const shift =
          Math.abs(moved) >= 0.05 ? ` (moved ${moved > 0 ? '+' : ''}${moved.toFixed(2)}s)` : '';
        const engine = result.engine === 'ctc' ? ' with the neural aligner' : '';
        toast.success(`Line ${lineId} re-aligned${engine}${shift}`);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Could not re-align this line');
      } finally {
        busyRef.current = false;
        setRealigningLineId(null);
      }
    },
    [projectId, toast]
  );

  return { realigningLineId, realignLine };
}
