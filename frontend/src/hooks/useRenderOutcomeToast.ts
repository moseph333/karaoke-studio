/**
 * One toast when a video render ends: the video is ready (with a button that opens the
 * Export dialog) or the render failed. A render that had already ended when the song was
 * opened does not toast, and a cancelled one ends quietly.
 */

import { useEffect, useRef } from 'react';
import { ProjectState } from '../types';
import { useToast } from './useToast';

const RENDERING: ReadonlyArray<string | undefined> = ['queued', 'rendering'];

export function useRenderOutcomeToast(
  project: Pick<ProjectState, 'id' | 'render_status' | 'render_error'> | null,
  onOpenExport: () => void
): void {
  const { toast } = useToast();
  const seen = useRef<{ id: string; status?: string } | null>(null);
  const openExportRef = useRef(onOpenExport);
  useEffect(() => {
    openExportRef.current = onOpenExport;
  }, [onOpenExport]);

  const id = project?.id;
  const status = project?.render_status;
  const error = project?.render_error;

  useEffect(() => {
    if (!id) return;
    const previous = seen.current;
    seen.current = { id, status };
    if (!previous || previous.id !== id || !RENDERING.includes(previous.status)) return;
    if (status === 'completed') {
      toast.show('Karaoke video rendered', 'success', 8000, {
        label: 'Open export',
        onClick: () => openExportRef.current(),
      });
    } else if (status === 'error') {
      toast.error(error ? `Video render failed: ${error}` : 'Video render failed', 8000);
    }
  }, [id, status, error, toast]);
}
