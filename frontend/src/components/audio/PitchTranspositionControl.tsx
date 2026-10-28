/**
 * Pitch Transposition Control Component
 *
 * Semitone key steppers (-12 to +12), a key position meter, instant reset, the detected
 * vocal range summary and the Smart Key Recommender launcher. Key changes apply
 * automatically; the status pill reports a queued or in-flight re-pitch.
 */

import React from 'react';
import { Minus, Plus, Sparkles, Mic, RotateCcw } from 'lucide-react';
import { Tooltip } from '../Tooltip';
import { Spinner } from '../ui/Spinner';
import { Badge } from '../ui/Badge';
import { focusRing } from '../ui/variants';
import { cn } from '../../utils/cn';
import { formatSemitonesShort } from '../../utils/format';
import { VocalRangeData } from '../../types';

export interface PitchTranspositionControlProps {
  semitones: number;
  onSemitoneChange: (delta: number) => void;
  onResetPitch: () => void;
  vocalRange?: VocalRangeData | null;
  onOpenRecommender?: () => void;
  onAnalyzeVocalRange?: () => void;
  isAnalyzingRange?: boolean;
  /** A key change is waiting for the debounced re-pitch. */
  isMixPending?: boolean;
  /** Last key applied to the master mix; pending is inferred when it differs. */
  appliedSemitones?: number;
  /** The server is re-rendering the master mix. */
  isRemixing?: boolean;
}

const MIN_SEMITONES = -12;
const MAX_SEMITONES = 12;

const stepperClass = cn(
  'flex min-h-[44px] min-w-[44px] md:min-h-[40px] md:min-w-[40px] items-center justify-center rounded-theme-md border border-theme-border-subtle bg-theme-surface-raised text-theme-text transition-colors hover:border-theme-border hover:bg-theme-surface-subtle active:scale-95 disabled:cursor-not-allowed disabled:opacity-40',
  focusRing
);

function describeSemitones(semitones: number): string {
  if (semitones === 0) return 'Original key';
  const n = Math.abs(semitones);
  return `${n} semitone${n === 1 ? '' : 's'} ${semitones > 0 ? 'up' : 'down'}`;
}

