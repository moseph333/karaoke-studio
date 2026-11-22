/**
 * Where a look puts each lyric line in the frame: the size and rows of its text and the
 * positions of the part name, the romaji and the next line around it.
 *
 * Everything here is in u (1% of the frame's short side), em sizes and baselines, and none of
 * it depends on time. Mirrors backend/services/stage_layout.py, which places the same lines in
 * the exported video; both suites run stage_layout_cases.json. The three layouts:
 *
 * - `stack`: one reading place. The current line grows up from a fixed last baseline, the
 *   next line waits at a fixed place under it.
 * - `rows`: two rows that lines take in turn, each growing up from its own baseline.
 * - `column`: a column of lines that moves up, so the line being sung is at one height.
 */
import { faceMetrics, textWidth } from '../theme/stageFontMetrics';
import {
  DEFAULT_PART_NAMES,
  type Align,
  type LookFrame,
  type StageLook,
  type StagePart,
  type TextBoxSpec,
} from '../theme/stageLooks';
import { adlibFlags, isCjkToken, spaceAfterTokens, tokenizeLyricText } from './lyrics';
import { fitBlock, fitBox, type Fit, type FitBox } from './stageFit';

/** A row of small text under or over a block is spaced by this much of its own size. */
export const SMALL_ROW_PITCH = 1.3;

/** A length rounded to a thousandth of a u, halves up. */
const r3 = (value: number): number => Math.floor(value * 1000 + 0.5) / 1000;

/** A lyric line's words as they are drawn: capitals applied, spaced as written. */
export interface LineText {
  tokens: string[];
  spaces: boolean[];
  adlib: boolean[];
  romaji: string;
}

/** One row of a block: its tokens [first, end) and its baseline. */
export interface Row {
  first: number;
  end: number;
  baseline: number;
}

/** A fitted block of words. `x` is the edge `align` names (the centre for "center"). `top` is
 * the cap line of its first row and `bottom` the baseline of its last. */
export interface Block {
  face: string;
  size: number;
  condense: number;
  x: number;
  align: Align;
  rows: Row[];
  top: number;
  bottom: number;
}

/** One row of plain text: a part name, a romaji line, a count-in numeral, an artist. */
export interface Item {
  face: string;
  text: string;
  size: number;
  condense: number;
  x: number;
  align: Align;
  baseline: number;
}

interface LooseLine {
  text?: unknown;
  romaji?: unknown;
  words?: unknown;
}

const str = (value: unknown): string =>
  value === null || value === undefined || value === false ? '' : String(value);

/** After which tokens a row may end: at a space, or between two CJK characters. */
export function lineBreaks(text: LineText): boolean[] {
  const last = text.tokens.length - 1;
  return text.tokens.map(
    (token, i) =>
      i < last && (text.spaces[i] || (isCjkToken(token) && isCjkToken(text.tokens[i + 1])))
  );
}

/** The words of a lyric line for drawing: its timed words when it has them, else its text
 * split as the editor splits it. */
export function lineText(line: LooseLine, caps = false): LineText {
  const words = (Array.isArray(line.words) ? line.words : []).filter(
    (word): word is { word?: unknown } =>
      word !== null && typeof word === 'object' && !Array.isArray(word)
  );
  const source = str(line.text);
  let tokens = words.length ? words.map((word) => str(word.word)) : tokenizeLyricText(source);
  const spaces = spaceAfterTokens(tokens, source);
  const adlib = adlibFlags(tokens);
  if (caps) tokens = tokens.map((token) => token.toUpperCase());
  const romaji = str(line.romaji).split(/\s+/).filter(Boolean).join(' ');
  return { tokens, spaces, adlib, romaji };
}

/** Any other text (a title, a name) as words, split on spaces. */
export function plainText(text: unknown, caps = false): LineText {
  const tokens = str(text)
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => (caps ? token.toUpperCase() : token));
  return {
    tokens,
    spaces: tokens.map((_, i) => i < tokens.length - 1),
    adlib: tokens.map(() => false),
    romaji: '',
  };
}

/** Each token's width in ems of the block's size (an ad-lib is drawn smaller). */
export function tokenWidths(face: string, text: LineText, adlibScale = 1, tracking = 0): number[] {
  return text.tokens.map(
    (token, i) => textWidth(face, token, tracking) * (text.adlib[i] ? adlibScale : 1)
  );
}

export function fitText(
  face: string,
  text: LineText,
  box: FitBox,
  adlibScale = 1,
  tracking = 0
): Fit {
  return fitBlock(
    tokenWidths(face, text, adlibScale, tracking),
    text.spaces,
    lineBreaks(text),
    textWidth(face, ' ', tracking),
    box
  );
}

