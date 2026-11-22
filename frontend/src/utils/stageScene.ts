/**
 * What the stage draws at a moment of the song: every piece of text and every shape, with
 * where it is and how solid it is.
 *
 * This is the stage's copy of what the backend writes into a video's subtitle file
 * (backend/services/ass_layout_stack.py, ass_layout_rows.py, ass_layout_column.py and
 * ass_frame.py): the same lines over the same windows, moving and fading the same way, so a
 * paused stage is the video's frame at that time. Both suites run stage_scene_cases.json,
 * which is made from the subtitle files themselves.
 *
 * Lengths are in u (1% of the frame's short side), sizes are ems and vertical positions are
 * baselines; times are seconds. Motion is linear, as the video's is.
 */
import { faceMetrics } from '../theme/stageFontMetrics';
import {
  STAGE_TIMING,
  frameSize,
  type Align,
  type Aspect,
  type StageLook,
  type StagePart,
} from '../theme/stageLooks';
import {
  columnState,
  drawnWords,
  lineText,
  partName,
  placeBlock,
  placeColumn,
  placeItem,
  placeRowsLine,
  placeStackLine,
  placeStackNext,
  plainText,
  type Block,
  type ColumnLine,
  type Item,
  type LineText,
} from './stageLayout';
import { planTimeline, type LineTiming, type StageTimeline } from './stageTimeline';

/** A count-in dot is this much of the cue size across, with this much between two dots. */
const DOT_SIZE = 0.62;
const DOT_GAP = 0.36;
const COUNT_IN_DOTS = 3;

/** Everything one stage's look depends on, after the user's choices. */
export interface StageStyle {
  look: StageLook;
  aspect: Aspect;
  sung: string;
  unsung: string;
  singer2: string;
  both: string;
  /** The lyric size the user chose (1 is the look's own). */
  scale: number;
  syncMode: 'word' | 'line';
  /** The count-in and the break marker. */
  cues: boolean;
  partNames?: Partial<Record<string, string>> | null;
}

/** A word of a row with its sung times (null for a line that has no word timing). */
export interface SceneWord {
  /** The word's place in its line, for seeking. */
  index: number;
  /** As drawn (in capitals where the look sets them). */
  text: string;
  /** As the lyrics have it, for naming the word to someone who cannot see it. */
  written: string;
  start: number | null;
  end: number | null;
  adlib: boolean;
  space: boolean;
}

export interface SceneRow {
  /** Baseline in u, before the text's `dy`. */
  baseline: number;
  words: SceneWord[];
}

export type TextRole =
  | 'lyric'
  | 'next'
  | 'sung'
  | 'part'
  | 'romaji'
  | 'title'
  | 'title:artist'
  | 'end'
  | 'end:artist'
  | 'countin'
  | 'break';

/** One block of text on the stage. */
export interface SceneText {
  key: string;
  role: TextRole;
  /** The lyric line it belongs to, when it belongs to one. */
  line: number | null;
  face: string;
  size: number;
  condense: number;
  /** Letter spacing in ems. */
  tracking: number;
  /** The edge `align` names (the centre for "center"), in u. */
  x: number;
  align: Align;
  rows: SceneRow[];
  /** Added to every baseline (a line coming up into place, a column stepping). */
  dy: number;
  opacity: number;
  /** The colour of words sung and of words to sing; plain text has one colour for both. */
  sungColor: string;
  unsungColor: string;
  /** How it fills: word by word, all at once at `flipAt`, or not at all. */
  sweep: 'word' | 'line' | 'none';
  flipAt: number;
  /** When the line starts, for seeking. */
  start: number | null;
}

/** One flat shape on the stage, in u from the frame's top left. */
export interface SceneShape {
  /** What it is, as the video's subtitle file names it (progress, caret, countin:5,
   * title:scrim). */
  key: string;
  role: 'progress' | 'caret' | 'countin' | 'scrim';
  shape: 'rect' | 'circle' | 'triangle';
  x: number;
  y: number;
  width: number;
  height: number;
  color: string;
  opacity: number;
  /** A count-in dot keeps the look's outline. */
  outlined: boolean;
}

export interface StageScene {
  texts: SceneText[];
  shapes: SceneShape[];
  /** The line being sung, or the next to be while none is: the one whose words a singer
   * follows. Null when no lyric line is on the stage. */
  active: number | null;
}

