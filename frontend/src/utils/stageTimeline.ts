/**
 * When things show on the stage and in the video: when each line appears and takes the reading
 * place, and when the title cards, the count-in and the break marker show. The numbers are
 * shared with the backend (the `timing` block of stage_looks.json), whose copy is
 * plan_timeline in backend/services/stage_timing.py; both suites run
 * stage_timeline_cases.json.
 */
import { normalizeSingerRole } from '../components/stage/singers';
import { STAGE_TIMING, type StagePart } from '../theme/stageLooks';

/**
 * When one lyric line is on screen. `show` and `hide` are for looks that keep each line in a
 * row of its own (it appears before it is sung and stays a moment after). `advance` and
 * `leave` are for looks with one reading place: the line takes it at `advance` and gives it up
 * at `leave`.
 */
export interface LineTiming {
  index: number;
  start: number;
  end: number;
  part: StagePart;
  gap: boolean;
  show: number;
  hide: number;
  advance: number;
  leave: number;
  label: boolean;
}

/** Everything the stage shows and when: the lines, the opening title card, the end card, each
 * count-in as [line index, from, to] and each break as [from, to, vocals at]. `first_show` is
 * when lyrics may first appear (after the title card). */
export interface StageTimeline {
  lines: LineTiming[];
  title: [number, number] | null;
  end_card: [number, number] | null;
  count_ins: Array<[number, number, number]>;
  breaks: Array<[number, number, number]>;
  first_show: number;
  duration: number | null;
}

/** A time rounded to the centisecond, halves up, never negative. */
const cs = (seconds: number): number => Math.floor(Math.max(0, seconds) * 100 + 0.5) / 100;

/** A timestamp made safe: a finite number that is not negative, else `fallback`. */
function safeTime(value: unknown, fallback: number): number {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  if (Number.isFinite(number) && number >= 0 && value !== '') return number;
  return Number.isFinite(fallback) && fallback >= 0 ? fallback : 0;
}

/** A line's [start, end] in seconds: a missing or bad start is 0, a missing or bad end is 4 s
 * after the start, and the end is never before the start. */
export function lineSpan(line: { start_time?: unknown; end_time?: unknown }): [number, number] {
  const start = safeTime(line.start_time, 0);
  return [start, Math.max(start, safeTime(line.end_time, start + 4))];
}

type LooseLine = { start_time?: unknown; end_time?: unknown; singer?: unknown };

/**
 * Plans a song's lines. `duration` is the song's length when known (without it there is no
 * end card). `cues` off leaves out the count-ins and break markers. Entries of `lines` that
 * are not objects are skipped but keep their index.
 */
export function planTimeline(
  lines: readonly unknown[] | null | undefined,
  duration: number | null = null,
  cues = true
): StageTimeline {
  const rules = STAGE_TIMING;
  const entries: Array<{ index: number; line: LooseLine }> = [];
  (Array.isArray(lines) ? lines : []).forEach((line, index) => {
    if (line !== null && typeof line === 'object' && !Array.isArray(line)) {
      entries.push({ index, line: line as LooseLine });
    }
  });
  const spans = entries.map(({ line }) => lineSpan(line));
  const parts = entries.map(({ line }) =>
    normalizeSingerRole(typeof line.singer === 'string' ? line.singer : null)
  );
  const severalParts = parts.some((part) => part !== 'singer1');

  let title: [number, number] | null = null;
  if (spans.length && spans[0][0] >= rules.title_min_intro) {
    const titleEnd = Math.min(
      spans[0][0] - rules.count_in - rules.title_gap,
      rules.title_start + rules.title_max
    );
    title = [cs(rules.title_start), cs(titleEnd)];
  }
  const firstShow = title ? cs(title[1] + rules.title_gap) : 0;

  const timed: LineTiming[] = [];
  const countIns: Array<[number, number, number]> = [];
  const breaks: Array<[number, number, number]> = [];
  let previousEnd = 0;
  let previousAdvance = -1;
  entries.forEach(({ index }, n) => {
    const [start, end] = spans[n];
    const gap = start - previousEnd >= rules.gap_threshold;
    let show: number;
    let advance: number;
    if (n === 0) {
      show = Math.max(0, start - rules.first_early_show);
      advance = show;
    } else {
      show =
        start > previousEnd
          ? Math.max(previousEnd, start - rules.early_show)
          : Math.max(0, start - rules.early_show);
      advance = Math.max(start - rules.early_show, Math.min(previousEnd, start));
    }
    show = Math.max(0, Math.min(start, show));
    advance = cs(Math.max(advance, previousAdvance + 0.01, 0));
    const hide = Math.max(show + rules.min_show, end + rules.lead_out);
    if (cues && gap) {
      countIns.push([index, cs(Math.max(0, start - rules.count_in)), cs(start)]);
      const breakFrom = n === 0 ? firstShow : previousEnd + rules.break_delay;
      const breakTo = start - rules.count_in;
      if (breakTo - breakFrom >= rules.break_min) {
        breaks.push([cs(breakFrom), cs(breakTo), cs(start)]);
      }
    }
    timed.push({
      index,
      start,
      end,
      part: parts[n],
      gap,
      show: cs(show),
      hide: cs(hide),
      advance,
      leave: 0,
      label: severalParts && (n === 0 || parts[n] !== parts[n - 1]),
    });
    previousEnd = Math.max(previousEnd, end);
    previousAdvance = advance;
  });

  timed.forEach((line, n) => {
    let leave = line.end + rules.lead_out;
    if (n + 1 < timed.length) leave = Math.min(leave, timed[n + 1].advance);
    line.leave = cs(Math.max(leave, line.advance + 0.01));
  });

  let endCard: [number, number] | null = null;
  const length = safeTime(duration, 0);
  if (timed.length && previousEnd > 0) {
    const cardFrom = previousEnd + rules.end_delay;
    if (length - cardFrom >= rules.end_min) endCard = [cs(cardFrom), cs(length)];
  }

  return {
    lines: timed,
    title,
    end_card: endCard,
    count_ins: countIns,
    breaks,
    first_show: firstShow,
    duration: length || null,
  };
}
