/**
 * Stage monitor: keeping a second, silent player in step with the video on the stage window.
 *
 * A show's video plays in the stage window, on the TV. The host screen shows the same video
 * in a small player of its own with no sound, so the host sees what the room sees. The two
 * are separate playings of one video: the monitor is told where the stage's is (the reports
 * the stage window sends, about four times a second) and follows it. `followStage` is that
 * rule, as plain sums: given where the stage is and where the monitor is, what the monitor
 * should do now.
 *
 * It plays and pauses with the stage and jumps when it has fallen out of step. A jump costs a
 * player a moment of loading, during which the stage moves on, so a jump aims a little ahead
 * (`lead`), is left alone to settle before the next, and aims further ahead when the last one
 * still landed behind.
 */

/** Where the stage's video is: `time` as last heard, at `at` (this window's clock, in ms). */
export interface MonitorTarget {
  playing: boolean;
  time: number;
  at: number;
}

/** Where the monitor's own player is. */
export interface MonitorPlayback {
  playing: boolean;
  time: number;
  /** It ran to the end of the video. */
  ended?: boolean;
}

/** What the monitor remembers between steps. */
export interface FollowMemory {
  /** How far ahead of the stage a jump aims, in seconds. */
  lead: number;
  /** When it last jumped (this window's clock, in ms). */
  soughtAt: number | null;
}

export interface MonitorStep {
  /** Jump to this position, before playing or pausing. */
  seek?: number;
  play?: boolean;
  pause?: boolean;
}

/** While both play, the monitor may be this far from the stage before it jumps. */
export const PLAYING_TOLERANCE_SEC = 0.75;
/** While the stage is paused, the monitor rests on the same picture. */
export const PAUSED_TOLERANCE_SEC = 0.25;
/** Further out than this is a jump on the stage (a seek), followed at once. */
export const JUMP_SEC = 3;
/** After a jump the player's position is not to be trusted for this long. */
export const HOLD_MS = 1000;
/** After a jump, drift within `JUMP_SEC` is left alone this long while the player catches up. */
export const SETTLE_MS = 3000;
/** A stage that says it is playing and has not been heard from this long has stalled. */
export const SILENCE_MS = 2000;

const FIRST_LEAD_SEC = 0.25;
const MAX_LEAD_SEC = 2;
/** A jump that lands behind within this long of the one before raises the lead. */
const LEAD_MEMORY_MS = SETTLE_MS * 4;

export function newFollowMemory(): FollowMemory {
  return { lead: FIRST_LEAD_SEC, soughtAt: null };
}

/** Whether the stage is playing as far as anyone can tell at `now`. */
function stageIsPlaying(target: MonitorTarget, now: number): boolean {
  return target.playing && now - target.at <= SILENCE_MS;
}

/** The stage's position at `now`: it has moved on since it was heard, if it is playing. */
export function stageTimeAt(target: MonitorTarget, now: number): number {
  if (!target.playing) return target.time;
  const elapsed = Math.min(Math.max(0, now - target.at), SILENCE_MS);
  return target.time + elapsed / 1000;
}

/** What the monitor does at `now` to stay with the stage, and what it remembers after. */
export function followStage(
  target: MonitorTarget,
  own: MonitorPlayback,
  memory: FollowMemory,
  now: number
): { step: MonitorStep; memory: FollowMemory } {
  const expected = stageTimeAt(target, now);
  const drift = expected - own.time;
  const sinceSeek = memory.soughtAt === null ? Infinity : now - memory.soughtAt;
  const holding = sinceSeek < HOLD_MS;

  if (!stageIsPlaying(target, now)) {
    const step: MonitorStep = {};
    if (own.playing) step.pause = true;
    if (!holding && Math.abs(drift) > PAUSED_TOLERANCE_SEC) {
      step.seek = Math.max(0, expected);
      // A player that has not started may start when it is moved
      step.pause = true;
      return { step, memory: { ...memory, soughtAt: now } };
    }
    return { step, memory };
  }

  // The monitor reached the end first (it runs a little ahead): the stage is about to
  if (own.ended && drift > -JUMP_SEC) return { step: {}, memory };

  const jumpTo = (lead: number) => {
    const step: MonitorStep = { seek: Math.max(0, expected + lead) };
    if (!own.playing) step.play = true;
    return { step, memory: { lead, soughtAt: now } };
  };

  if (!own.playing) {
    if (holding) return { step: { play: true }, memory };
    if (Math.abs(drift) > PLAYING_TOLERANCE_SEC) return jumpTo(memory.lead);
    return { step: { play: true }, memory };
  }

  if (holding) return { step: {}, memory };
  if (Math.abs(drift) > JUMP_SEC) return jumpTo(memory.lead);
  if (Math.abs(drift) > PLAYING_TOLERANCE_SEC && sinceSeek >= SETTLE_MS) {
    // Still behind after the last jump: loading took longer than the lead allowed for
    const fellBehind = drift > 0 && sinceSeek < LEAD_MEMORY_MS;
    return jumpTo(fellBehind ? Math.min(MAX_LEAD_SEC, memory.lead + drift) : memory.lead);
  }
  return { step: {}, memory };
}