interface PreparedLine {
  timing: LineTiming;
  source: Record<string, unknown>;
  text: LineText;
  words: SceneWord[];
  name: string;
  sweep: 'word' | 'line';
  flipAt: number;
  sungColor: string;
  unsungColor: string;
  partColor: string;
}

/** Everything about a song on a stage that does not depend on the time. */
export interface StagePlan {
  style: StageStyle;
  timeline: StageTimeline;
  lines: PreparedLine[];
  /** stack and rows: each line at its place. */
  placed: Array<{ block: Block; label: Item | null; romaji: Item | null }>;
  /** stack: each line as the one waiting under the reading place (null when none fits). */
  waiting: Array<{ block: Block; words: SceneWord[] } | null>;
  /** column: every line down the column. */
  column: ColumnLine[];
  /** column: where each line is and how solid, per line at the reading place (-1 first). */
  columnStates: Array<Array<[number, number]>>;
  title: { block: Block; words: SceneWord[]; artist: Item | null } | null;
  duration: number | null;
}

const toTime = (value: unknown): number | null => {
  const number =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 && value !== '' ? number : null;
};

/** A line's drawn tokens with the times of its words (the editor keeps one word per token);
 * a line without word timing has none. */
function lineWords(line: Record<string, unknown>, text: LineText): SceneWord[] {
  const words = drawnWords(line);
  const timed = words.length > 0 && words.length === text.tokens.length;
  const written = lineText(line, false).tokens;
  return text.tokens.map((token, index) => ({
    index,
    text: token,
    written: written[index] ?? token,
    start: timed ? toTime(words[index].start_time) : null,
    end: timed ? toTime(words[index].end_time) : null,
    adlib: text.adlib[index],
    space: text.spaces[index],
  }));
}

const plainWords = (text: string): SceneWord[] => [
  { index: 0, text, written: text, start: null, end: null, adlib: false, space: false },
];

/** The colour that tells a part apart: its sung colour, or in a look that dims what was
 * sung, the colour of its words still to sing. */
export function partColor(style: StageStyle, part: StagePart): string {
  if (part === 'singer2') return style.singer2;
  if (part === 'both') return style.both;
  return style.look.emphasis === 'unsung' ? style.unsung : style.sung;
}

function paletteColor(style: StageStyle, key: string): string {
  if (key === 'sung' || key === 'unsung' || key === 'singer2' || key === 'both') {
    return style[key];
  }
  return (style.look.palette as Record<string, string>)[key];
}

/**
 * Plans a song on a stage: when everything shows (planTimeline) and where every line goes
 * (stageLayout). Do this once per song and style; sceneAt reads it for each frame.
 */
