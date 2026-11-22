/**
 * Sizes a line of words to a measure and decides where its rows break.
 *
 * The video and the stage both run this rule on the same widths (the shared font table), so
 * neither wraps text by itself and both break a line at the same word. Mirrors
 * backend/services/text_fit.py; both suites run stage_fit_cases.json.
 *
 * The fewest rows that reach the preferred size win; when none does, the row count that allows
 * the largest type; text still too wide at the smallest size is condensed. Rows are balanced:
 * the break that makes the widest row narrowest.
 */
import { FIT_RULES, type TextBoxSpec } from '../theme/stageLooks';

/** Where a block of text may go, in u. */
export interface FitBox {
  measure: number;
  min: number;
  prefer: number;
  max: number;
  rows: number;
}

/** A fitted block: its em size in u, the horizontal squeeze (1 for none) and each row as the
 * [first, after-last) range of its tokens. */
export interface Fit {
  size: number;
  condense: number;
  rows: Array<[number, number]>;
}

const floorTo = (value: number, step: number): number => Math.floor(value / step + 1e-9) * step;

/** The sizes a text box of the spec allows: its `min`, `prefer` and `max`, or one `size` that
 * may shrink by the spec's `shrink` before the text is condensed. `scale` is the lyric size
 * the user chose. */
export function fitBox(
  box: Pick<TextBoxSpec, 'measure' | 'size' | 'min' | 'prefer' | 'max' | 'rows'>,
  scale = 1
): FitBox {
  if (box.size !== undefined) {
    const size = box.size * scale;
    return {
      measure: box.measure,
      min: size * FIT_RULES.shrink,
      prefer: size,
      max: size,
      rows: box.rows ?? 1,
    };
  }
  return {
    measure: box.measure,
    min: (box.min ?? 0) * scale,
    prefer: (box.prefer ?? 0) * scale,
    max: (box.max ?? 0) * scale,
    rows: box.rows ?? 1,
  };
}

/** The width in ems of tokens [first, end) on one row, with a space after each token that has
 * one except the row's last. */
export function rowWidth(
  widths: number[],
  spaces: boolean[],
  space: number,
  first: number,
  end: number
): number {
  let total = 0;
  for (let i = first; i < end; i += 1) {
    total += widths[i];
    if (i < end - 1 && spaces[i]) total += space;
  }
  return total;
}

/** Every way to pick `count` of `items`, in the order Python's itertools.combinations gives. */
function* combinations(items: number[], count: number): Generator<number[]> {
  const total = items.length;
  if (count > total) return;
  const picks = Array.from({ length: count }, (_, i) => i);
  yield picks.map((i) => items[i]);
  for (;;) {
    let at = count - 1;
    while (at >= 0 && picks[at] === at + total - count) at -= 1;
    if (at < 0) return;
    picks[at] += 1;
    for (let next = at + 1; next < count; next += 1) picks[next] = picks[next - 1] + 1;
    yield picks.map((i) => items[i]);
  }
}

/** The split of the tokens into exactly `rows` rows whose widest row is narrowest (the
 * earliest such breaks on a tie), with that width; null when there are not enough places to
 * break. */
export function balancedRows(
  widths: number[],
  spaces: boolean[],
  breaks: boolean[],
  space: number,
  rows: number
): { ranges: Array<[number, number]>; widest: number } | null {
  const count = widths.length;
  const places: number[] = [];
  for (let i = 0; i < count - 1; i += 1) if (breaks[i]) places.push(i + 1);
  if (rows - 1 > places.length) return null;
  let best: { ranges: Array<[number, number]>; widest: number } | null = null;
  for (const cuts of combinations(places, rows - 1)) {
    const edges = [0, ...cuts, count];
    const ranges: Array<[number, number]> = [];
    let widest = 0;
    for (let k = 0; k < rows; k += 1) {
      ranges.push([edges[k], edges[k + 1]]);
      widest = Math.max(widest, rowWidth(widths, spaces, space, edges[k], edges[k + 1]));
    }
    if (best === null || widest < best.widest - 1e-9) best = { ranges, widest };
  }
  return best;
}

/** Fits tokens of the given widths (ems) into `box`. `spaces[i]` says a space follows token
 * i, `breaks[i]` that a row may end after it, `space` is a space's width in ems. */
export function fitBlock(
  widths: number[],
  spaces: boolean[],
  breaks: boolean[],
  space: number,
  box: FitBox
): Fit {
  const rules = FIT_RULES;
  if (widths.length === 0) {
    return { size: floorTo(box.prefer, rules.size_step), condense: 1, rows: [] };
  }
  const usable = box.measure * rules.fill;
  const options: Array<{ size: number; ranges: Array<[number, number]>; widest: number }> = [];
  for (let rows = 1; rows <= Math.max(1, box.rows); rows += 1) {
    const split = balancedRows(widths, spaces, breaks, space, rows);
    if (split === null) break;
    const size = split.widest <= 0 ? box.max : Math.min(box.max, usable / split.widest);
    options.push({ size: floorTo(size, rules.size_step), ...split });
  }
  const prefer = floorTo(box.prefer, rules.size_step);
  let chosen = options.find((option) => option.size >= prefer - 1e-9);
  if (!chosen) {
    chosen = options[0];
    for (const option of options.slice(1)) {
      if (option.size > chosen.size + 1e-9) chosen = option;
    }
  }
  let { size } = chosen;
  let condense = 1;
  const smallest = floorTo(box.min, rules.size_step);
  if (size < smallest) {
    size = smallest;
    const squeeze = chosen.widest > 0 ? usable / (chosen.widest * size) : 1;
    condense = Math.max(rules.min_condense, Math.floor(squeeze * 100 + 1e-9) / 100);
  }
  return {
    size: Math.round(size * 10000) / 10000,
    condense: Math.min(1, condense),
    rows: chosen.ranges,
  };
}
