/**
 * Live Synchronized Harmonic Chord Bar Component
 *
 * Real-time scrolling track displaying active chord and previewing upcoming chords.
 * Fully synchronized with audio playback sub-frame time interpolation,
 * dynamic semitone transposition [-12, +12], and key-aware enharmonic spelling.
 * Accessible with ARIA region semantics and responsive down to 320px with >=44px touch targets.
 */

import React, { useMemo, useState } from 'react';
import { ChordSegment } from '../types';
import { transposeChord, NO_CHORD_VALUES } from '../utils/chords';
import { Edit2, Check, X } from 'lucide-react';
import { cn } from '../utils/cn';
import { focusRing } from './ui/variants';

export interface ChordBarProps {
  chords?: ChordSegment[];
  currentTime: number;
  semitones?: number;
  visible?: boolean;
  keyHint?: string | null;
  previewWindow?: number;
  onEditChord?: (index: number, newChord: string) => void;
  onSeek?: (time: number) => void;
  className?: string;
}

export const ChordBar: React.FC<ChordBarProps> = ({
  chords = [],
  currentTime,
  semitones = 0,
  visible = true,
  keyHint,
  previewWindow = 4.0,
  onEditChord,
  onSeek,
  className = '',
}) => {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editValue, setEditValue] = useState('');

  // Transposing parses each chord symbol: do it when the chords or the key change, not on
  // every animation frame of the stage
  const transposed = useMemo(
    () => chords.map((c) => transposeChord(c.chord, semitones, keyHint)),
    [chords, semitones, keyHint]
  );

  if (!visible) return null;

  // Active segment: current playback time falls within [start, end)
  const activeIndex =
    currentTime < 0 || chords.length === 0
      ? -1
      : chords.findIndex((c) => currentTime >= c.start && currentTime < c.end);

  const activeSegment = activeIndex >= 0 ? chords[activeIndex] : null;

  // Upcoming segments within the lookahead window (as indices into `chords`)
  const upcomingIndices =
    chords.length === 0 || currentTime < 0
      ? []
      : chords.flatMap((c, i) =>
          c.start > currentTime && c.start <= currentTime + previewWindow ? [i] : []
        );

  let activeChordDisplay = '—';
  if (activeSegment) {
    if (
      activeSegment.chord === 'N' ||
      NO_CHORD_VALUES.has(activeSegment.chord.trim().toUpperCase())
    ) {
      activeChordDisplay = 'N';
    } else {
      activeChordDisplay = transposed[activeIndex];
    }
  }

  const handleStartEdit = (idx: number, currentChord: string) => {
    if (!onEditChord) return;
    setEditingIndex(idx);
    setEditValue(currentChord);
  };

  const handleSaveEdit = () => {
    if (editingIndex !== null && editValue.trim() && onEditChord) {
      onEditChord(editingIndex, editValue.trim());
    }
    setEditingIndex(null);
    setEditValue('');
  };

  const handleCancelEdit = () => {
    setEditingIndex(null);
    setEditValue('');
  };

  return (
    <div
      data-testid="chord-bar"
      role="region"
      aria-label="Harmonic Chord Progression"
      className={cn(
        'chord-bar-container flex min-h-[44px] w-full max-w-full select-none items-center gap-2 overflow-hidden rounded-theme-lg border border-white/15 bg-black/45 p-1.5 text-white shadow-theme-sm backdrop-blur-md',
        className
      )}
    >
      {/* Active Chord Cue Badge */}
      {editingIndex !== null && editingIndex === activeIndex ? (
        <div className="flex items-center gap-1 min-h-[44px] shrink-0">
          <input
            type="text"
            data-testid="chord-edit-input"
            aria-label="Edit active chord symbol"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSaveEdit();
              if (e.key === 'Escape') handleCancelEdit();
            }}
            className="min-h-[44px] w-16 rounded-theme-md border border-white/30 bg-black/60 px-2 py-1 text-center font-bold text-white focus:border-theme-accent focus:outline-none focus:ring-2 focus:ring-theme-focus/60"
            autoFocus
          />
          <button
            type="button"
            data-testid="save-chord-edit-btn"
            aria-label="Confirm chord edit"
            onClick={handleSaveEdit}
            className={cn(
              'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-theme-md bg-theme-accent p-2 text-theme-accent-text transition-colors hover:bg-theme-accent-hover',
              focusRing
            )}
          >
            <Check className="h-4 w-4" aria-hidden="true" />
          </button>
          <button
            type="button"
            data-testid="cancel-chord-edit-btn"
            aria-label="Cancel chord edit"
            onClick={handleCancelEdit}
            className={cn(
              'flex min-h-[44px] min-w-[44px] items-center justify-center rounded-theme-md bg-white/10 p-2 text-white/80 transition-colors hover:bg-white/20 hover:text-white',
              focusRing
            )}
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : (
        <div className="relative flex items-center shrink-0">
          <div
            data-testid="active-chord-badge"
            aria-label={`Active chord: ${activeChordDisplay}`}
            className="active-chord flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-theme-md bg-gradient-accent px-3 py-1.5 text-lg font-bold text-theme-accent-text shadow-theme-glow"
          >
            {activeChordDisplay}
          </div>
          {onEditChord && activeSegment && (
            <button
              type="button"
              data-testid="edit-active-chord-btn"
              aria-label={`Edit chord ${activeChordDisplay}`}
              onClick={() => handleStartEdit(activeIndex, activeSegment.chord)}
              className={cn(
                'ml-1 flex min-h-[44px] min-w-[44px] items-center justify-center rounded-theme-md p-2 text-white/60 transition-colors hover:bg-white/10 hover:text-white',
                focusRing
              )}
            >
              <Edit2 className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          )}
        </div>
      )}

      {/* Upcoming Chords Strip */}
      <div
        data-testid="upcoming-chords"
        className="upcoming flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden text-sm text-white/70"
      >
        {upcomingIndices.map((i, idx) => (
          <span
            key={chords[i].id || idx}
            data-testid="upcoming-chord-cue"
            onClick={() => onSeek?.(chords[i].start)}
            className="shrink-0 cursor-pointer rounded-theme-md border border-white/15 bg-white/5 px-2 py-1 text-xs font-semibold text-white/85 transition-colors hover:bg-white/15 sm:text-sm"
          >
            {transposed[i]}
          </span>
        ))}
      </div>
    </div>
  );
};
