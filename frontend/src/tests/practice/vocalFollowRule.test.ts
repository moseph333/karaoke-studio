/**
 * The rule that keeps the original singer in step with the song: small drift is closed by
 * playing a little faster or slower, a real gap is jumped, and the vocal plays and pauses
 * with the master.
 */
import { describe, it, expect } from 'vitest';
import {
  HOLD_MS,
  IN_STEP_SEC,
  JUMP_SEC,
  NUDGE,
  followMaster,
  newVocalFollowMemory,
  type FollowedPlayback,
  type VocalFollowMemory,
} from '../../utils/vocalFollow';

const at = (time: number, playing = true, rate = 1): FollowedPlayback => ({ time, playing, rate });
const fresh = () => newVocalFollowMemory();
/** A memory whose last jump was long ago, as in the middle of a song. */
const settled = (over: Partial<VocalFollowMemory> = {}): VocalFollowMemory => ({
  ...fresh(),
  soughtAt: 0,
  ...over,
});
const NOW = 60_000;

describe('following the master', () => {
  it('does nothing while the vocal is with the master', () => {
    const { step, memory } = followMaster(at(30), at(30.01), settled(), NOW);
    expect(step).toEqual({});
    expect(memory.nudging).toBe(false);
  });

  it('plays a little faster when it is behind', () => {
    const { step, memory } = followMaster(at(30), at(29.9), settled(), NOW);
    expect(step).toEqual({ rate: 1 + NUDGE });
    expect(memory.nudging).toBe(true);
  });

  it('plays a little slower when it is ahead', () => {
    const { step } = followMaster(at(30), at(30.1), settled(), NOW);
    expect(step).toEqual({ rate: 1 - NUDGE });
  });

  it('nudges around the master’s own speed', () => {
    const { step } = followMaster(at(30, true, 0.5), at(29.9, true, 0.5), settled(), NOW);
    expect(step.rate).toBeCloseTo(0.5 * (1 + NUDGE));
  });

  it('keeps nudging until the gap is nearly closed, then takes the master’s speed again', () => {
    const nudging = settled({ nudging: true });
    // Inside the tolerance, but not yet settled: still nudging, with nothing new to do
    const still = followMaster(at(30), at(30 - IN_STEP_SEC * 0.75, true, 1 + NUDGE), nudging, NOW);
    expect(still.step).toEqual({});
    expect(still.memory.nudging).toBe(true);

    const done = followMaster(at(30), at(29.999, true, 1 + NUDGE), nudging, NOW);
    expect(done.step).toEqual({ rate: 1 });
    expect(done.memory.nudging).toBe(false);
  });

  it('jumps a real gap, aiming a little ahead', () => {
    const { step, memory } = followMaster(at(30), at(12), settled(), NOW);
    expect(step.seek).toBeCloseTo(30 + fresh().lead);
    expect(step.rate).toBe(1);
    expect(step.play).toBeUndefined();
    expect(memory.soughtAt).toBe(NOW);
  });

  it('jumps back when the master goes back (a part going round again)', () => {
    const { step } = followMaster(at(24), at(41), settled(), NOW);
    expect(step.seek).toBeCloseTo(24 + fresh().lead);
  });

  it('leaves the player alone just after a jump', () => {
    const justJumped = settled({ soughtAt: NOW - HOLD_MS / 2 });
    expect(followMaster(at(30), at(29), justJumped, NOW).step).toEqual({});
  });

  it('aims further ahead when a jump landed behind', () => {
    const lead = fresh().lead;
    const jumped = settled({ soughtAt: NOW - 1000, lead });
    const { step, memory } = followMaster(at(30), at(30 - JUMP_SEC - 0.05), jumped, NOW);
    expect(memory.lead).toBeCloseTo(lead + JUMP_SEC + 0.05);
    expect(step.seek).toBeCloseTo(30 + memory.lead);
  });

  it('aims less far ahead when a jump landed in front', () => {
    const jumped = settled({ soughtAt: NOW - 1000, lead: 0.4 });
    const { memory } = followMaster(at(30), at(30.3), jumped, NOW);
    expect(memory.lead).toBeCloseTo(0.1);
  });

  it('does not take the master moving far for a jump that missed', () => {
    const jumped = settled({ soughtAt: NOW - 1000 });
    const { memory } = followMaster(at(90), at(30), jumped, NOW);
    expect(memory.lead).toBe(fresh().lead);
  });

  it('never lets the lead run away', () => {
    let memory = settled({ soughtAt: NOW - 1000 });
    for (let n = 0; n < 20; n += 1) {
      memory = { ...followMaster(at(30), at(29), memory, NOW).memory, soughtAt: NOW - 1000 };
    }
    expect(memory.lead).toBeLessThanOrEqual(0.5);
  });

  it('starts playing with the master, from where the master is', () => {
    const { step } = followMaster(at(30), at(0, false), fresh(), NOW);
    expect(step.play).toBe(true);
    expect(step.seek).toBeCloseTo(30 + fresh().lead);
    expect(step.rate).toBe(1);
  });

  it('just plays when it is already in place', () => {
    expect(followMaster(at(30), at(30, false), fresh(), NOW).step).toEqual({ play: true, rate: 1 });
  });

  it('pauses with the master and rests on the same moment', () => {
    const paused = followMaster(at(30, false), at(30.01), settled(), NOW);
    expect(paused.step).toEqual({ pause: true });

    const moved = followMaster(at(12, false), at(30, false), settled(), NOW);
    expect(moved.step).toEqual({ seek: 12, pause: true });
  });

  it('does nothing while both rest together', () => {
    expect(followMaster(at(30, false), at(30, false), settled(), NOW).step).toEqual({});
  });

  it('takes the master’s speed when the master changes it', () => {
    const justJumped = settled({ soughtAt: NOW - 100 });
    expect(followMaster(at(30, true, 0.75), at(30), justJumped, NOW).step).toEqual({ rate: 0.75 });
    expect(followMaster(at(30, true, 0.75), at(30), settled(), NOW).step).toEqual({ rate: 0.75 });
  });
});

describe('a simulated song', () => {
  /** Two players a tick apart in speed: the vocal's clock runs 0.2% fast. */
  function play(seconds: number, vocalClock = 1.002) {
    let memory = fresh();
    let master = 0;
    let vocal = 0;
    let rate = 1;
    let playing = false;
    let worst = 0;
    let jumps = 0;
    const tick = 0.25;
    for (let t = 0; t < seconds; t += tick) {
      const { step, memory: next } = followMaster(
        at(master),
        { time: vocal, playing, rate },
        memory,
        t * 1000
      );
      memory = next;
      if (step.seek !== undefined) {
        vocal = step.seek;
        jumps += 1;
      }
      if (step.rate !== undefined) rate = step.rate;
      if (step.play) playing = true;
      master += tick;
      if (playing) vocal += tick * rate * vocalClock;
      if (t > 2) worst = Math.max(worst, Math.abs(master - vocal));
    }
    return { worst, jumps };
  }

  it('stays within a few hundredths of a second over a whole song', () => {
    const { worst, jumps } = play(240);
    expect(worst).toBeLessThan(0.04);
    // Only the first placing is a jump: the rest is speed
    expect(jumps).toBeLessThanOrEqual(1);
  });

  it('holds a slow clock as well as a fast one', () => {
    expect(play(240, 0.997).worst).toBeLessThan(0.04);
  });
});