export function planStage(
  lines: readonly unknown[] | null | undefined,
  duration: number | null | undefined,
  style: StageStyle,
  titles: { title?: string | null; artist?: string | null } = {}
): StagePlan {
  const { look } = style;
  const frame = look.frames[style.aspect];
  const all = Array.isArray(lines) ? lines : [];
  const timeline = planTimeline(all, duration ?? null, style.cues);
  const caps = Boolean(look.caps.lyric);
  const dims = look.emphasis === 'unsung';

  const prepared: PreparedLine[] = timeline.lines.map((timing) => {
    const source = all[timing.index] as Record<string, unknown>;
    const text = lineText(source, caps);
    const words = lineWords(source, text);
    const timed = words.some((word) => word.start !== null);
    const color = partColor(style, timing.part);
    return {
      timing,
      source,
      text,
      words,
      // A line with nothing to draw carries no part name either
      name: timing.label && text.tokens.length ? partName(timing.part, style.partNames) : '',
      sweep: style.syncMode === 'word' && timed ? 'word' : 'line',
      flipAt: dims ? timing.end : timing.start,
      sungColor: dims ? style.sung : color,
      unsungColor: dims ? color : style.unsung,
      partColor: color,
    };
  });

  const plan: StagePlan = {
    style,
    timeline,
    lines: prepared,
    placed: [],
    waiting: [],
    column: [],
    columnStates: [],
    title: null,
    duration: timeline.duration,
  };

  if (look.layout === 'column') {
    plan.column = placeColumn(
      look,
      frame,
      prepared.map((entry) => entry.text),
      prepared.map((entry) => entry.name),
      style.scale
    );
    for (let current = -1; current < prepared.length; current += 1) {
      plan.columnStates.push(columnState(frame, plan.column, current, style.scale));
    }
  } else if (look.layout === 'rows') {
    plan.placed = prepared.map((entry) =>
      placeRowsLine(look, frame, entry.text, entry.timing.index % 2, entry.name, style.scale)
    );
  } else {
    const height = frameSize(style.aspect).height;
    plan.placed = prepared.map((entry) =>
      placeStackLine(look, frame, entry.text, entry.name, style.scale)
    );
    plan.waiting = prepared.map((entry, n) => {
      const text = lineText(entry.source, Boolean(look.caps.next));
      const underRomaji = n > 0 && Boolean(prepared[n - 1].text.romaji);
      const block = placeStackNext(look, frame, text, style.scale, underRomaji, height);
      return block ? { block, words: lineWords(entry.source, text) } : null;
    });
  }

  const heading = (titles.title ?? '').trim() || (titles.artist ?? '').trim();
  const byline = (titles.title ?? '').trim() ? (titles.artist ?? '').trim() : '';
  if (heading) {
    const spec = frame.title;
    const text = plainText(heading, Boolean(look.caps.title));
    const block = placeBlock(look, spec, text, 1, 'title');
    let artist: Item | null = null;
    if (byline) {
      const by = frame.artist;
      const baseline =
        by.place === 'above'
          ? block.top - by.gap
          : block.bottom + by.gap + faceMetrics(by.face).cap_height * by.size;
      artist = placeItem(
        look,
        by.face,
        byline,
        by.size,
        spec.measure,
        block.x,
        block.align,
        baseline,
        'artist'
      );
    }
    plan.title = {
      block,
      words: text.tokens.map((token, index) => ({
        index,
        text: token,
        written: token,
        start: null,
        end: null,
        adlib: false,
        space: text.spaces[index],
      })),
      artist,
    };
  }
  return plan;
}

/** How solid an event is `at` seconds into its `length`: from `from` to `opacity` over the
 * first `enter` seconds, then to clear over the last `exit` seconds. */
function fadeAt(
  at: number,
  length: number,
  opacity = 1,
  from: number | null = null,
  enter = 0,
  exit = 0
): number {
  const start = from === null ? opacity : from;
  if (start >= 1 && opacity >= 1 && exit <= 0) return 1;
  const enterFor = Math.min(enter, length);
  const exitFor = Math.min(exit, Math.max(0, length - enterFor));
  if (at < enterFor) return start + ((opacity - start) * at) / enterFor;
  if (exitFor > 0 && at > length - exitFor) {
    return opacity * Math.max(0, 1 - (at - (length - exitFor)) / exitFor);
  }
  return opacity;
}

/** Where a move is `at` seconds in: from `from` to `to` over the first `over` seconds. */
const moveAt = (at: number, from: number, to: number, over: number): number =>
  over <= 0 || at >= over ? to : from + ((to - from) * at) / over;

const within = (t: number, start: number, end: number): boolean => t >= start && t < end;

function blockRows(block: Block, words: SceneWord[]): SceneRow[] {
  return block.rows.map((row) => ({
    baseline: row.baseline,
    words: words.slice(row.first, row.end),
  }));
}

interface Shown {
  opacity: number;
  dy: number;
}

function textOfBlock(
  key: string,
  role: TextRole,
  line: number | null,
  block: Block,
  words: SceneWord[],
  shown: Shown,
  colors: { sung: string; unsung: string },
  fill: { sweep: 'word' | 'line' | 'none'; flipAt: number; start: number | null },
  tracking = 0
): SceneText {
  return {
    key,
    role,
    line,
    face: block.face,
    size: block.size,
    condense: block.condense,
    tracking,
    x: block.x,
    align: block.align,
    rows: blockRows(block, words),
    dy: shown.dy,
    opacity: shown.opacity,
    sungColor: colors.sung,
    unsungColor: colors.unsung,
    sweep: fill.sweep,
    flipAt: fill.flipAt,
    start: fill.start,
  };
}

