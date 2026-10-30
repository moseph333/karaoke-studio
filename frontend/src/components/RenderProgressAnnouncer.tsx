/**
 * Reads out video render progress for screen readers: the start and each quarter, nothing in
 * between. The export dialog's progress refreshes every second, so it is not a live region;
 * the outcome toasts announce the finish or a failure.
 */

import React, { useEffect, useRef, useState } from 'react';
import { ProjectState } from '../types';

const MILESTONES = [25, 50, 75];

export const RenderProgressAnnouncer: React.FC<{
  project: Pick<ProjectState, 'id' | 'render_status' | 'render_progress'>;
}> = ({ project }) => {
  const { id, render_status: status, render_progress: progress = 0 } = project;
  const [message, setMessage] = useState('');
  // The render being announced and the last milestone read out for it
  const announcedRef = useRef<{ id: string; milestone: number } | null>(null);

  useEffect(() => {
    if (status !== 'queued' && status !== 'rendering') {
      announcedRef.current = null;
      setMessage('');
      return;
    }
    const announced = announcedRef.current?.id === id ? announcedRef.current : null;
    if (!announced) {
      announcedRef.current = { id, milestone: 0 };
      setMessage('Video render started');
      return;
    }
    const reached = MILESTONES.filter((m) => progress >= m).pop() ?? 0;
    if (reached > announced.milestone) {
      announcedRef.current = { id, milestone: reached };
      setMessage(`Rendering video, ${reached} percent`);
    }
  }, [id, status, progress]);

  return (
    <div
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-testid="render-progress-announcer"
    >
      {message}
    </div>
  );
};
