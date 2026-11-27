/**
 * Practice panel: what a singer rehearses the open song with. It takes the timeline's place
 * while practice is on (the stage stays above it, the mix beside it).
 *
 * Repeat: the part being sung goes round until it is turned off, a part can be picked from
 * the list, or a stretch chosen line by line.
 *
 * Original singer: a switch that brings the singer in and out at once (a second player beside
 * the master, not a new mix), with its own level.
 */

import React, { useId, useMemo } from 'react';
import type { LyricLine } from '../../types';
import type { UsePracticeReturn } from '../../hooks/usePractice';
import type { UseMixControllerReturn } from '../../hooks/useMixController';
import { usePlaybackValue } from '../../hooks/usePlaybackClock';
import { LEAD_IN_SEC } from '../../utils/practiceLoop';
import { firstWords, partAt } from '../../utils/practiceSections';
import { cn } from '../../utils/cn';
import { hasVocalLevels } from '../../utils/vocalLevels';
import { formatTime } from '../../utils/format';
import { Button } from '../ui/Button';
import { Slider } from '../ui/Slider';
import { Switch } from '../ui/Switch';
import { focusRing } from '../ui/variants';

export interface PracticePanelProps {
  practice: UsePracticeReturn;
  lines: LyricLine[];
  /** The song's mix: a guide vocal mixed into the master is in the way of the singer's switch. */
  mix?: Pick<
    UseMixControllerReturn,
    'appliedGuideVolume' | 'setGuideVolume' | 'commitGuideVolume' | 'vocalLevels'
  >;
  className?: string;
}

// One row where the panel is wide: a short screen leaves it little height
const rowCls =
  'grid gap-x-6 gap-y-2 border-b border-theme-border-subtle @[720px]:grid-cols-[minmax(0,1.2fr)_minmax(0,2fr)]';
const noteCls = 'text-xs text-theme-text-muted';
const linkButtonCls =
  'inline-flex min-h-[44px] items-center text-sm font-semibold text-theme-text underline underline-offset-4 hover:text-theme-accent md:min-h-[28px]';

const selectCls =
  'w-full min-h-[44px] border border-theme-border bg-transparent px-3 py-2 text-base text-theme-text focus:border-theme-accent focus:outline-none focus:ring-1 focus:ring-theme-focus md:min-h-[36px] md:text-sm';
const fieldLabelCls = 'mb-1 block text-xs font-medium text-theme-text-muted';