function textOfItem(
  key: string,
  role: TextRole,
  line: number | null,
  item: Item,
  shown: Shown,
  color: string,
  tracking = 0
): SceneText {
  return {
    key,
    role,
    line,
    face: item.face,
    size: item.size,
    condense: item.condense,
    tracking,
    x: item.x,
    align: item.align,
    rows: [{ baseline: item.baseline, words: plainWords(item.text) }],
    dy: shown.dy,
    opacity: shown.opacity,
    sungColor: color,
    unsungColor: color,
    sweep: 'none',
    flipAt: 0,
    start: null,
  };
}

const NO_FILL = { sweep: 'none' as const, flipAt: 0, start: null };

/** A line with its part name and romaji, shown the same way. */
function pushLine(
  texts: SceneText[],
  plan: StagePlan,
  n: number,
  placed: { block: Block; label: Item | null; romaji: Item | null },
  role: 'lyric' | 'next' | 'sung',
  shown: Shown
): void {
  const { style } = plan;
  const entry = plan.lines[n];
  const index = entry.timing.index;
  const quiet = style.look.palette.quiet;
  const colors =
    role === 'lyric'
      ? { sung: entry.sungColor, unsung: entry.unsungColor }
      : role === 'sung'
        ? { sung: quiet, unsung: quiet }
        : { sung: entry.unsungColor, unsung: entry.unsungColor };
  const fill =
    role === 'lyric'
      ? { sweep: entry.sweep, flipAt: entry.flipAt, start: entry.timing.start }
      : { ...NO_FILL, start: entry.timing.start };
  texts.push(
    textOfBlock(`line:${index}`, role, index, placed.block, entry.words, shown, colors, fill)
  );
  if (placed.label) {
    texts.push(
      textOfItem(
        `part:${index}`,
        'part',
        index,
        placed.label,
        shown,
        role === 'sung' ? quiet : entry.partColor,
        style.look.tracking.label ?? 0
      )
    );
  }
  if (placed.romaji) {
    texts.push(
      textOfItem(
        `romaji:${index}`,
        'romaji',
        index,
        placed.romaji,
        shown,
        role === 'sung' ? quiet : style.unsung
      )
    );
  }
}

function stackScene(plan: StagePlan, t: number, texts: SceneText[]): void {
  const { look } = plan.style;
  const { motion } = look;
  plan.lines.forEach((entry, n) => {
    const { timing } = entry;
    const start = timing.advance;
    const end = timing.leave + motion.exit;
    if (within(t, start, end)) {
      const at = t - start;
      pushLine(texts, plan, n, plan.placed[n], 'lyric', {
        opacity: fadeAt(at, end - start, 1, 0, motion.enter, motion.exit),
        dy: motion.rise ? moveAt(at, motion.rise, 0, motion.enter) : 0,
      });
    }
    // The line waits under the reading place from when the line before it took over
    const waitsFrom = n ? plan.lines[n - 1].timing.advance : plan.timeline.first_show;
    const waiting = plan.waiting[n];
    if (waiting && waitsFrom < timing.advance && within(t, waitsFrom, timing.advance)) {
      const quiet = look.palette.quiet;
      texts.push(
        textOfBlock(
          `line:${timing.index}`,
          'next',
          timing.index,
          waiting.block,
          waiting.words,
          {
            opacity: fadeAt(t - waitsFrom, timing.advance - waitsFrom, 1, 0, motion.enter, 0),
            dy: 0,
          },
          { sung: quiet, unsung: quiet },
          { ...NO_FILL, start: timing.start },
          look.tracking.next ?? 0
        )
      );
    }
  });
}

function rowsScene(plan: StagePlan, t: number, texts: SceneText[]): void {
  const { motion } = plan.style.look;
  plan.lines.forEach((entry, n) => {
    const { show, hide } = entry.timing;
    if (!within(t, show, hide)) return;
    pushLine(texts, plan, n, plan.placed[n], 'lyric', {
      opacity: fadeAt(t - show, hide - show, 1, 0, motion.enter, motion.exit),
      dy: 0,
    });
  });
}