export const PitchTranspositionControl: React.FC<PitchTranspositionControlProps> = ({
  semitones,
  onSemitoneChange,
  onResetPitch,
  vocalRange,
  onOpenRecommender,
  onAnalyzeVocalRange,
  isAnalyzingRange = false,
  isMixPending,
  appliedSemitones,
  isRemixing = false,
}) => {
  const isPending =
    isMixPending !== undefined
      ? isMixPending
      : appliedSemitones !== undefined && semitones !== appliedSemitones;
  const meterPosition = ((semitones - MIN_SEMITONES) / (MAX_SEMITONES - MIN_SEMITONES)) * 100;
  const hasRange = Boolean(
    vocalRange && vocalRange.is_voiced && vocalRange.lowest_note && vocalRange.highest_note
  );

  return (
    <div className="flex flex-col gap-3" data-testid="pitch-transposition-control">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold uppercase tracking-[0.08em] text-theme-text-muted">
          Key
        </span>
        {(isRemixing || isPending) && (
          <Badge
            data-testid="pitch-pending-mix-badge"
            tone={isRemixing ? 'accent' : 'neutral'}
            icon={isRemixing ? <Spinner className="h-3 w-3" /> : undefined}
            dot={!isRemixing}
            pulse={!isRemixing}
            title={
              isRemixing
                ? 'Re-rendering the mix in the new key'
                : 'The new key applies automatically in a moment'
            }
          >
            {isRemixing ? 'Re-pitching…' : 'Applying…'}
          </Badge>
        )}
      </div>

      <div className="flex items-center gap-2">
        <Tooltip content="Lower key by 1 semitone (-12 min)" position="top">
          <button
            type="button"
            onClick={() => onSemitoneChange(-1)}
            disabled={semitones <= MIN_SEMITONES}
            aria-label="Decrease pitch by one semitone"
            className={stepperClass}
          >
            <Minus className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>

        <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5 rounded-theme-md bg-theme-surface-subtle px-3 py-2">
          <span
            data-testid="pitch-readout"
            aria-hidden="true"
            className={cn(
              'font-theme-heading text-2xl font-semibold tabular-nums leading-none',
              semitones === 0 ? 'text-theme-text' : 'text-theme-highlight'
            )}
          >
            {formatSemitonesShort(semitones)}
          </span>
          <span
            data-testid="pitch-readout-caption"
            aria-live="polite"
            className="text-[11px] leading-none text-theme-text-muted"
          >
            {describeSemitones(semitones)}
          </span>
          <span
            aria-hidden="true"
            className="relative mt-0.5 h-1 w-full rounded-full bg-theme-border-subtle"
          >
            <span className="absolute inset-y-0 left-1/2 w-px bg-theme-text-muted/50" />
            <span
              className="absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-gradient-accent shadow-theme-glow transition-[left] duration-200"
              style={{ left: `${meterPosition}%` }}
            />
          </span>
        </div>

        <Tooltip content="Raise key by 1 semitone (+12 max)" position="top">
          <button
            type="button"
            onClick={() => onSemitoneChange(1)}
            disabled={semitones >= MAX_SEMITONES}
            aria-label="Increase pitch by one semitone"
            className={stepperClass}
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
          </button>
        </Tooltip>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tooltip content="Reset pitch to original key (0 semitones)" position="top">
          <button
            type="button"
            onClick={onResetPitch}
            disabled={semitones === 0}
            aria-label="Reset pitch to original key"
            className={cn(
              'inline-flex min-h-[44px] md:min-h-[32px] items-center gap-1.5 rounded-theme-md px-2.5 text-xs font-semibold text-theme-text-muted transition-colors hover:bg-theme-surface-subtle hover:text-theme-text disabled:cursor-not-allowed disabled:opacity-40',
              focusRing
            )}
          >
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
            Reset
          </button>
        </Tooltip>

        <button
          type="button"
          onClick={onOpenRecommender || onAnalyzeVocalRange}
          disabled={isAnalyzingRange}
          aria-label={
            vocalRange ? 'Open Smart Key Recommender' : 'Analyze vocal range or open recommender'
          }
          className={cn(
            'inline-flex min-h-[44px] md:min-h-[32px] items-center gap-1.5 rounded-theme-md border border-theme-accent/40 bg-theme-accent/10 px-2.5 text-xs font-semibold text-theme-highlight transition-colors hover:bg-theme-accent/20 disabled:opacity-50',
            focusRing
          )}
        >
          {isAnalyzingRange ? (
            <Spinner className="h-3.5 w-3.5" />
          ) : (
            <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          <span>{isAnalyzingRange ? 'Analyzing...' : 'Smart Recommender'}</span>
        </button>
      </div>

      <div className="flex min-w-0 items-center gap-2 rounded-theme-md border border-theme-border-subtle px-2.5 py-2 text-xs">
        <Mic className="h-3.5 w-3.5 shrink-0 text-theme-text-muted" aria-hidden="true" />
        {hasRange && vocalRange ? (
          <span
            className="flex min-w-0 items-center gap-1.5"
            title={`Sung range: ${vocalRange.lowest_note} to ${vocalRange.highest_note}, Estimated Key: ${vocalRange.estimated_key}`}
          >
            <span className="truncate font-mono font-semibold text-theme-text">
              {vocalRange.lowest_note}–{vocalRange.highest_note}
            </span>
            <span className="text-theme-text-muted" aria-hidden="true">
              ·
            </span>
            <span className="truncate text-theme-text-muted">{vocalRange.estimated_key}</span>
          </span>
        ) : vocalRange && !vocalRange.is_voiced ? (
          <span className="italic text-theme-text-muted">No vocals detected</span>
        ) : (
          <span className="text-theme-text-muted">Range unanalyzed</span>
        )}
      </div>
    </div>
  );
};
