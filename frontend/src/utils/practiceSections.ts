/**
 * The parts of a song to practise. Nothing says where a verse or a chorus is, so the lines are
 * split where the singing pauses (the same pause the stage counts in after), and a part that is
 * still long is cut at its longest breath until none has more than a handful of lines.
 */

import { planTimeline } from './stageTimeline';
import { TAIL_SEC, type LoopRange } from './practiceLoop';

/** The most lines a part holds. */
export const MAX_PART_LINES = 8;
const NAME_WORDS = 5;
const NAME_CHARS = 32;

/** A run of lyric lines, by their index in the song's lines. */
export interface PracticeStretch extends LoopRange {
  firstLine: number;
  lastLine: number;
}

export interface PracticePart extends PracticeStretch {
  /** 1 for the first part. */
  number: number;
  /** The part's first words. */
  name: string;
  lineCount: number;
}

interface TimedLine {
  index: number;
  start: number;
  end: number;
  gap: boolean;
}

type LooseLines = readonly unknown[] | null | undefined;

function timedLines(lines: LooseLines): TimedLine[] {
  return planTimeline(lines, null, false).lines.map(({ index, start, end, gap }) => ({
    index,
    start,
    end,
    gap,
  }));
}

/** The first words of a line, short enough for a row. */
export function firstWords(text: unknown, fallback: string): string {
  const words = typeof text === 'string' ? text.trim().split(/\s+/).filter(Boolean) : [];
  if (!words.length) return fallback;
  let name = words.slice(0, NAME_WORDS).join(' ');
  if (name.length > NAME_CHARS) name = name.slice(0, NAME_CHARS).trimEnd();
  const whole = words.length <= NAME_WORDS && name.length === words.join(' ').length;
  return whole ? name : `${name}…`;
}

/** Cuts a run of lines at its longest pause (the one nearest the middle when several are as
 *  long) until no piece has more than MAX_PART_LINES. */
function cutLongRun(run: TimedLine[]): TimedLine[][] {
  if (run.length <= MAX_PART_LINES) return [run];
  const middle = run.length / 2;
  let cut = Math.round(middle);
  let longest = -Infinity;
  let sungUntil = Math.max(run[0].end, run[1]?.end ?? run[0].end);
  // A piece of one line is no part: the cut leaves two lines or more on each side
  for (let i = 2; i <= run.length - 2; i += 1) {
    const pause = run[i].start - sungUntil;
    const nearer = Math.abs(i - middle) < Math.abs(cut - middle);
    if (pause > longest + 1e-6 || (Math.abs(pause - longest) <= 1e-6 && nearer)) {
      longest = pause;
      cut = i;
    }
    sungUntil = Math.max(sungUntil, run[i].end);
  }
  return [...cutLongRun(run.slice(0, cut)), ...cutLongRun(run.slice(cut))];
}

function stretchOfRun(run: TimedLine[]): PracticeStretch {
  return {
    firstLine: run[0].index,
    lastLine: run[run.length - 1].index,
    start: Math.min(...run.map((line) => line.start)),
    end: Math.max(...run.map((line) => line.end)),
  };
}

/** The song's lines as parts, in order. */
export function practiceParts(lines: LooseLines): PracticePart[] {
  const runs: TimedLine[][] = [];
  for (const line of timedLines(lines)) {
    if (!runs.length || line.gap) runs.push([line]);
    else runs[runs.length - 1].push(line);
  }
  return runs.flatMap(cutLongRun).map((run, n) => {
    const first = (lines as readonly { text?: unknown }[])[run[0].index];
    return {
      ...stretchOfRun(run),
      number: n + 1,
      name: firstWords(first?.text, `Line ${run[0].index + 1}`),
      lineCount: run.length,
    };
  });
}

/** The part being sung at `time`, or the next one coming; the last part after the singing. */
export function partAt(parts: readonly PracticePart[], time: number): PracticePart | null {
  return parts.find((part) => time < part.end + TAIL_SEC) ?? parts[parts.length - 1] ?? null;
}

/** The stretch from one line to another (either order), or null when it holds no line. */
export function stretchOf(lines: LooseLines, from: number, to: number): PracticeStretch | null {
  const [first, last] = from <= to ? [from, to] : [to, from];
  const run = timedLines(lines).filter((line) => line.index >= first && line.index <= last);
  return run.length ? stretchOfRun(run) : null;
}
