/**
 * Vocal Parts Control (Mix panel)
 *
 * Which vocals stay in the backing track beyond the guide vocal: the backing vocals, once
 * the vocals are split into lead and backing (with the split's own button and progress, see
 * VocalSplitControl), and, for a song whose lines hold more than one singer, a level for the
 * lead during each singer's lines. Levels update live while dragging and are committed
 * (re-mixed) on release.
 */

import React from 'react';
import { Mic2 } from 'lucide-react';
import type { PartNames, SingerRole, VocalLevels } from '../../types';
import { divideBySinger, undivide } from '../../utils/vocalLevels';
import { SegmentedControl } from '../ui/SegmentedControl';
import { Slider } from '../ui/Slider';
import { VocalSplitControl, type VocalSplitControlProps } from './VocalSplitControl';

export interface VocalPartsControlProps {
  /** Requested levels (not necessarily applied yet). */
  levels: VocalLevels;
  /** What a level that is not set follows. */
  guideVolume: number;
  /** Fires while a slider drags. */
  onLevelsChange: (levels: VocalLevels) => void;
  /** Fires when a slider is released or a mode is chosen: mix now. */
  onLevelsCommit: (levels: VocalLevels) => void;
  /** The singer parts the song's lines hold; levels by singer need more than one. */
  singerParts: readonly SingerRole[];
  partNames?: PartNames | null;
  /** The lead/backing split: its state, button and progress. */
  split?: VocalSplitControlProps;
}

const PART_DEFAULT_NAMES: Record<SingerRole, string> = {
  singer1: 'Singer 1',
  singer2: 'Singer 2',
  both: 'Sung together',
};

const SINGER_MODES = [
  { value: 'whole', label: 'One level' },
  { value: 'lines', label: 'By singer' },
] as const;
type SingerMode = (typeof SINGER_MODES)[number]['value'];

interface PartLevelProps {
  name: string;
  value: number;
  testId: string;
  onChange: (value: number) => void;
  onCommit: (value: number) => void;
}

const PartLevel: React.FC<PartLevelProps> = ({ name, value, testId, onChange, onCommit }) => (
  <div className="flex flex-col gap-1.5" data-testid={testId}>
    <div className="flex items-center justify-between gap-2">
      <span className="min-w-0 truncate text-xs font-medium text-theme-text">{name}</span>
      <span className="shrink-0 font-mono text-xs font-semibold tabular-nums text-theme-text">
        {Math.round(value * 100)}%
      </span>
    </div>
    <Slider
      label={`${name} level`}
      value={value}
      min={0}
      max={1}
      step={0.05}
      onChange={onChange}
      onChangeEnd={onCommit}
      valueText={(v) => (v <= 0 ? `${name} removed` : `${name} at ${Math.round(v * 100)}%`)}
      tone="sung"
    />
  </div>
);

export const VocalPartsControl: React.FC<VocalPartsControlProps> = ({
  levels,
  guideVolume,
  onLevelsChange,
  onLevelsCommit,
  singerParts,
  partNames,
  split,
}) => {
  const hasSingers = singerParts.length > 1;
  const mode: SingerMode = hasSingers && levels.by === 'lines' ? 'lines' : 'whole';
  const levelOf = (key: 'backing' | SingerRole) => levels[key] ?? guideVolume;
  const withLevel = (key: 'backing' | SingerRole, value: number): VocalLevels => ({
    ...levels,
    [key]: value,
  });

  const chooseMode = (next: SingerMode) => {
    if (next === mode) return;
    onLevelsCommit(
      next === 'lines' ? divideBySinger(levels, singerParts, guideVolume) : undivide(levels)
    );
  };

  return (
    <div className="flex flex-col gap-5" data-testid="vocal-parts">
      {split && (
        <VocalSplitControl {...split}>
          <PartLevel
            name="Backing vocals"
            testId="vocal-level-backing"
            value={levelOf('backing')}
            onChange={(value) => onLevelsChange(withLevel('backing', value))}
            onCommit={(value) => onLevelsCommit(withLevel('backing', value))}
          />
        </VocalSplitControl>
      )}

      {hasSingers && (
        <section
          aria-labelledby="vocal-singers-heading"
          className="space-y-2.5"
          data-testid="vocal-singers"
        >
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <h3
              id="vocal-singers-heading"
              className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-theme-text-muted"
            >
              <Mic2 className="h-3.5 w-3.5" aria-hidden="true" />
              Lead by singer
            </h3>
            <SegmentedControl
              value={mode}
              onChange={chooseMode}
              options={SINGER_MODES}
              semantics="radio"
              ariaLabel="Lead vocal level"
              size="sm"
              testId="vocal-singers-mode"
            />
          </div>
          {mode === 'lines' ? (
            <>
              {singerParts.map((part) => (
                <PartLevel
                  key={part}
                  name={partNames?.[part]?.trim() || PART_DEFAULT_NAMES[part]}
                  testId={`vocal-level-${part}`}
                  value={levelOf(part)}
                  onChange={(value) => onLevelsChange(withLevel(part, value))}
                  onCommit={(value) => onLevelsCommit(withLevel(part, value))}
                />
              ))}
              <p className="text-[11px] text-theme-text-muted">
                Each level applies during that singer&apos;s lyric lines, in place of the guide
                vocal.
              </p>
            </>
          ) : (
            <p className="text-[11px] text-theme-text-muted">
              Choose By singer to keep one singer&apos;s voice in and sing the other part.
            </p>
          )}
        </section>
      )}
    </div>
  );
};
