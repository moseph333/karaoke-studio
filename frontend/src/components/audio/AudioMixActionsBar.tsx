/**
 * Audio Mix Actions Bar Component
 *
 * Shows the current instrumental source and lets the user replace it with their own
 * backing track. Mix settings apply automatically, so there is no apply step.
 */

import React from 'react';
import { Upload } from 'lucide-react';
import { Spinner } from '../ui/Spinner';
import { focusRing } from '../ui/variants';
import { cn } from '../../utils/cn';

export interface AudioMixActionsBarProps {
  uploadingInst: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onInstrumentalUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  /** True when the instrumental is a user upload rather than the separated stem. */
  isCustomInstrumental?: boolean;
}

export const AudioMixActionsBar: React.FC<AudioMixActionsBarProps> = ({
  uploadingInst,
  fileInputRef,
  onInstrumentalUpload,
  isCustomInstrumental = false,
}) => {
  return (
    <div className="flex flex-col gap-2" data-testid="instrumental-source">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-theme-text">Instrumental</span>
          <span className="block truncate text-sm text-theme-text-muted">
            {isCustomInstrumental ? 'Custom backing track' : 'Separated stem'}
          </span>
        </span>
        <input
          type="file"
          ref={fileInputRef}
          onChange={onInstrumentalUpload}
          accept="audio/*"
          aria-label="Upload custom instrumental audio file"
          className="hidden"
        />
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingInst}
          aria-label="Replace instrumental file"
          className={cn(
            'ks-display inline-flex min-h-[44px] md:min-h-[32px] items-center gap-1.5 border border-theme-border px-3 text-[20px] text-theme-text transition-colors hover:bg-theme-text hover:text-theme-text-inverse disabled:opacity-50',
            focusRing
          )}
        >
          {uploadingInst ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {uploadingInst ? 'Uploading...' : 'Replace'}
        </button>
      </div>
    </div>
  );
};
