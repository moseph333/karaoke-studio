/**
 * Audio Playback Error Banner Component
 *
 * Displays HTMLMediaElement error diagnostic details with an immediate
 * retry playback action button.
 */

import React from 'react';
import { RotateCcw, AlertCircle } from 'lucide-react';
import type { AudioPlaybackError } from '../../utils/audioErrors';

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
      className="mb-4 p-3.5 rounded-xl bg-red-950/70 border border-red-800/80 text-red-200 text-xs flex flex-wrap items-center justify-between gap-3 shadow-lg"
    >
      <div className="flex items-center gap-2.5 min-w-0">
        <AlertCircle className="w-4 h-4 text-red-400 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-semibold text-red-300">Playback Error: {playbackError.codeName}</p>
          <p className="text-[11px] text-slate-300 font-mono mt-0.5">{playbackError.message}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetryPlayback}
        className="px-3 py-1.5 rounded-lg bg-red-800/80 hover:bg-red-700 text-white font-medium text-xs transition-colors flex items-center gap-1.5 focus:outline-none focus:ring-2 focus:ring-red-400 shadow"
        aria-label="Retry playback"
      >
        <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
        Retry Playback
      </button>
    </div>
  );
};
