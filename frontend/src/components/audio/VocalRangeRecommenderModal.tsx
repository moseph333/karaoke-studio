/**
 * Vocal Range Analyzer & Smart Key Recommender Modal
 *
 * Provides singer preset selection (Bass to Soprano + Custom), visual range bar,
 * live cost-minimizing semitone calculation, and 1-click transposition application to the mix.
 * Complies with WAI-ARIA dialog standards, focus trapping, and touch targets >=44px.
 */

import React, { useState, useMemo } from 'react';
import { X, Sparkles, Mic, Check, AlertCircle, RefreshCw, ArrowRight } from 'lucide-react';
import { useFocusTrap } from '../../hooks/useFocusTrap';
import { VocalRangeData, VoicePreset } from '../../types';
import {
  VOICE_PRESETS,
  COMMON_NOTE_OPTIONS,
  recommendKeyShift,
  noteNameToMidi,
} from '../../utils/vocalRange';

export interface VocalRangeRecommenderModalProps {
  isOpen: boolean;
  onClose: () => void;
  vocalRange?: VocalRangeData | null;
  currentSemitones: number;
  onApplyTransposition: (semitones: number) => void | Promise<void>;
  onAnalyzeVocalRange?: () => void | Promise<void>;
  isAnalyzing?: boolean;
}

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

  const modalRef = useFocusTrap<HTMLDivElement>({
    isOpen,
    onClose,
    escapeDeactivates: true,
  });

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

  if (!isOpen) return null;

  const handleApply = async () => {
    await onApplyTransposition(recommendation.recommended_semitones);
    onClose();
  };

  return (
    <div
      ref={modalRef}
      tabIndex={-1}
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/80 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="vocal-recommender-title"
      aria-describedby="vocal-recommender-desc"
      data-modal="vocal-range-recommender"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative w-full max-w-xl sm:max-w-2xl max-h-[90vh] flex flex-col bg-slate-900 border border-slate-800 rounded-2xl sm:rounded-3xl shadow-2xl overflow-hidden">
        {/* Close Button (>=44px touch target) */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Smart Key Recommender"
          className="absolute top-3 right-3 sm:top-5 sm:right-5 min-w-[44px] min-h-[44px] p-2.5 rounded-full bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 flex items-center justify-center z-10"
        >
          <X className="w-5 h-5" aria-hidden="true" />
        </button>

        {/* Header */}
        <div className="p-4 sm:p-6 pb-3 sm:pb-4 border-b border-slate-800/80 pr-14">
          <div className="flex items-center gap-3">
            <div className="p-2.5 sm:p-3 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 text-cyan-400 shrink-0">
              <Sparkles className="w-6 h-6" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <h2
                id="vocal-recommender-title"
                className="text-lg sm:text-xl font-bold text-white font-['Montserrat'] truncate"
              >
                Smart Key Recommender
              </h2>
              <p id="vocal-recommender-desc" className="text-xs text-slate-400 mt-0.5 truncate">
                Fit this song's vocal peaks into your comfortable singing range
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-5">
          {/* Section 1: Song Vocal Range Overview */}
          <div className="p-4 rounded-xl bg-slate-950/60 border border-slate-800/80 space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-slate-400 font-medium flex items-center gap-1.5">
                <Mic className="w-4 h-4 text-cyan-400" aria-hidden="true" />
                Detected Song Vocal Range
              </span>
              {vocalRange?.is_voiced && (
                <span className="px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-300 border border-cyan-500/20 font-mono text-[10px]">
                  Estimated Key: {vocalRange.estimated_key}
                </span>
              )}
            </div>

            {vocalRange && vocalRange.is_voiced && vocalRange.lowest_note ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 pt-2 text-xs">
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block">Sung Range</span>
                  <span className="font-mono text-cyan-300 font-bold text-sm">
                    {vocalRange.lowest_note} – {vocalRange.highest_note}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {vocalRange.lowest_hz?.toFixed(0)}Hz – {vocalRange.highest_hz?.toFixed(0)}Hz
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block">Tessitura</span>
                  <span className="font-mono text-slate-200 font-bold text-sm">
                    {vocalRange.tessitura_low_note || vocalRange.lowest_note} –{' '}
                    {vocalRange.tessitura_high_note || vocalRange.highest_note}
                  </span>
                  <span className="text-[10px] text-slate-500 block">Core 70% bounds</span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block">Median Pitch</span>
                  <span className="font-mono text-slate-200 font-bold text-sm">
                    {vocalRange.median_note || '-'}
                  </span>
                  <span className="text-[10px] text-slate-500 block">
                    {vocalRange.median_hz ? `~${vocalRange.median_hz.toFixed(0)} Hz` : '-'}
                  </span>
                </div>
                <div className="p-2 rounded-lg bg-slate-900 border border-slate-800">
                  <span className="text-[10px] text-slate-500 uppercase block">Current Shift</span>
                  <span className="font-mono text-slate-200 font-bold text-sm">
                    {currentSemitones === 0
                      ? '0 (Original)'
                      : `${currentSemitones > 0 ? '+' : ''}${currentSemitones} st`}
                  </span>
                  <span className="text-[10px] text-slate-500 block">Studio Mix</span>
                </div>
              </div>
            ) : vocalRange && !vocalRange.is_voiced ? (
              <div className="p-3 rounded-lg bg-amber-500/10 border border-amber-500/20 text-amber-200 text-xs flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 text-amber-400" aria-hidden="true" />
                <span>No singing voice detected on vocal track (silent or unvoiced stem).</span>
              </div>
            ) : (
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-2">
                <span className="text-xs text-slate-400">
                  Vocal range analysis has not been performed for this project yet.
                </span>
                {onAnalyzeVocalRange && (
                  <button
                    type="button"
                    onClick={onAnalyzeVocalRange}
                    disabled={isAnalyzing}
                    aria-label="Analyze vocal track"
                    className="min-h-[44px] px-4 py-2 rounded-xl bg-cyan-500/20 hover:bg-cyan-500/30 text-cyan-300 border border-cyan-500/40 text-xs font-semibold flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
                  >
                    <RefreshCw
                      className={`w-4 h-4 ${isAnalyzing ? 'animate-spin' : ''}`}
                      aria-hidden="true"
                    />
                    <span>{isAnalyzing ? 'Analyzing Stem...' : 'Analyze Vocal Track'}</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Section 2: Singer Voice Presets */}
          <div className="space-y-3">
            <label className="text-xs font-semibold text-slate-300 block">
              Select Your Target Voice Range
            </label>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label="Voice range presets"
            >
              {PRESET_LIST.map((preset) => {
                const isSelected = selectedPreset === preset;
                return (
                  <button
                    key={preset}
                    type="button"
                    role="radio"
                    aria-checked={isSelected}
                    onClick={() => setSelectedPreset(preset)}
                    className={`min-h-[44px] min-w-[44px] px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-semibold transition-all focus:outline-none focus:ring-2 focus:ring-cyan-400 flex items-center justify-center gap-1.5 ${
                      isSelected
                        ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-400 shadow-[0_0_12px_rgba(6,182,212,0.25)]'
                        : 'bg-slate-800/80 text-slate-400 border border-slate-700/60 hover:text-white hover:bg-slate-700/80'
                    }`}
                  >
                    {isSelected && (
                      <Check className="w-3.5 h-3.5 text-cyan-400" aria-hidden="true" />
                    )}
                    <span>{preset}</span>
                  </button>
                );
              })}
            </div>

            {selectedPreset !== 'Custom' ? (
              <p className="text-[11px] text-slate-400 italic">
                {VOICE_PRESETS[selectedPreset].description} (Comfortable span:{' '}
                {VOICE_PRESETS[selectedPreset].lowNote} to {VOICE_PRESETS[selectedPreset].highNote})
              </p>
            ) : (
              /* Custom Range Selectors */
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2 p-3 rounded-xl bg-slate-950/40 border border-slate-800">
                <div>
                  <label
                    htmlFor="custom-low-note"
                    className="text-[11px] text-slate-400 font-medium block mb-1"
                  >
                    Lowest Comfortable Note
                  </label>
                  <select
                    id="custom-low-note"
                    value={customLowNote}
                    onChange={(e) => setCustomLowNote(e.target.value)}
                    className="w-full min-h-[44px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400"
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
                    className="text-[11px] text-slate-400 font-medium block mb-1"
                  >
                    Highest Comfortable Note
                  </label>
                  <select
                    id="custom-high-note"
                    value={customHighNote}
                    onChange={(e) => setCustomHighNote(e.target.value)}
                    className="w-full min-h-[44px] bg-slate-800 border border-slate-700 rounded-lg px-3 py-2 text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-cyan-400"
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
          </div>

          {/* Section 3: Visual Pitch Range Bar */}
          {songBounds && (
            <div className="space-y-2 pt-2">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-300">Pitch Range Comparison</span>
                <span className="text-[10px] font-mono text-slate-500">C2 to C6 Compass</span>
              </div>

              <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 space-y-3">
                {/* Visual Bar Canvas */}
                <div className="relative h-12 w-full bg-slate-900 rounded-lg border border-slate-800 overflow-hidden flex items-center">
                  {/* Target Singer Range Bar */}
                  <div
                    className="absolute h-9 rounded bg-cyan-500/15 border border-cyan-500/30 flex items-center justify-between px-1.5 transition-all"
                    style={{
                      left: `${Math.max(0, Math.min(100, ((targetBounds.low - COMPASS_LOW) / COMPASS_SPAN) * 100))}%`,
                      width: `${Math.max(4, Math.min(100, ((targetBounds.high - targetBounds.low) / COMPASS_SPAN) * 100))}%`,
                    }}
                    title={`Target: ${targetBounds.lowNote}–${targetBounds.highNote}`}
                  >
                    <span className="text-[9px] font-mono text-cyan-300 font-bold truncate">
                      {targetBounds.lowNote}
                    </span>
                    <span className="text-[9px] font-mono text-cyan-300 font-bold truncate">
                      {targetBounds.highNote}
                    </span>
                  </div>

                  {/* Transposed Song Range Indicator */}
                  {projectedBounds && (
                    <div
                      className={`absolute h-4 rounded-full border transition-all ${
                        recommendation.is_in_range
                          ? 'bg-emerald-500/60 border-emerald-300'
                          : 'bg-amber-500/60 border-amber-300'
                      }`}
                      style={{
                        left: `${Math.max(0, Math.min(100, ((projectedBounds.low - COMPASS_LOW) / COMPASS_SPAN) * 100))}%`,
                        width: `${Math.max(3, Math.min(100, ((projectedBounds.high - projectedBounds.low) / COMPASS_SPAN) * 100))}%`,
                      }}
                      title={`Projected: ${recommendation.projected_low_note}–${recommendation.projected_high_note}`}
                    />
                  )}
                </div>

                {/* Legend */}
                <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-slate-400 font-mono">
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded bg-cyan-500/30 border border-cyan-400" />
                    <span>
                      Your Target: {targetBounds.lowNote} – {targetBounds.highNote}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-full bg-emerald-500 border border-emerald-300" />
                    <span>
                      Shifted Song: {recommendation.projected_low_note} –{' '}
                      {recommendation.projected_high_note}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Section 4: Recommendation Results Card */}
          <div className="p-4 rounded-xl bg-gradient-to-br from-cyan-950/40 via-slate-900 to-blue-950/40 border border-cyan-500/30 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <span className="text-xs font-semibold text-cyan-400 uppercase tracking-wider block">
                Recommended Transposition
              </span>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl sm:text-3xl font-black font-mono text-white">
                  {recommendation.recommended_semitones === 0
                    ? '0 (Original Key)'
                    : `${recommendation.recommended_semitones > 0 ? '+' : ''}${recommendation.recommended_semitones} st`}
                </span>
                {recommendation.is_in_range ? (
                  <span className="text-xs text-emerald-400 font-medium flex items-center gap-1">
                    <Check className="w-3.5 h-3.5" aria-hidden="true" />
                    Fits comfortably
                  </span>
                ) : (
                  <span className="text-xs text-amber-400 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" aria-hidden="true" />
                    Best fit (song wider than voice)
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-300">
                Projected Key:{' '}
                <strong className="text-white font-mono">{recommendation.projected_key}</strong>
                {vocalRange?.estimated_key && (
                  <span className="text-slate-400 text-[11px]">
                    {' '}
                    (Original: {vocalRange.estimated_key})
                  </span>
                )}
              </p>
            </div>

            {/* Shift Diff Callout */}
            <div className="p-3 rounded-lg bg-slate-900/80 border border-slate-800 text-xs text-slate-300 min-w-[140px] shrink-0 text-center sm:text-right">
              <span className="text-[10px] text-slate-500 uppercase block">Projected Range</span>
              <span className="font-mono text-cyan-300 font-bold text-sm block">
                {recommendation.projected_low_note} – {recommendation.projected_high_note}
              </span>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-3 sm:p-4 border-t border-slate-800/80 bg-slate-950/40 flex flex-col sm:flex-row items-center justify-end gap-2.5">
          <button
            type="button"
            onClick={onClose}
            className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 flex items-center justify-center"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!vocalRange?.is_voiced}
            aria-label={`Apply transposition of ${recommendation.recommended_semitones} semitones`}
            className="w-full sm:w-auto min-h-[44px] min-w-[44px] px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 text-xs sm:text-sm font-bold shadow-lg transition-transform active:scale-95 disabled:opacity-50 focus:outline-none focus:ring-2 focus:ring-cyan-400 flex items-center justify-center gap-2"
          >
            <span>
              Apply Transposition (
              {recommendation.recommended_semitones === 0
                ? 'Original Key'
                : `${recommendation.recommended_semitones > 0 ? '+' : ''}${recommendation.recommended_semitones} st`}
              )
            </span>
            <ArrowRight className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>
    </div>
  );
};