interface Place {
  x: number;
  align: Align;
  baseline: number;
}

/**
 * Fits `text` into a text box of the look. The block grows up from the box's baseline (its
 * last row sits there) or down from it (its first row does). `at` moves the box to another x,
 * alignment and baseline (the rows layout's two rows).
 */
export function placeBlock(
  look: StageLook,
  spec: TextBoxSpec,
  text: LineText,
  scale = 1,
  role = 'lyric',
  grow: 'up' | 'down' = 'up',
  at: Place | null = null
): Block {
  const { face } = spec;
  const tracking = look.tracking[role] ?? 0;
  let box = fitBox(spec, scale);
  if (box.max > box.prefer && text.tokens.some((token) => isCjkToken(token))) {
    // CJK characters come from a fallback font, which is not the look's display face: they
    // are not blown up past the preferred size
    box = { ...box, max: box.prefer };
  }
  const fit = fitText(face, text, box, look.adlib.scale, tracking);
  const place = at ?? spec;
  const pitch = fit.size * (spec.leading ?? 1.2);
  const count = fit.rows.length;
  const rows = fit.rows.map(([first, end], k) => ({
    first,
    end,
    baseline: r3(place.baseline + (grow === 'up' ? k - (count - 1) : k) * pitch),
  }));
  const firstBaseline = rows.length ? rows[0].baseline : place.baseline;
  return {
    face,
    size: fit.size,
    condense: fit.condense,
    x: place.x,
    align: place.align,
    rows,
    top: r3(firstBaseline - faceMetrics(face).cap_height * fit.size),
    bottom: rows.length ? rows[rows.length - 1].baseline : place.baseline,
  };
}

/** One row of plain text at a fixed size, shrunk and then condensed when it is wider than
 * `measure`. */
export function placeItem(
  look: StageLook,
  face: string,
  text: string,
  size: number,
  measure: number,
  x: number,
  align: Align,
  baseline: number,
  role = ''
): Item {
  const drawn = plainText(text, Boolean(look.caps[role])).tokens.join(' ');
  const one: LineText = drawn
    ? { tokens: [drawn], spaces: [false], adlib: [false], romaji: '' }
    : { tokens: [], spaces: [], adlib: [], romaji: '' };
  const fit = fitText(face, one, fitBox({ size, measure, rows: 1 }), 1, look.tracking[role] ?? 0);
  return {
    face,
    text: drawn,
    size: fit.size,
    condense: fit.condense,
    x,
    align,
    baseline: r3(baseline),
  };
}

/** The name shown for a part: the song's own, else "Singer 1", "Singer 2" or "Both". */
export function partName(
  part: StagePart,
  partNames?: Partial<Record<string, string>> | null
): string {
  const given = str(partNames?.[part]).trim();
  return given || DEFAULT_PART_NAMES[part] || DEFAULT_PART_NAMES.singer1;
}

export function romajiSize(look: StageLook, frame: LookFrame, scale: number): number {
  return r3(fitBox(frame.lyric, scale).prefer * look.romaji.scale);
}

function romajiItem(
  look: StageLook,
  frame: LookFrame,
  block: Block,
  text: LineText,
  scale: number
): Item | null {
  if (!text.romaji) return null;
  const size = romajiSize(look, frame, scale);
  return placeItem(
    look,
    look.romaji.face || block.face,
    text.romaji,
    size,
    frame.lyric.measure,
    block.x,
    block.align,
    block.bottom + size * SMALL_ROW_PITCH
  );
}

/** The part name by a block: over its first row, or in the margin on `baseline`. */
function labelItem(
  look: StageLook,
  frame: LookFrame,
  block: Block,
  name: string,
  baseline: number
): Item | null {
  if (!name) return null;
  const spec = frame.label;
  if (spec.place === 'margin') {
    return placeItem(
      look,
      spec.face,
      name,
      spec.size,
      spec.measure ?? frame.lyric.measure,
      spec.x ?? block.x,
      spec.align ?? block.align,
      baseline,
      'label'
    );
  }
  return placeItem(
    look,
    spec.face,
    name,
    spec.size,
    frame.lyric.measure,
    block.x,
    block.align,
    block.top - (spec.gap ?? 0),
    'label'
  );
}

/** A lyric line in a `stack` or `rows` layout: its words, its part name and romaji. */
export interface PlacedLine {
  block: Block;
  label: Item | null;
  romaji: Item | null;
}

