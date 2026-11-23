/**
 * A picture of a look: two sample lines, the first half sung, drawn by the stage's own
 * renderer in the look's type, colours and layout. It shows a strip of the frame, the whole
 * width and the band of its height the words are in, so the type is large enough to read and
 * the looks keep their sizes relative to each other. Nothing in it can be pressed.
 */
import React, { useMemo } from 'react';
import { frameSize, type Aspect, type StageLook } from '../../theme/stageLooks';
import { planStage, sceneAt, type StageScene } from '../../utils/stageScene';
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
  // Starts just before the first line ends, so a look with two rows (KTV) shows both
  { text: 'One more time', start_time: 3.5, end_time: 5.6 },
];

/** The strip's shape, width over height. */
const SAMPLE_STRIP_RATIO = 16 / 5;

/**
 * Where the strip's top edge is, in u from the frame's top: the band is centred on the words
 * and kept inside the frame.
 */
function sampleBandTop(scene: StageScene, aspect: Aspect): number {
  const size = frameSize(aspect);
  const band = size.width / SAMPLE_STRIP_RATIO;
  let top = Infinity;
  let bottom = -Infinity;
  for (const text of scene.texts) {
    for (const row of text.rows) {
      const baseline = row.baseline + text.dy;
      top = Math.min(top, baseline - text.size * 0.8);
      bottom = Math.max(bottom, baseline + text.size * 0.25);
    }
  }
  if (!Number.isFinite(top)) return 0;
  return Math.max(0, Math.min(size.height - band, (top + bottom) / 2 - band / 2));
}

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
  const size = frameSize(aspect);
  const band = size.width / SAMPLE_STRIP_RATIO;
  const top = sampleBandTop(scene, aspect);
  return (
    <span
      aria-hidden="true"
      data-swatch
      data-look-sample={look.id}
      className={cn(
        'pointer-events-none relative block w-full overflow-hidden border border-theme-border-subtle',
        className
      )}
      style={{ aspectRatio: String(SAMPLE_STRIP_RATIO), backgroundColor: look.palette.ground }}
    >
      {/* The whole frame, moved up so the band with the words is the part in view */}
      <span
        className="absolute left-0 block w-full"
        style={{
          aspectRatio: `${size.width} / ${size.height}`,
          top: `${(-(top / band) * 100).toFixed(3)}%`,
        }}
      >
        <StageFrame look={look} aspect={aspect} scene={scene} time={SAMPLE_TIME} sample>
          {/* Where a look frames its picture (Cinema), a flat stand-in shows the frame */}
          {look.frames[aspect].picture && (
            <span
              className="absolute inset-0 block"
              style={{ backgroundColor: look.palette.quiet, opacity: 0.35 }}
            />
          )}
        </StageFrame>
      </span>
    </span>
  );
};

export const LookSample = React.memo(LookSampleView);
