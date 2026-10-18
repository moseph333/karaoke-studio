/**
 * Audio Mix Actions Bar Component
 *
 * Renders bottom actions for applying audio mix (pitch & guide vocal) to preview
 * playback and uploading custom instrumental audio files.
 */

import React from 'react';
import { Music2, Upload } from 'lucide-react';
import { Tooltip } from '../Tooltip';

export interface AudioMixActionsBarProps {
  isApplyingMix: boolean;
  uploadingInst: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onApplyAudioMix: () => void;
  onInstrumentalUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

export const AudioMixActionsBar: React.FC<AudioMixActionsBarProps> = ({
  isApplyingMix,
  uploadingInst,
  fileInputRef,
  onApplyAudioMix,
  onInstrumentalUpload,
}) => {
  return (
    <div className="mt-4 pt-4 border-t border-slate-800/60 flex flex-wrap items-center justify-between gap-3 text-xs">
      <div className="flex flex-col sm:flex-row sm:items-center gap-2 w-full sm:w-auto">
        <Tooltip
          content="Apply pitch & vocal blend settings"
          position="top"
          className="w-full sm:w-auto"
        >
          <button
            type="button"
            onClick={onApplyAudioMix}
            disabled={isApplyingMix}
            aria-label="Apply audio mix settings to playback"
            className="w-full sm:w-auto min-h-[44px] justify-center px-3.5 py-1.5 rounded-lg bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 font-medium transition-all flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            {isApplyingMix ? (
              <span
                className="w-3 h-3 border-2 border-cyan-300 border-t-transparent rounded-full animate-spin"
                role="status"
                aria-label="Applying mix"
              ></span>
            ) : (
              <Music2 className="w-3.5 h-3.5" aria-hidden="true" />
            )}
            Apply Audio Mix
          </button>
        </Tooltip>
        <span className="text-slate-500 text-[11px]">
          Updates pitch & vocal blend in preview player
        </span>
      </div>

      <div className="w-full sm:w-auto">
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
          className="w-full sm:w-auto min-h-[44px] justify-center px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition-colors flex items-center gap-1.5 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-400"
        >
          <Upload className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
          {uploadingInst ? 'Uploading...' : 'Replace Instrumental File'}
        </button>
      </div>
    </div>
  );
};