/** The line at the reading place of a `stack` look. */
export function placeStackLine(
  look: StageLook,
  frame: LookFrame,
  text: LineText,
  name = '',
  scale = 1
): PlacedLine {
  const block = placeBlock(look, frame.lyric, text, scale);
  return {
    block,
    label: labelItem(look, frame, block, name, block.bottom),
    romaji: romajiItem(look, frame, block, text, scale),
  };
}

/** The line waiting under the reading place (written as it is), moved down a row while the
 * current line shows romaji; null when that leaves it no room in the frame. */
export function placeStackNext(
  look: StageLook,
  frame: LookFrame,
  text: LineText,
  scale = 1,
  underRomaji = false,
  frameHeight = 1000
): Block | null {
  const spec = frame.next;
  if (!spec) return null;
  const place: Place = { x: spec.x, align: spec.align, baseline: spec.baseline };
  if (underRomaji) {
    place.baseline = spec.baseline + romajiSize(look, frame, scale) * SMALL_ROW_PITCH;
  }
  const block = placeBlock(look, spec, text, scale, 'next', 'down', place);
  return block.bottom <= frameHeight - 1 ? block : null;
}

/** A line in row `slot` (0 or 1) of a `rows` look. */
export function placeRowsLine(
  look: StageLook,
  frame: LookFrame,
  text: LineText,
  slot: number,
  name = '',
  scale = 1
): PlacedLine {
  const rows = frame.rows ?? [];
  const block = placeBlock(look, frame.lyric, text, scale, 'lyric', 'up', rows[slot % 2]);
  return {
    block,
    label: labelItem(look, frame, block, name, block.bottom),
    romaji: romajiItem(look, frame, block, text, scale),
  };
}

/** A line of a `column` look, measured from its own first baseline (0). `offset` is where that
 * baseline sits down the whole column and `height` how much of the column the line takes, part
 * name, romaji and the gap after it included. */
export interface ColumnLine extends PlacedLine {
  offset: number;
  height: number;
}

/** Every line of the song down one column. */
export function placeColumn(
  look: StageLook,
  frame: LookFrame,
  texts: LineText[],
  names: string[],
  scale = 1
): ColumnLine[] {
  const spec = frame.lyric;
  const labelSpec = frame.label;
  const gap = frame.column?.gap ?? 0;
  const placed: ColumnLine[] = [];
  let cursor = 0;
  texts.forEach((text, i) => {
    const name = names[i] ?? '';
    const local: Place = { x: spec.x, align: spec.align, baseline: 0 };
    const block = placeBlock(look, spec, text, scale, 'lyric', 'down', local);
    const pitch = block.size * (spec.leading ?? 1.2);
    const above =
      name && labelSpec.place === 'above'
        ? labelSpec.size * SMALL_ROW_PITCH + (labelSpec.gap ?? 0)
        : 0;
    const romaji = romajiItem(look, frame, block, text, scale);
    const below = romaji ? romaji.size * SMALL_ROW_PITCH : 0;
    const height = above + Math.max(1, block.rows.length) * pitch + below + gap;
    placed.push({
      block,
      label: labelItem(look, frame, block, name, 0),
      romaji,
      offset: r3(cursor + above),
      height: r3(height),
    });
    cursor += height;
  });
  return placed;
}

/**
 * For each line, the frame baseline of its first row and its opacity while line `current` is
 * at the reading place (-1: before the first line gets there). Lines outside the look's
 * window, or that would run off the frame, have opacity 0.
 */
export function columnState(
  frame: LookFrame,
  placed: ColumnLine[],
  current: number,
  scale = 1
): Array<[number, number]> {
  const spec = frame.lyric;
  const column = frame.column;
  if (!placed.length || !column) return [];
  let origin: number;
  if (current < 0) {
    const standard = fitBox(spec, scale).prefer * (spec.leading ?? 1.2) + column.gap;
    origin = placed[0].offset - standard;
  } else {
    origin = placed[Math.min(current, placed.length - 1)].offset;
  }
  return placed.map((line, i) => {
    const baseline = r3(spec.baseline + line.offset - origin);
    const slot = i - current;
    let alpha: number;
    if (slot < -column.before || slot > column.after) alpha = 0;
    else if (slot <= 0) alpha = 1;
    else alpha = column.after_alpha[slot - 1];
    const last = baseline + (line.block.rows.length ? line.block.bottom : 0);
    if (baseline < column.min_baseline || last > column.max_baseline) alpha = 0;
    return [baseline, alpha];
  });
}
