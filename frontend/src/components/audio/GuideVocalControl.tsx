/**
 * Guide Vocal Control Component
 *
 * Blends the original vocal stem (0% to 50%) into playback as a singing reference.
 * The value updates live while dragging and is committed (re-mixed) on release.
 */

import React from 'react';
import { Tooltip } from '../Tooltip';
import { Slider } from '../ui/Slider';

export interface GuideVocalControlProps {
  guideVolume: number;
  onGuideVolumeChange: (val: number) => void;
  /** Fires once the user releases the slider. */
  onGuideVolumeCommit?: (val: number) => void;
  disabled?: boolean;
}

const GUIDE_MAX = 0.5;

export const GuideVocalControl: React.FC<GuideVocalControlProps> = ({
  guideVolume,
  onGuideVolumeChange,
  onGuideVolumeCommit,
  disabled = false,
}) => {
  const percent = Math.round(guideVolume * 100);

  return (
    <div className="flex flex-col gap-2" data-testid="guide-vocal-control">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-theme-text-muted">
          Guide vocal
        </span>
        <span className="font-mono text-xs font-semibold tabular-nums text-theme-text">
          {percent}%
        </span>
      </div>
      <Tooltip content="Adjust guide vocal blend (0%–50%)" position="top" className="w-full">
        <Slider
          label="Guide vocal volume level"
          value={guideVolume}
          min={0}
          max={GUIDE_MAX}
          step={0.05}
          onChange={onGuideVolumeChange}
          onChangeEnd={onGuideVolumeCommit}
          valueText={(v) => `${Math.round(v * 100)}% guide vocal`}
          disabled={disabled}
          tone="sung"
        />
      </Tooltip>
      <div
        className="flex items-center justify-between text-[10px] text-theme-text-muted"
        aria-hidden="true"
      >
        <span>Off</span>
        <span>Subtle</span>
        <span>Loud</span>
      </div>
    </div>
  );
};
