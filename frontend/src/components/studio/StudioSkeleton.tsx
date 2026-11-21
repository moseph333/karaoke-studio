/**
 * Studio Skeleton
 *
 * Placeholder with the studio's shape (song header, stage, timeline, inspector), shown for
 * the moment the studio's code is still being fetched after a song is opened.
 */

import React, { useEffect } from 'react';
import { Skeleton } from '../ui/Skeleton';

export const StudioSkeleton: React.FC = () => (
  <div
    data-testid="studio-skeleton"
    role="status"
    aria-label="Opening the studio"
    className="mx-auto grid w-full max-w-screen-2xl gap-4 px-3 py-4 sm:px-4 md:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:px-6"
  >
    <div className="min-w-0 space-y-4">
      <div className="flex items-center gap-3">
        <Skeleton className="h-12 w-12 shrink-0" />
        <div className="min-w-0 flex-1 space-y-2">
          <Skeleton className="h-5 w-48 max-w-full" />
          <Skeleton className="h-3.5 w-64 max-w-full" />
        </div>
      </div>
      <Skeleton className="mx-auto aspect-video w-full max-w-2xl" />
      <div className="space-y-2 border-t-2 border-theme-border pt-4">
        <Skeleton className="h-5 w-32" />
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    </div>
    <div className="hidden space-y-3 border-t-2 border-theme-border pt-4 md:block">
      <Skeleton className="h-5 w-28" />
      <Skeleton className="h-20 w-full" />
      <Skeleton className="h-10 w-full" />
      <Skeleton className="h-10 w-full" />
    </div>
  </div>
);

/**
 * Renders nothing; calls `onShown` once it mounts. Placed beside a lazy component inside the
 * same Suspense boundary, it fires when that component is on screen (not its fallback).
 */
export const WhenShown: React.FC<{ onShown: () => void }> = ({ onShown }) => {
  useEffect(() => {
    onShown();
    // Runs once per mount: the callback's identity does not matter
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
};
