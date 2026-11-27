/**
 * Practice's pitch lane: the song's melody running past a "now" line, and the note the singer
 * is singing drawn against it, lit while it matches.
 *
 * It sits under the stage's screen, outside the frame of the video: the frame holds only
 * what the export can draw, and this is the singer's own, never part of the video or of a
 * stage window on a second screen.
 *
 * Nothing here is React state while it runs: the lines are written straight to the drawing
 * on every frame, from the playback clock and the microphone's readings, so the studio does
 * not re-render with them. Where each point goes is `utils/pitchLane`.
 */

import React, { useEffect, useMemo, useRef } from 'react';
import type { MelodyData } from '../../types';
import type { MicReading } from '../../hooks/useMicPitch';
import { usePlaybackClock } from '../../hooks/usePlaybackClock';
import { cn } from '../../utils/cn';
import { inTune, melodyRange, nearestMelodyNote } from '../../utils/melody';
import {
  laneNowX,
  laneY,
  melodyPath,
  pointsInView,
  sungNoteInView,
  trailPaths,
  type LaneView,
  type SungPoint,
} from '../../utils/pitchLane';

export interface PracticePitchLaneProps {
  /** The song's melody, or null when it has none (only the singer's pitch is drawn). */
  melody: MelodyData | null;
  /** The key the song plays in, in semitones from the original. */
  semitones: number;
  playbackRate: number;
  /** The microphone's readings (`useMicPitch.subscribe`). */
  subscribe: (listener: (reading: MicReading) => void) => () => void;
  /** Called with each sung note placed in the song (the score listens here). */
  onSung?: (point: SungPoint, matched: boolean | null) => void;
  className?: string;
}

const WIDTH = 800;
const HEIGHT = 100;

export const PracticePitchLane: React.FC<PracticePitchLaneProps> = ({
  melody,
  semitones,
  playbackRate,
  subscribe,
  onSung,
  className,
}) => {
  const clock = usePlaybackClock();
  const melodyRef = useRef<SVGPathElement>(null);
  const sungRef = useRef<SVGPathElement>(null);
  const hitRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGCircleElement>(null);
  const pointsRef = useRef<SungPoint[]>([]);
  /** The note being sung this moment, for the dot on the now line. */
  const liveRef = useRef<{ note: number; hit: boolean } | null>(null);

  const view = useMemo<LaneView>(
    () => ({ width: WIDTH, height: HEIGHT, ...melodyRange(melody, semitones) }),
    [melody, semitones]
  );
  const latest = useRef({ melody, semitones, playbackRate, view, onSung });
  latest.current = { melody, semitones, playbackRate, view, onSung };

  // Another melody or key: the notes drawn so far were placed against the old one
  useEffect(() => {
    pointsRef.current = [];
    liveRef.current = null;
  }, [melody, semitones]);

  useEffect(
    () =>
      subscribe((reading) => {
        const state = latest.current;
        if (reading.midi === null) {
          liveRef.current = null;
          return;
        }
        // Sung a moment ago: the reading looks back over its window
        const time = (clock?.now() ?? 0) - reading.delay * state.playbackRate;
        const options = { semitones: state.semitones, rate: state.playbackRate };
        const target = state.melody ? nearestMelodyNote(state.melody, time, options) : null;
        const matched = state.melody ? inTune(state.melody, time, reading.midi, options) : null;
        const point: SungPoint = {
          time,
          note: sungNoteInView(state.view, reading.midi, target),
          hit: matched === true,
        };
        liveRef.current = { note: point.note, hit: point.hit };
        pointsRef.current.push(point);
        state.onSung?.(point, matched);
      }),
    [subscribe, clock]
  );

  // Draws on every frame while the lane is shown
  useEffect(() => {
    let frame = 0;
    const draw = () => {
      const state = latest.current;
      const now = clock?.now() ?? 0;
      pointsRef.current = pointsInView(pointsRef.current, now);
      const trail = trailPaths(pointsRef.current, now, state.view);
      melodyRef.current?.setAttribute(
        'd',
        melodyPath(state.melody, state.semitones, now, state.view)
      );
      sungRef.current?.setAttribute('d', trail.sung);
      hitRef.current?.setAttribute('d', trail.hit);
      const dot = dotRef.current;
      const live = liveRef.current;
      if (dot) {
        dot.setAttribute('visibility', live ? 'visible' : 'hidden');
        if (live) {
          dot.setAttribute('cy', String(laneY(state.view, live.note)));
          dot.setAttribute('data-hit', live.hit ? 'true' : 'false');
        }
      }
      frame = window.requestAnimationFrame(draw);
    };
    frame = window.requestAnimationFrame(draw);
    return () => window.cancelAnimationFrame(frame);
  }, [clock]);

  const nowX = laneNowX(view);
  return (
    <div
      data-testid="practice-pitch-lane"
      data-guide="practice-pitch-lane"
      role="img"
      aria-label={
        melody
          ? 'Your pitch against the song’s melody'
          : 'Your pitch. This song has no melody to show.'
      }
      className={cn(
        'relative h-16 w-full shrink-0 border-x border-b border-theme-border-subtle bg-theme-bg sm:h-20',
        className
      )}
    >
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        aria-hidden="true"
        className="absolute inset-0 h-full w-full"
      >
        <line
          x1={nowX}
          x2={nowX}
          y1={0}
          y2={HEIGHT}
          vectorEffect="non-scaling-stroke"
          className="stroke-theme-border"
        />
        <path
          ref={melodyRef}
          data-testid="pitch-lane-melody"
          vectorEffect="non-scaling-stroke"
          strokeWidth={3}
          strokeLinecap="butt"
          className="fill-none stroke-theme-text-muted"
        />
        <path
          ref={sungRef}
          data-testid="pitch-lane-sung"
          vectorEffect="non-scaling-stroke"
          strokeWidth={2}
          className="fill-none stroke-theme-text"
        />
        {/* Lit: the notes that matched */}
        <path
          ref={hitRef}
          data-testid="pitch-lane-hit"
          vectorEffect="non-scaling-stroke"
          strokeWidth={4}
          strokeLinecap="square"
          className="fill-none stroke-theme-accent"
        />
        <circle
          ref={dotRef}
          data-testid="pitch-lane-dot"
          cx={nowX}
          cy={HEIGHT / 2}
          r={5}
          visibility="hidden"
          vectorEffect="non-scaling-stroke"
          className="fill-theme-text data-[hit=true]:fill-theme-accent"
        />
      </svg>
    </div>
  );
};