function columnScene(plan: StagePlan, t: number, texts: SceneText[], shapes: SceneShape[]): void {
  const { look } = plan.style;
  const { motion } = look;
  const frame = look.frames[plan.style.aspect];
  const count = plan.lines.length;
  if (!count) return;
  const endsAt = plan.lines[count - 1].timing.leave;
  const firstShow = plan.timeline.first_show;
  for (let current = -1; current < count; current += 1) {
    const start = current < 0 ? firstShow : plan.lines[current].timing.advance;
    const end = current + 1 < count ? plan.lines[current + 1].timing.advance : endsAt;
    if (end <= start) continue;
    const last = current === count - 1;
    const leaving = last ? motion.exit : 0;
    if (!within(t, start, end + leaving)) continue;
    const now = plan.columnStates[current + 1];
    const before = current >= 0 ? plan.columnStates[current] : null;
    const over = Math.min(current >= 0 ? motion.scroll : motion.enter, end - start);
    const at = t - start;
    plan.column.forEach((line, i) => {
      const [baseline, opacity] = now[i];
      const [wasBaseline, wasOpacity] = before ? before[i] : [baseline, 0];
      if (opacity <= 0 && wasOpacity <= 0) return;
      const role = i === current ? 'lyric' : i < current ? 'sung' : 'next';
      pushLine(texts, plan, i, line, role, {
        opacity: fadeAt(at, end + leaving - start, opacity, wasOpacity, over, leaving),
        dy: moveAt(at, wasBaseline, baseline, over),
      });
    });
  }
  const caret = frame.caret;
  if (caret && within(t, firstShow, endsAt + motion.exit)) {
    // A marker at the reading line, centred on the capitals of the line there
    const spec = frame.lyric;
    const capitals = faceMetrics(spec.face).cap_height * (spec.size ?? 0) * plan.style.scale;
    shapes.push({
      key: 'caret',
      role: 'caret',
      shape: 'triangle',
      x: caret.x,
      y: spec.baseline - capitals / 2 - caret.height / 2,
      width: caret.width,
      height: caret.height,
      color: look.palette.cue,
      opacity: fadeAt(
        t - firstShow,
        endsAt + motion.exit - firstShow,
        1,
        0,
        motion.enter,
        motion.exit
      ),
      outlined: false,
    });
  }
}

function cardScene(
  plan: StagePlan,
  t: number,
  window: [number, number] | null,
  role: 'title' | 'end',
  texts: SceneText[],
  shapes: SceneShape[]
): void {
  if (!window || !plan.title || !within(t, window[0], window[1])) return;
  const { style } = plan;
  const { look } = style;
  const frame = look.frames[style.aspect];
  const fade = STAGE_TIMING.card_fade;
  const at = t - window[0];
  const length = window[1] - window[0];
  const shown = { opacity: fadeAt(at, length, 1, 0, fade, fade), dy: 0 };
  if (look.card_scrim) {
    const size = frameSize(style.aspect);
    const picture = frame.picture ?? { x: 0, y: 0, w: size.width, h: size.height };
    shapes.push({
      key: `${role}:scrim`,
      role: 'scrim',
      shape: 'rect',
      x: picture.x,
      y: picture.y,
      width: picture.w,
      height: picture.h,
      color: look.palette.ground,
      opacity: fadeAt(at, length, look.card_scrim, 0, fade, fade),
      outlined: false,
    });
  }
  const color = paletteColor(style, frame.title.color ?? 'unsung');
  texts.push(
    textOfBlock(
      role,
      role,
      null,
      plan.title.block,
      plan.title.words,
      shown,
      { sung: color, unsung: color },
      NO_FILL,
      look.tracking.title ?? 0
    )
  );
  if (plan.title.artist) {
    texts.push(
      textOfItem(
        `${role}:artist`,
        `${role}:artist`,
        null,
        plan.title.artist,
        shown,
        paletteColor(style, frame.artist.color),
        look.tracking.artist ?? 0
      )
    );
  }
}

