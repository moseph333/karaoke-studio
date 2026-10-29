/**
 * Separation Quality Picker
 *
 * Fast / Balanced / Best as a radio group of cards: what each preset does, roughly how long
 * it takes on CPU, and whether this server can run it (with the reason when it cannot).
 */

import React, { useId } from 'react';
import type { SeparationPreset, StudioCapabilities } from '../../types';
import {
  PRESET_BLURBS,
  PRESET_NAMES,
  SEPARATION_PRESET_ORDER,
  defaultPreset,
  presetInfo,
  separationEstimate,
} from '../../utils/quality';
import { cn } from '../../utils/cn';
import { Badge } from '../ui/Badge';

export interface SeparationQualityPickerProps {
  value: SeparationPreset;
  onChange: (preset: SeparationPreset) => void;
  /** Server capabilities; until they arrive every preset is offered with typical timings. */
  capabilities?: StudioCapabilities['separation'] | null;
  /** Song length in seconds, for estimates such as "about 6 min on CPU". */
  durationSeconds?: number | null;
  /** The preset that made the song's current stems (re-separation). */
  currentPreset?: SeparationPreset | 'custom' | null;
  legend: string;
  /** Radio group name; must be unique on the page. */
  name: string;
  disabled?: boolean;
  className?: string;
}

export const SeparationQualityPicker: React.FC<SeparationQualityPickerProps> = ({
  value,
  onChange,
  capabilities,
  durationSeconds,
  currentPreset,
  legend,
  name,
  disabled = false,
  className,
}) => {
  const baseId = useId();
  const serverDefault = defaultPreset(capabilities);

  return (
    <fieldset className={cn('min-w-0 space-y-2', className)} disabled={disabled}>
      <legend className="mb-2 text-xs font-semibold text-theme-text">{legend}</legend>
      <div className="grid gap-2 sm:grid-cols-3">
        {SEPARATION_PRESET_ORDER.map((preset) => {
          const info = presetInfo(preset, capabilities);
          const unavailable = info.available === false;
          const checked = value === preset;
          const titleId = `${baseId}-${preset}-title`;
          const descId = `${baseId}-${preset}-desc`;
          const needsDownload =
            info.engine === 'roformer' && info.weights_cached === false && !unavailable;
          return (
            <label
              key={preset}
              data-testid={`separation-quality-${preset}`}
              className={cn(
                'relative flex min-h-[44px] cursor-pointer flex-col gap-1.5 rounded-theme-lg border p-3 text-left transition-colors',
                checked
                  ? 'border-theme-accent bg-theme-accent/10 shadow-theme-sm'
                  : 'border-theme-border-subtle bg-theme-surface hover:border-theme-border',
                'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-theme-focus',
                unavailable && 'cursor-not-allowed opacity-60'
              )}
            >
              <span className="flex flex-wrap items-center gap-2">
                <input
                  type="radio"
                  name={name}
                  value={preset}
                  checked={checked}
                  disabled={unavailable}
                  onChange={() => onChange(preset)}
                  aria-labelledby={titleId}
                  aria-describedby={descId}
                  className="h-4 w-4 shrink-0 cursor-pointer accent-[rgb(var(--theme-accent-rgb))] focus:outline-none"
                />
                <span id={titleId} className="font-theme-heading text-sm font-semibold">
                  {PRESET_NAMES[preset]}
                </span>
                {currentPreset === preset ? (
                  <Badge tone="accent">Current</Badge>
                ) : preset === serverDefault && !currentPreset ? (
                  <Badge tone="neutral">Default</Badge>
                ) : null}
              </span>
              <span id={descId} className="space-y-1 text-xs text-theme-text-muted">
                <span className="block">{PRESET_BLURBS[preset]}</span>
                <span className="block font-medium text-theme-text/80">
                  {separationEstimate(info.cpu_realtime_factor, durationSeconds, info.runs_on)}
                  {info.gpu_recommended ? ' · GPU recommended' : ''}
                </span>
                {unavailable ? (
                  <span className="block text-theme-warning">
                    Not available here{info.reason ? `: ${info.reason}` : ''}
                  </span>
                ) : needsDownload ? (
                  <span className="block">Downloads its model on first use</span>
                ) : null}
              </span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
};
