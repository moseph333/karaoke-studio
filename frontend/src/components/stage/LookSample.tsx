/**
 * A small picture of a look: two sample lines, the first half sung, drawn by the stage's own
 * renderer in the look's type, colours and layout. Nothing in it can be pressed.
 */
import React, { useMemo } from 'react';
import type { Aspect, StageLook } from '../../theme/stageLooks';
import { planStage, sceneAt } from '../../utils/stageScene';
import { cn } from '../../utils/cn';
import { StageFrame } from './StageFrame';

/** The moment the sample shows: the first line half sung, the second waiting. */
const SAMPLE_TIME = 2.3;
const SAMPLE_LINES = [
  {
    text: 'Sing it back to me',
    start_time: 1,
    end_time: 3.6,
    words: [
      { word: 'Sing', start_time: 1, end_time: 1.5 },
      { word: 'it', start_time: 1.5, end_time: 1.9 },
      { word: 'back', start_time: 1.9, end_time: 2.7 },
      { word: 'to', start_time: 2.7, end_time: 3.1 },
      { word: 'me', start_time: 3.1, end_time: 3.6 },
    ],
  },
  { text: 'One more time', start_time: 3.8, end_time: 5.6 },
];

export interface LookSampleProps {
  look: StageLook;
  aspect: Aspect;
  /** The colours in use for this look (its own unless the user chose others). */
  sung?: string;
  unsung?: string;
  className?: string;
}

const LookSampleView: React.FC<LookSampleProps> = ({ look, aspect, sung, unsung, className }) => {
  const scene = useMemo(() => {
    const plan = planStage(SAMPLE_LINES, null, {
      look,
      aspect,
      sung: sung ?? look.palette.sung,
      unsung: unsung ?? look.palette.unsung,
      singer2: look.palette.singer2,
      both: look.palette.both,
      scale: 1,
      syncMode: 'word',
      cues: false,
    });
    return sceneAt(plan, SAMPLE_TIME, false);
  }, [look, aspect, sung, unsung]);
  return (
    <span
      aria-hidden="true"
      data-swatch
      data-look-sample={look.id}
      className={cn('pointer-events-none relative block overflow-hidden', className)}
      style={{ aspectRatio: aspect === '9:16' ? '9 / 16' : '16 / 9' }}
    >
      <StageFrame look={look} aspect={aspect} scene={scene} time={SAMPLE_TIME} sample />
    </span>
  );
};

export const LookSample = React.memo(LookSampleView);
