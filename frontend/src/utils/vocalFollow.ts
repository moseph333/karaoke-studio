/**
 * Keeping the original singer in step with the song in practice.
 *
 * Practice plays the song's vocals by themselves in a second player beside the master, so the
 * singer can be switched on and off at once. The two are separate playings of two files:
 * this is the rule that keeps the second with the first, as plain sums. Given where the
 * master is and where the vocal is, what the vocal should do now.
 *
 * Sound is less forgiving than the picture the show's monitor follows (`utils/stageMonitor`):
 * a singer a tenth of a second off the band is heard. So small drift is closed by playing a
 * few percent faster or slower, which cannot be heard with the pitch kept, and only a real
 * gap (a seek on the master, a stall) is jumped.
 */

export interface FollowedPlayback {
  /** Song position in seconds. */
  time: number;
  playing: boolean;
  /** Playback speed (1 is the song as recorded). */
  rate: number;
}

export interface VocalFollowMemory {
  /** How far ahead of the master a jump aims, in seconds: a jump takes the player a moment. */
  lead: number;
  /** When it last jumped (ms). */
  soughtAt: number | null;
  /** It is playing faster or slower than the master to close a gap. */
  nudging: boolean;
}

export interface VocalStep {
  /** Jump to this position, before playing or pausing. */
  seek?: number;
  /** Play at this speed. */
  rate?: number;
  play?: boolean;
  pause?: boolean;
}

/** Closer than this the vocal is with the master: nothing to do. */
export const IN_STEP_SEC = 0.02;
/** A nudge stops once the gap is this small, so it does not hunt around the edge. */
export const SETTLED_SEC = 0.008;
/** Further apart than this is jumped; nearer is closed by speed. */
export const JUMP_SEC = 0.25;
/** How much faster or slower than the master a nudge plays. */
export const NUDGE = 0.03;
/** After a jump the player's position is not to be trusted for this long. */
export const HOLD_MS = 400;
/** While the master is paused the vocal rests this close to it. */
export const PAUSED_TOLERANCE_SEC = 0.05;

const FIRST_LEAD_SEC = 0.03;
const MAX_LEAD_SEC = 0.5;
/** A jump that lands off within this long of the one before changes the lead. */
const LEAD_MEMORY_MS = 4000;
/** Off by less than this after a jump is the jump having missed; more is the master moving. */
const MISSED_JUMP_SEC = 1.5;

export function newVocalFollowMemory(): VocalFollowMemory {
  return { lead: FIRST_LEAD_SEC, soughtAt: null, nudging: false };
}

/** What the vocal does at `now` (ms) to stay with the master, and what it remembers after. */
export function followMaster(
  master: FollowedPlayback,
  own: FollowedPlayback,
  memory: VocalFollowMemory,
  now: number
): { step: VocalStep; memory: VocalFollowMemory } {
  // Positive: the vocal is behind the master
  const gap = master.time - own.time;
  const sinceSeek = memory.soughtAt === null ? Infinity : now - memory.soughtAt;
  const holding = sinceSeek < HOLD_MS;

  if (!master.playing) {
    const step: VocalStep = {};
    if (own.playing) step.pause = true;
    if (Math.abs(gap) > PAUSED_TOLERANCE_SEC) {
      step.seek = Math.max(0, master.time);
      // A player that has not started may start when it is moved
      step.pause = true;
      return { step, memory: { ...memory, soughtAt: now, nudging: false } };
    }
    return { step, memory: memory.nudging ? { ...memory, nudging: false } : memory };
  }

  const jumpTo = (lead: number) => {
    const step: VocalStep = {
      // A jump lands where the master will be once the player has caught its breath
      seek: Math.max(0, master.time + lead * master.rate),
      rate: master.rate,
    };
    if (!own.playing) step.play = true;
    return { step, memory: { lead, soughtAt: now, nudging: false } };
  };

  if (!own.playing) {
    if (holding) return { step: { play: true, rate: master.rate }, memory };
    if (Math.abs(gap) > IN_STEP_SEC) return jumpTo(memory.lead);
    return { step: { play: true, rate: master.rate }, memory };
  }

  if (holding) {
    return own.rate === master.rate
      ? { step: {}, memory }
      : { step: { rate: master.rate }, memory };
  }

  if (Math.abs(gap) > JUMP_SEC) {
    // Still out by a little soon after a jump: the player took longer (or less) than the lead
    // allowed for, so the next jump aims by that much more (or less). A larger gap is the
    // master having moved, which says nothing about the lead.
    const missed = sinceSeek < LEAD_MEMORY_MS && Math.abs(gap) < MISSED_JUMP_SEC;
    const lead = missed
      ? Math.min(MAX_LEAD_SEC, Math.max(FIRST_LEAD_SEC, memory.lead + gap))
      : memory.lead;
    return jumpTo(lead);
  }

  const within = memory.nudging ? SETTLED_SEC : IN_STEP_SEC;
  if (Math.abs(gap) <= within) {
    const settled = { ...memory, nudging: false };
    if (own.rate !== master.rate) return { step: { rate: master.rate }, memory: settled };
    return { step: {}, memory: memory.nudging ? settled : memory };
  }

  const rate = master.rate * (gap > 0 ? 1 + NUDGE : 1 - NUDGE);
  const nudging = { ...memory, nudging: true };
  if (Math.abs(own.rate - rate) < 1e-6)
    return { step: {}, memory: memory.nudging ? memory : nudging };
  return { step: { rate }, memory: nudging };
}
