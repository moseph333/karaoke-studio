/**
 * The rule that keeps the host screen's silent video with the one on the stage window
 * (`utils/stageMonitor.followStage`): when it plays, pauses and jumps, and when it leaves
 * its player alone.
 */

import { describe, expect, it } from 'vitest';
import {
  HOLD_MS,
  SETTLE_MS,
  SILENCE_MS,
  followStage,
  newFollowMemory,
  stageTimeAt,
  type FollowMemory,
} from '../../utils/stageMonitor';

const NOW = 100_000;
/** The stage, heard just now. */
const stage = (playing: boolean, time: number, at = NOW) => ({ playing, time, at });
const fresh = newFollowMemory();
/** A monitor that last jumped `ago` ms before now. */
const jumped = (ago: number, lead = fresh.lead): FollowMemory => ({ lead, soughtAt: NOW - ago });

describe('where the stage is now', () => {
  it('has moved on since it was heard, while it plays', () => {
    expect(stageTimeAt(stage(true, 30, NOW - 500), NOW)).toBeCloseTo(30.5);
  });

  it('stays where it was heard while it is paused', () => {
    expect(stageTimeAt(stage(false, 30, NOW - 5000), NOW)).toBe(30);
  });
});

describe('playing and pausing with the stage', () => {
  it('starts when the stage starts', () => {
    const { step } = followStage(stage(true, 0.2), { playing: false, time: 0 }, fresh, NOW);

    expect(step).toEqual({ play: true });
  });

  it('starts from where the stage is when that is somewhere else', () => {
    const { step, memory } = followStage(stage(true, 40), { playing: false, time: 0 }, fresh, NOW);

    expect(step).toEqual({ seek: 40 + fresh.lead, play: true });
    expect(memory.soughtAt).toBe(NOW);
  });

  it('does nothing while it is in step', () => {
    const { step, memory } = followStage(
      stage(true, 30),
      { playing: true, time: 30.4 },
      fresh,
      NOW
    );

    expect(step).toEqual({});
    expect(memory).toEqual(fresh);
  });

  it('pauses when the stage pauses', () => {
    const { step } = followStage(stage(false, 30), { playing: true, time: 30.1 }, fresh, NOW);

    expect(step).toEqual({ pause: true });
  });

  it('rests on the stage’s picture while the stage is paused', () => {
    const { step } = followStage(stage(false, 30), { playing: false, time: 12 }, fresh, NOW);

    expect(step).toEqual({ seek: 30, pause: true });
  });

  it('stops when the stage says it is playing and has gone quiet', () => {
    const quiet = stage(true, 30, NOW - SILENCE_MS - 1);

    const { step } = followStage(quiet, { playing: true, time: 32 }, fresh, NOW);

    expect(step).toEqual({ pause: true });
  });
});

describe('falling out of step', () => {
  it('follows a jump on the stage at once, aiming a little ahead', () => {
    const { step } = followStage(
      stage(true, 90),
      { playing: true, time: 30 },
      jumped(HOLD_MS + 1),
      NOW
    );

    expect(step).toEqual({ seek: 90 + fresh.lead });
  });

  it('follows a jump back to the start', () => {
    const { step } = followStage(stage(true, 0), { playing: true, time: 120 }, fresh, NOW);

    expect(step).toEqual({ seek: fresh.lead });
  });

  it('jumps when it has drifted further than a moment', () => {
    const { step } = followStage(stage(true, 30), { playing: true, time: 28.8 }, fresh, NOW);

    expect(step).toEqual({ seek: 30 + fresh.lead });
  });

  it('leaves its player alone just after a jump, whatever the player says', () => {
    const { step } = followStage(
      stage(true, 90),
      { playing: true, time: 30 },
      jumped(HOLD_MS - 1),
      NOW
    );

    expect(step).toEqual({});
  });

  it('lets a jump settle before it corrects a small drift', () => {
    const own = { playing: true, time: 28.8 };

    expect(followStage(stage(true, 30), own, jumped(SETTLE_MS - 1), NOW).step).toEqual({});
    expect(followStage(stage(true, 30), own, jumped(SETTLE_MS), NOW).step.seek).toBeDefined();
  });

  it('aims further ahead when the last jump still landed behind', () => {
    const { step, memory } = followStage(
      stage(true, 30),
      { playing: true, time: 29 },
      jumped(SETTLE_MS, 0.25),
      NOW
    );

    expect(memory.lead).toBeCloseTo(1.25);
    expect(step.seek).toBeCloseTo(31.25);
  });

  it('never aims more than two seconds ahead', () => {
    const { memory } = followStage(
      stage(true, 30),
      { playing: true, time: 27.5 },
      jumped(SETTLE_MS, 1.5),
      NOW
    );

    expect(memory.lead).toBe(2);
  });

  it('keeps its aim when it landed ahead of the stage', () => {
    const { memory } = followStage(
      stage(true, 30),
      { playing: true, time: 31 },
      jumped(SETTLE_MS, 0.5),
      NOW
    );

    expect(memory.lead).toBe(0.5);
  });

  it('never jumps to before the start', () => {
    const { step } = followStage(stage(false, -1), { playing: false, time: 5 }, fresh, NOW);

    expect(step.seek).toBe(0);
  });
});

describe('the end of the video', () => {
  it('waits at the end for the stage, which is about to get there', () => {
    const own = { playing: false, time: 200, ended: true };

    expect(followStage(stage(true, 199.6), own, fresh, NOW).step).toEqual({});
  });

  it('starts again when the stage goes back to the top', () => {
    const own = { playing: false, time: 200, ended: true };

    expect(followStage(stage(true, 0), own, fresh, NOW).step).toEqual({
      seek: fresh.lead,
      play: true,
    });
  });
});
