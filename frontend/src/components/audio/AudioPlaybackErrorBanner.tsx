/**
 * Audio Playback Error Banner Component
 *
 * Displays HTMLMediaElement error diagnostic details with an immediate
 * retry playback action button.
 */

import React from 'react';
import { RotateCcw, AlertCircle } from 'lucide-react';
import type { AudioPlaybackError } from '../../utils/audioErrors';
import { Button } from '../ui/Button';

export interface AudioPlaybackErrorBannerProps {
  playbackError: AudioPlaybackError;
  onRetryPlayback: () => void;
}

export const AudioPlaybackErrorBanner: React.FC<AudioPlaybackErrorBannerProps> = ({
  playbackError,
  onRetryPlayback,
}) => {
  return (
    <div
      data-testid="audio-error-banner"
      role="alert"
      aria-live="assertive"
      className="flex flex-wrap items-center justify-between gap-3 rounded-theme-lg border border-theme-danger/40 bg-theme-danger/10 p-3 text-xs text-theme-text"
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <AlertCircle className="h-4 w-4 shrink-0 text-theme-danger" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold text-theme-danger">
            Playback Error: {playbackError.codeName}
          </p>
          <p className="mt-0.5 break-words font-mono text-[11px] text-theme-text-muted">
            {playbackError.message}
          </p>
        </div>
      </div>
      <Button
        variant="destructive"
        size="sm"
        onClick={onRetryPlayback}
        aria-label="Retry playback"
        leftIcon={<RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />}
      >
        Retry Playback
      </Button>
    </div>
  );
};