export const PracticePanel: React.FC<PracticePanelProps> = ({
  practice,
  lines,
  mix,
  className,
}) => {
  const { loop, singer } = practice;
  const { parts, range, mode } = loop;
  const repeating = mode !== 'off';
  const ids = useId().replace(/:/g, '');
  const sungPart = usePlaybackValue((time) => partAt(parts, time)?.number ?? 0);
  const lineOptions = useMemo(
    () =>
      lines.map((line, index) => ({
        index,
        label: `${index + 1}. ${firstWords(line.text, 'No words')}`,
      })),
    [lines]
  );
  const repeatingPart =
    mode === 'part' ? (parts.find((part) => part.firstLine === range?.firstLine)?.number ?? 0) : 0;
  const stretchText = range
    ? range.firstLine === range.lastLine
      ? `Line ${range.firstLine + 1} repeats`
      : `Lines ${range.firstLine + 1} to ${range.lastLine + 1} repeat`
    : '';

  const guideInMix = Math.round((mix?.appliedGuideVolume ?? 0) * 100);
  const singerNote = !singer.available
    ? 'This song has no separate vocal track.'
    : singer.status === 'failed'
      ? 'The singer’s track could not be loaded.'
      : singer.on && singer.status === 'loading'
        ? 'Getting the singer’s track.'
        : singer.on
          ? 'The singer is in. Switch off to sing it alone.'
          : 'Hear the singer over the music, on and off at once.';

  const pickLine = (end: 'from' | 'to', value: string) => {
    const index = Number(value);
    if (value === '' || !Number.isInteger(index)) return;
    // A start after the end (or an end before the start) makes a stretch of that one line
    if (!range) loop.setStretch(index, index);
    else if (end === 'from') loop.setStretch(index, Math.max(index, range.lastLine));
    else loop.setStretch(Math.min(index, range.firstLine), index);
  };

  return (
    <section
      id="workspace-panel-practice"
      aria-labelledby={`practice-heading-${ids}`}
      data-testid="practice-panel"
      className={cn('@container border-t-2 border-theme-border pt-2.5', className)}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-theme-border-subtle pb-2">
        <h2
          id={`practice-heading-${ids}`}
          className="ks-display text-[28px] font-black text-theme-text sm:text-[36px]"
        >
          Practice
        </h2>
        <Button variant="ghost" size="sm" onClick={practice.leave}>
          Back to the timeline
        </Button>
      </div>

      {parts.length === 0 ? (
        <p className="border-b border-theme-border-subtle py-4 text-sm text-theme-text-muted">
          This song has no lyric lines yet. Add its lyrics on the timeline, then repeat its parts
          here.
        </p>
      ) : (
        <div data-guide="practice-repeat" className={cn(rowCls, 'pb-3 @[720px]:items-end')}>
          <Switch
            checked={repeating}
            onChange={loop.toggleCurrentPart}
            label="Repeat this part"
            description={
              repeating
                ? `${stretchText}, starting ${LEAD_IN_SEC} seconds early.`
                : 'The part being sung goes round until you turn this off.'
            }
            testId="practice-repeat-switch"
          />
          <div className="grid grid-cols-1 gap-3 @[480px]:grid-cols-2">
            <div>
              <label htmlFor={`practice-from-${ids}`} className={fieldLabelCls}>
                Repeat from line
              </label>
              <select
                id={`practice-from-${ids}`}
                value={range ? String(range.firstLine) : ''}
                onChange={(e) => pickLine('from', e.target.value)}
                className={selectCls}
              >
                <option value="">Choose the first line</option>
                {lineOptions.map((option) => (
                  <option key={option.index} value={option.index}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`practice-to-${ids}`} className={fieldLabelCls}>
                Repeat to line
              </label>
              <select
                id={`practice-to-${ids}`}
                value={range ? String(range.lastLine) : ''}
                onChange={(e) => pickLine('to', e.target.value)}
                className={selectCls}
              >
                <option value="">Choose the last line</option>
                {lineOptions.map((option) => (
                  // Named apart from the same line in the other list
                  <option
                    key={option.index}
                    value={option.index}
                    aria-label={`${option.label}, as the last line`}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>
      )}

      <div data-guide="practice-singer" className={cn(rowCls, 'py-1 @[720px]:items-center')}>
        <Switch
          checked={singer.on}
          onChange={singer.toggle}
          disabled={!singer.available}
          label="Original singer"
          description={singerNote}
          testId="practice-singer-switch"
        />
        <div className="flex min-w-0 flex-col justify-center gap-1 pb-2 @[720px]:pb-0">
          {singer.status === 'failed' ? (
            <button
              type="button"
              onClick={singer.retry}
              className={cn(linkButtonCls, 'self-start')}
            >
              Try the singer’s track again
            </button>
          ) : (
            singer.on && (
              <div className="flex items-center gap-3">
                <Slider
                  label="Original singer level"
                  value={Math.round(singer.level * 100)}
                  min={0}
                  max={100}
                  step={5}
                  onChange={(value) => singer.setLevel(value / 100)}
                  valueText={(value) => `${value}% of the singer`}
                  testId="practice-singer-level"
                />
                <span className="w-10 shrink-0 text-right text-sm tabular-nums text-theme-text-muted">
                  {Math.round(singer.level * 100)}%
                </span>
              </div>
            )
          )}
          {mix && guideInMix > 0 && singer.available && (
            <p className={noteCls}>
              The mix itself has the singer in it at {guideInMix}%, which this switch cannot take
              out.{' '}
              <button
                type="button"
                onClick={() => {
                  mix.setGuideVolume(0);
                  mix.commitGuideVolume(0);
                }}
                className={linkButtonCls}
              >
                Take the singer out of the mix
              </button>
            </p>
          )}
          {mix && hasVocalLevels(mix.vocalLevels) && singer.on && (
            <p className={noteCls}>
              This mix keeps some of the vocals, so they play twice while the singer is on.
            </p>
          )}
        </div>
      </div>

      {parts.length > 0 && (
        <ol aria-label="Parts of the song" data-testid="practice-parts">
          {parts.map((part) => {
            const isRepeating = part.number === repeatingPart;
            const isSung = part.number === sungPart;
            return (
              <li key={part.number} className="border-b border-theme-border-subtle">
                <button
                  type="button"
                  aria-pressed={isRepeating}
                  aria-current={isSung ? 'true' : undefined}
                  aria-label={`Repeat part ${part.number}: ${part.name}`}
                  onClick={() => (isRepeating ? loop.clear() : loop.repeatPart(part.number))}
                  className={cn(
                    'flex min-h-[44px] w-full items-center gap-3 text-left text-sm transition-colors md:min-h-[36px]',
                    isRepeating
                      ? 'text-theme-accent'
                      : isSung
                        ? 'text-theme-text'
                        : 'text-theme-text-muted hover:text-theme-text',
                    focusRing
                  )}
                >
                  <span className="w-6 shrink-0 text-right tabular-nums">{part.number}</span>
                  <span className={cn('min-w-0 flex-1 truncate', isSung && 'font-semibold')}>
                    {part.name}
                  </span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums">
                    {isRepeating
                      ? 'Repeating'
                      : `${part.lineCount} ${part.lineCount === 1 ? 'line' : 'lines'}`}
                  </span>
                  <span className="w-10 shrink-0 text-right tabular-nums">
                    {formatTime(part.start)}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
};
