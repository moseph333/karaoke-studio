/**
 * Vocal Parts Control (Mix panel)
 *
 * Which vocals stay in the backing track beyond the guide vocal: the backing vocals, once
 * the vocals are split into lead and backing (with the split's own button and progress, see
 * VocalSplitControl), and the lead divided by singer: for a song whose lines hold more than
 * one singer, a level for the lead during each singer's lines; or a level for its male and
 * its female voice, once those are split. Levels update live while dragging and are
 * committed (re-mixed) on release.
 */

import React from 'react';
import { Mic2 } from 'lucide-react';
import type { PartNames, SingerRole, VocalLevels } from '../../types';
import { divideBySinger, divideByVoice, undivide } from '../../utils/vocalLevels';
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
  /** The male/female split of the lead; the "Male / female" choice is offered when set. */
  voiceSplit?: VocalSplitControlProps;
}

type LevelKey = 'backing' | 'male' | 'female' | SingerRole;

const PART_DEFAULT_NAMES: Record<SingerRole, string> = {
  singer1: 'Singer 1',
  singer2: 'Singer 2',
  both: 'Sung together',
};

type SingerMode = 'whole' | 'lines' | 'voices';
const MODE_LABELS: Record<SingerMode, string> = {
  whole: 'One level',
  lines: 'By singer',
  voices: 'Male / female',
};

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
  voiceSplit,
}) => {
  const hasSingers = singerParts.length > 1;
  const modes: SingerMode[] = [
    'whole',
    ...(hasSingers ? (['lines'] as const) : []),
    ...(voiceSplit ? (['voices'] as const) : []),
  ];
  const mode: SingerMode =
    levels.by === 'voices' && voiceSplit
      ? 'voices'
      : levels.by === 'lines' && hasSingers
        ? 'lines'
        : 'whole';
  const levelOf = (key: LevelKey) => levels[key] ?? guideVolume;
  const withLevel = (key: LevelKey, value: number): VocalLevels => ({ ...levels, [key]: value });
  const level = (key: LevelKey, name: string) => (
    <PartLevel
      key={key}
      name={name}
      testId={`vocal-level-${key}`}
      value={levelOf(key)}
      onChange={(value) => onLevelsChange(withLevel(key, value))}
      onCommit={(value) => onLevelsCommit(withLevel(key, value))}
    />
  );

  const chooseMode = (next: SingerMode) => {
    if (next === mode) return;
    if (next === 'lines') onLevelsCommit(divideBySinger(levels, singerParts, guideVolume));
    else if (next === 'voices') onLevelsCommit(divideByVoice(levels, guideVolume));
    else onLevelsCommit(undivide(levels));
  };

  return (
    <div className="flex flex-col gap-5" data-testid="vocal-parts">
      {split && (
        <VocalSplitControl {...split} kind="lead_backing">
          {level('backing', 'Backing vocals')}
        </VocalSplitControl>
      )}

      {modes.length > 1 && (
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
              options={modes.map((value) => ({ value, label: MODE_LABELS[value] }))}
              semantics="radio"
              ariaLabel="Lead vocal level"
              size="sm"
              testId="vocal-singers-mode"
            />
          </div>
          {mode === 'lines' && (
            <>
              {singerParts.map((part) =>
                level(part, partNames?.[part]?.trim() || PART_DEFAULT_NAMES[part])
              )}
              <p className="text-[11px] text-theme-text-muted">
                Each level applies during that singer&apos;s lyric lines, in place of the guide
                vocal.
              </p>
            </>
          )}
          {mode === 'voices' && voiceSplit && (
            <VocalSplitControl {...voiceSplit} kind="male_female" nested>
              {level('male', 'Male voice')}
              {level('female', 'Female voice')}
              <p className="text-[11px] text-theme-text-muted">
                Each voice has its own level, in place of the guide vocal.
              </p>
            </VocalSplitControl>
          )}
          {mode === 'whole' && (
            <p className="text-[11px] text-theme-text-muted">
              Divide the lead to keep one singer&apos;s voice in and sing the other part.
            </p>
          )}
        </section>
      )}
    </div>
  );
};