function cueScene(plan: StagePlan, t: number, texts: SceneText[], shapes: SceneShape[]): void {
  const { style } = plan;
  const { look } = style;
  const cue = look.frames[style.aspect].cue;
  const numeral = (text: string): Item =>
    placeItem(look, cue.face, text, cue.size, 60, cue.x, cue.align, cue.baseline);
  const still = { opacity: 1, dy: 0 };
  for (const [start, end, vocalsAt] of plan.timeline.breaks) {
    if (!within(t, start, end)) continue;
    // The numeral for `seconds` shows from that many seconds before the vocals, for a
    // second; the seconds are counted for the last ten minutes of a break, however long
    const seconds = Math.ceil(vocalsAt - t - 1e-9);
    if (seconds < 1 || seconds > STAGE_TIMING.break_max) continue;
    const from = Math.max(start, vocalsAt - seconds);
    const to = Math.min(end, vocalsAt - seconds + 1);
    if (to - from < 0.02 || !within(t, from, to)) continue;
    texts.push(
      textOfItem('cue', 'break', null, numeral(String(seconds)), still, look.palette.quiet)
    );
  }
  const parts = new Map(plan.timeline.lines.map((line) => [line.index, line.part]));
  for (const [index, start, end] of plan.timeline.count_ins) {
    if (!within(t, start, end)) continue;
    const part = parts.get(index) ?? 'singer1';
    const color = part === 'singer1' ? look.palette.cue : partColor(style, part);
    if (look.count_in === 'dots') {
      const size = cue.size * DOT_SIZE;
      const step = cue.size * (DOT_SIZE + DOT_GAP);
      for (let dot = 0; dot < COUNT_IN_DOTS; dot += 1) {
        const goesOut = end - (COUNT_IN_DOTS - 1 - dot);
        if (goesOut - start < 0.02 || !within(t, start, goesOut)) continue;
        shapes.push({
          key: `countin:${index}:${dot}`,
          role: 'countin',
          shape: 'circle',
          x: cue.x + dot * step,
          y: cue.baseline - size,
          width: size,
          height: size,
          color,
          opacity: 1,
          outlined: true,
        });
      }
      continue;
    }
    for (let seconds = COUNT_IN_DOTS; seconds > 0; seconds -= 1) {
      const from = Math.max(start, end - seconds);
      const to = end - seconds + 1;
      if (to - from < 0.02 || !within(t, from, to)) continue;
      texts.push(textOfItem('cue', 'countin', index, numeral(String(seconds)), still, color));
    }
  }
}

/**
 * The stage at `t` seconds: the cards, the lines of the look's layout, the count-in and the
 * break marker, and the progress line. `furniture` off leaves the progress line out.
 */
export function sceneAt(plan: StagePlan, t: number, furniture = true): StageScene {
  const texts: SceneText[] = [];
  const shapes: SceneShape[] = [];
  const { look } = plan.style;
  cardScene(plan, t, plan.timeline.title, 'title', texts, shapes);
  if (look.layout === 'column') columnScene(plan, t, texts, shapes);
  else if (look.layout === 'rows') rowsScene(plan, t, texts);
  else stackScene(plan, t, texts);
  cueScene(plan, t, texts, shapes);
  cardScene(plan, t, plan.timeline.end_card, 'end', texts, shapes);
  if (furniture && plan.duration && plan.duration > 0 && within(t, 0, plan.duration)) {
    const size = frameSize(plan.style.aspect);
    const height = look.frames[plan.style.aspect].progress.height;
    shapes.push({
      key: 'progress',
      role: 'progress',
      shape: 'rect',
      x: 0,
      y: size.height - height,
      width: (size.width * t) / plan.duration,
      height,
      color: look.palette.cue,
      opacity: 1,
      outlined: false,
    });
  }
  return { texts, shapes, active: activeLine(texts, t) };
}

/** Of the lines shown as lyrics, the last one that has started; before any has, the first. */
function activeLine(texts: SceneText[], t: number): number | null {
  const lyrics = texts.filter((text) => text.role === 'lyric' && text.line !== null);
  if (!lyrics.length) return null;
  const started = lyrics.filter((text) => text.start !== null && text.start <= t);
  const pick = started.length
    ? started.reduce((a, b) => ((b.start as number) >= (a.start as number) ? b : a))
    : lyrics.reduce((a, b) => ((b.line as number) < (a.line as number) ? b : a));
  return pick.line;
}

/** How far a word is filled at `t`, from 0 to 1, in a text that fills. */
export function wordFill(text: SceneText, word: SceneWord, t: number): number {
  if (text.sweep === 'none') return 0;
  if (text.sweep === 'line' || word.start === null) return t >= text.flipAt ? 1 : 0;
  const end = word.end ?? word.start + 0.4;
  if (t <= word.start) return 0;
  if (t >= end || end <= word.start) return 1;
  return (t - word.start) / (end - word.start);
}
