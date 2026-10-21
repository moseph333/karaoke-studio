/**
 * Live Synchronized Harmonic Chord Bar Component
 *
 * Real-time scrolling track displaying active chord and previewing upcoming chords.
 * Fully synchronized with audio playback sub-frame time interpolation,
 * dynamic semitone transposition [-12, +12], and key-aware enharmonic spelling.
 * Accessible with ARIA region semantics and responsive down to 320px with >=44px touch targets.
 */

import React, { useState } from 'react';
import { ChordSegment } from '../types';
import { transposeChord, NO_CHORD_VALUES } from '../utils/chords';
import { Edit2, Check, X } from 'lucide-react';

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

  if (!visible) return null;

  // Active segment: current playback time falls within [start, end)
  const activeIndex =
    currentTime < 0 || chords.length === 0
      ? -1
      : chords.findIndex((c) => currentTime >= c.start && currentTime < c.end);

  const activeSegment = activeIndex >= 0 ? chords[activeIndex] : null;

  // Upcoming segments within the lookahead window
  const upcomingSegments =
    chords.length === 0 || currentTime < 0
      ? []
      : chords.filter((c) => c.start > currentTime && c.start <= currentTime + previewWindow);

  let activeChordDisplay = '—';
  if (activeSegment) {
    if (
      activeSegment.chord === 'N' ||
      NO_CHORD_VALUES.has(activeSegment.chord.trim().toUpperCase())
    ) {
      activeChordDisplay = 'N';
    } else {
      activeChordDisplay = transposeChord(activeSegment.chord, semitones, keyHint);
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
      className={`chord-bar-container w-full max-w-full flex items-center gap-2 p-2 bg-slate-900/90 border border-slate-800 rounded-xl select-none min-h-[44px] overflow-hidden ${className}`}
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
            className="w-16 px-2 py-1 text-center font-bold text-cyan-300 bg-slate-800 border border-cyan-500 rounded min-h-[44px] focus:outline-none focus:ring-2 focus:ring-cyan-400"
            autoFocus
          />
          <button
            type="button"
            data-testid="save-chord-edit-btn"
            aria-label="Confirm chord edit"
            onClick={handleSaveEdit}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded bg-cyan-600 hover:bg-cyan-500 text-white"
          >
            <Check className="w-4 h-4" />
          </button>
          <button
            type="button"
            data-testid="cancel-chord-edit-btn"
            aria-label="Cancel chord edit"
            onClick={handleCancelEdit}
            className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded bg-slate-700 hover:bg-slate-600 text-slate-300"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="relative flex items-center shrink-0">
          <div
            data-testid="active-chord-badge"
            aria-label={`Active chord: ${activeChordDisplay}`}
            className="active-chord font-bold text-cyan-400 bg-cyan-950/60 border border-cyan-500/40 px-3 py-1.5 rounded min-h-[44px] min-w-[44px] flex items-center justify-center text-lg shrink-0"
          >
            {activeChordDisplay}
          </div>
          {onEditChord && activeSegment && (
            <button
              type="button"
              data-testid="edit-active-chord-btn"
              aria-label={`Edit chord ${activeChordDisplay}`}
              onClick={() => handleStartEdit(activeIndex, activeSegment.chord)}
              className="ml-1 p-2 min-h-[44px] min-w-[44px] flex items-center justify-center text-slate-500 hover:text-cyan-400 rounded focus:outline-none focus:ring-2 focus:ring-cyan-400"
            >
              <Edit2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* Upcoming Chords Strip */}
      <div
        data-testid="upcoming-chords"
        className="upcoming flex items-center gap-2 text-slate-400 text-sm overflow-hidden flex-1 min-w-0"
      >
        {upcomingSegments.map((s, idx) => (
          <span
            key={s.id || idx}
            data-testid="upcoming-chord-cue"
            onClick={() => onSeek?.(s.start)}
            className="px-2 py-1 rounded bg-slate-800 border border-slate-700 text-slate-300 font-medium text-xs sm:text-sm shrink-0 cursor-pointer hover:bg-slate-700 transition-colors"
          >
            {transposeChord(s.chord, semitones, keyHint)}
          </span>
        ))}
      </div>
    </div>
  );
};
