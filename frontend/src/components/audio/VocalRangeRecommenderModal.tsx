/**
 * Vocal Range Analyzer & Smart Key Recommender Modal
 *
 * Picks a target voice (Bass to Soprano, or a custom range), compares it with the song's
 * sung range on a C2–C6 compass, and applies the transposition that fits it best.
 */

import React, { useState, useMemo } from 'react';
import { Mic, Check, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { VocalRangeData, VoicePreset } from '../../types';
import { Dialog, DialogFooter, DialogHeader } from '../ui/Dialog';
import { Button } from '../ui/Button';
import { SegmentedControl } from '../ui/SegmentedControl';
import { cn } from '../../utils/cn';
import {
  VOICE_PRESETS,
  COMMON_NOTE_OPTIONS,
  recommendKeyShift,
  noteNameToMidi,
} from '../../utils/vocalRange';
import { formatSemitones } from '../../utils/format';

export interface VocalRangeRecommenderModalProps {
  isOpen: boolean;
  onClose: () => void;
  vocalRange?: VocalRangeData | null;
  currentSemitones: number;
  onApplyTransposition: (semitones: number) => void | Promise<void>;
  onAnalyzeVocalRange?: () => void | Promise<void>;
  isAnalyzing?: boolean;
}

// "−3 st" with a real minus sign, which screen readers say as "minus"
const formatShift = (semitones: number, zero: string) => formatSemitones(semitones, zero);

const statLabel = 'block text-sm text-theme-text-muted';
const statValue = 'ks-display text-[28px] tabular-nums text-theme-text';
const selectCls =
  'w-full min-h-[44px] border border-theme-border bg-transparent px-3 py-2 tabular-nums text-base text-theme-text focus:border-theme-accent focus:outline-none focus:ring-1 focus:ring-theme-focus sm:text-xs';

const PRESET_LIST: Array<VoicePreset | 'Custom'> = [
  'Bass',
  'Baritone',
  'Tenor',
  'Alto',
  'Mezzo-Soprano',
  'Soprano',
  'Custom',
];

export const VocalRangeRecommenderModal: React.FC<VocalRangeRecommenderModalProps> = ({
  isOpen,
  onClose,
  vocalRange,
  currentSemitones,
  onApplyTransposition,
  onAnalyzeVocalRange,
  isAnalyzing = false,
}) => {
  const [selectedPreset, setSelectedPreset] = useState<VoicePreset | 'Custom'>('Baritone');
  const [customLowNote, setCustomLowNote] = useState<string>('A2');
  const [customHighNote, setCustomHighNote] = useState<string>('A4');

  const recommendation = useMemo(() => {
    return recommendKeyShift({
      vocalRange,
      targetPreset: selectedPreset === 'Custom' ? null : selectedPreset,
      customLowNote: selectedPreset === 'Custom' ? customLowNote : null,
      customHighNote: selectedPreset === 'Custom' ? customHighNote : null,
    });
  }, [vocalRange, selectedPreset, customLowNote, customHighNote]);

  // Compute boundaries for visual range display (Compass: C2 [36] to C6 [84])
  const COMPASS_LOW = 36;
  const COMPASS_HIGH = 84;
  const COMPASS_SPAN = COMPASS_HIGH - COMPASS_LOW;

  const targetBounds = useMemo(() => {
    if (selectedPreset === 'Custom') {
      const low = noteNameToMidi(customLowNote) ?? 45;
      const high = noteNameToMidi(customHighNote) ?? 69;
      return { low, high, lowNote: customLowNote, highNote: customHighNote };
    }
    const preset = VOICE_PRESETS[selectedPreset];
    return {
      low: preset.lowMidi,
      high: preset.highMidi,
      lowNote: preset.lowNote,
      highNote: preset.highNote,
    };
  }, [selectedPreset, customLowNote, customHighNote]);

  const songBounds = useMemo(() => {
    if (!vocalRange?.lowest_note || !vocalRange?.highest_note) return null;
    const low = noteNameToMidi(vocalRange.lowest_note);
    const high = noteNameToMidi(vocalRange.highest_note);
    if (low === null || high === null) return null;
    return { low, high };
  }, [vocalRange]);

  const projectedBounds = useMemo(() => {
    if (!songBounds) return null;
    return {
      low: songBounds.low + recommendation.recommended_semitones,
      high: songBounds.high + recommendation.recommended_semitones,
    };
  }, [songBounds, recommendation.recommended_semitones]);

  const handleApply = async () => {
    await onApplyTransposition(recommendation.recommended_semitones);
    onClose();
  };

  const pct = (midi: number) => ((midi - COMPASS_LOW) / COMPASS_SPAN) * 100;
  const clampPct = (v: number, min = 0) => Math.max(min, Math.min(100, v));
  const recommendedLabel = formatShift(recommendation.recommended_semitones, '0 (Original Key)');

  return (
    <Dialog
      open={isOpen}
      onClose={onClose}
      titleId="vocal-recommender-title"
      descriptionId="vocal-recommender-desc"
      variant="center"
      size="2xl"
      dataModal="vocal-range-recommender"
    >
      <DialogHeader
        title="Suggest a key for my voice"
        titleId="vocal-recommender-title"
        description="Moves the song into the range you sing comfortably"
        descriptionId="vocal-recommender-desc"
        onClose={onClose}
        closeLabel="Close key suggestion"
      />

      <div className="space-y-5">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2 text-xs">
            <span className="flex items-center gap-1.5 font-medium text-theme-text-muted">
              <Mic className="h-4 w-4 text-theme-text" aria-hidden="true" />
              The song's vocal range
            </span>
            {vocalRange?.is_voiced && (
              <span className="tabular-nums text-sm text-theme-text">
                Estimated Key: {vocalRange.estimated_key}
              </span>
            )}
          </div>

          {vocalRange && vocalRange.is_voiced && vocalRange.lowest_note ? (
            <div className="grid grid-cols-2 gap-2 pt-2 text-xs sm:grid-cols-4">
              <div>
                <span className={statLabel}>Sung range</span>
                <span className={cn(statValue, 'text-theme-text')}>
                  {vocalRange.lowest_note} – {vocalRange.highest_note}
                </span>
                <span className="block text-xs text-theme-text-muted">
                  {vocalRange.lowest_hz?.toFixed(0)}Hz – {vocalRange.highest_hz?.toFixed(0)}Hz
                </span>
              </div>
              <div>
                <span className={statLabel}>Most notes</span>
                <span className={statValue}>
                  {vocalRange.tessitura_low_note || vocalRange.lowest_note} –{' '}
                  {vocalRange.tessitura_high_note || vocalRange.highest_note}
                </span>
                <span className="block text-xs text-theme-text-muted">The middle 70%</span>
              </div>
              <div>
                <span className={statLabel}>Middle pitch</span>
                <span className={statValue}>{vocalRange.median_note || '-'}</span>
                <span className="block text-xs text-theme-text-muted">
                  {vocalRange.median_hz ? `~${vocalRange.median_hz.toFixed(0)} Hz` : '-'}
                </span>
              </div>
              <div>
                <span className={statLabel}>Key now</span>
                <span className={statValue}>{formatShift(currentSemitones, '0 (Original)')}</span>
                <span className="block text-xs text-theme-text-muted">In the mix</span>
              </div>
            </div>
          ) : vocalRange && !vocalRange.is_voiced ? (
            <div className="flex items-center gap-2 border border-theme-warning p-3 text-xs text-theme-warning">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>No singing was found in the vocals.</span>
            </div>
          ) : (
            <div className="flex flex-col justify-between gap-3 pt-2 sm:flex-row sm:items-center">
              <span className="text-xs text-theme-text-muted">
                This song's vocal range has not been measured yet.
              </span>
              {onAnalyzeVocalRange && (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onAnalyzeVocalRange}
                  disabled={isAnalyzing}
                  className="min-h-[44px]"
                  leftIcon={
                    <RefreshCw
                      className={cn('h-4 w-4', isAnalyzing && 'animate-spin')}
                      aria-hidden="true"
                    />
                  }
                >
                  {isAnalyzing ? 'Measuring…' : 'Measure the vocal range'}
                </Button>
              )}
            </div>
          )}
        </section>

        <section className="space-y-3">
          <span className="block text-xs font-semibold text-theme-text">Your voice</span>
          <SegmentedControl<VoicePreset | 'Custom'>
            semantics="radio"
            ariaLabel="Voice range presets"
            value={selectedPreset}
            onChange={setSelectedPreset}
            tone="accent"
            size="sm"
            className="w-full"
            options={PRESET_LIST.map((preset) => ({ value: preset, label: preset }))}
          />

          {selectedPreset !== 'Custom' ? (
            <p className="text-xs italic text-theme-text-muted">
              {VOICE_PRESETS[selectedPreset].description} (Comfortable span:{' '}
              {VOICE_PRESETS[selectedPreset].lowNote} to {VOICE_PRESETS[selectedPreset].highNote})
            </p>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <label
                  htmlFor="custom-low-note"
                  className="mb-1 block text-xs font-medium text-theme-text-muted"
                >
                  Lowest comfortable note
                </label>
                <select
                  id="custom-low-note"
                  value={customLowNote}
                  onChange={(e) => setCustomLowNote(e.target.value)}
                  className={selectCls}
                >
                  {COMMON_NOTE_OPTIONS.map((opt) => (
                    <option key={`low-${opt.note}`} value={opt.note}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label
                  htmlFor="custom-high-note"
                  className="mb-1 block text-xs font-medium text-theme-text-muted"
                >
                  Highest comfortable note
                </label>
                <select
                  id="custom-high-note"
                  value={customHighNote}
                  onChange={(e) => setCustomHighNote(e.target.value)}
                  className={selectCls}
                >
                  {COMMON_NOTE_OPTIONS.map((opt) => (
                    <option key={`high-${opt.note}`} value={opt.note}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}
        </section>

        {songBounds && (
          <section className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-semibold text-theme-text">Your range and the song's</span>
              <span className="tabular-nums text-xs text-theme-text-muted">C2 to C6</span>
            </div>
            <div className="space-y-3">
              <div className="relative flex h-12 w-full items-center overflow-hidden bg-theme-surface-raised">
                <div
                  className="absolute flex h-9 items-center justify-between border border-theme-accent px-1.5 transition-all"
                  style={{
                    left: `${clampPct(pct(targetBounds.low))}%`,
                    width: `${clampPct(((targetBounds.high - targetBounds.low) / COMPASS_SPAN) * 100, 4)}%`,
                  }}
                  title={`Target: ${targetBounds.lowNote}–${targetBounds.highNote}`}
                >
                  <span className="truncate tabular-nums text-[9px] font-bold text-theme-text">
                    {targetBounds.lowNote}
                  </span>
                  <span className="truncate tabular-nums text-[9px] font-bold text-theme-text">
                    {targetBounds.highNote}
                  </span>
                </div>
                {projectedBounds && (
                  <div
                    className={cn(
                      'absolute h-4 border transition-all',
                      recommendation.is_in_range ? 'border-theme-success' : 'border-theme-warning'
                    )}
                    style={{
                      left: `${clampPct(pct(projectedBounds.low))}%`,
                      width: `${clampPct(((projectedBounds.high - projectedBounds.low) / COMPASS_SPAN) * 100, 3)}%`,
                    }}
                    title={`Projected: ${recommendation.projected_low_note}–${recommendation.projected_high_note}`}
                  />
                )}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 tabular-nums text-xs text-theme-text-muted">
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 border border-theme-accent" />
                  <span>
                    Your Target: {targetBounds.lowNote} – {targetBounds.highNote}
                  </span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 border border-theme-success bg-theme-success" />
                  <span>
                    Shifted Song: {recommendation.projected_low_note} –{' '}
                    {recommendation.projected_high_note}
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        <section className="flex flex-col justify-between gap-4 border border-theme-accent p-4 sm:flex-row sm:items-center">
          <div className="space-y-1">
            <span className="block text-xs font-semibold text-theme-text">Suggested key</span>
            <div className="flex flex-wrap items-baseline gap-2">
              <span className="tabular-nums text-2xl font-black text-theme-text sm:text-3xl">
                {recommendedLabel}
              </span>
              {recommendation.is_in_range ? (
                <span className="flex items-center gap-1 text-xs font-medium text-theme-success">
                  <Check className="h-3.5 w-3.5" aria-hidden="true" />
                  Fits comfortably
                </span>
              ) : (
                <span className="flex items-center gap-1 text-xs font-medium text-theme-warning">
                  <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  Closest fit: the song spans more than your range
                </span>
              )}
            </div>
            <p className="text-xs text-theme-text-muted">
              Projected Key:{' '}
              <strong className="tabular-nums text-theme-text">
                {recommendation.projected_key}
              </strong>
              {vocalRange?.estimated_key && (
                <span className="text-xs"> (Original: {vocalRange.estimated_key})</span>
              )}
            </p>
          </div>
          <div className="min-w-[140px] shrink-0 sm:text-right">
            <span className="block text-sm text-theme-text-muted">Projected range</span>
            <span className="ks-display block text-[28px] tabular-nums text-theme-text">
              {recommendation.projected_low_note} – {recommendation.projected_high_note}
            </span>
          </div>
        </section>
      </div>

      <DialogFooter>
        <Button variant="secondary" fullWidth="mobile" onClick={onClose}>
          Cancel
        </Button>
        <Button
          variant="primary"
          fullWidth="mobile"
          onClick={handleApply}
          disabled={!vocalRange?.is_voiced}
          aria-label={`Apply transposition of ${recommendation.recommended_semitones} semitones`}
          rightIcon={<ArrowRight className="h-4 w-4" aria-hidden="true" />}
        >
          Apply Transposition ({formatShift(recommendation.recommended_semitones, 'Original Key')})
        </Button>
      </DialogFooter>
    </Dialog>
  );
};
