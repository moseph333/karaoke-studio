/**
 * Sizes a line of words to a measure and decides where its rows break.
 *
 * The video and the stage both run this rule on the same widths (the shared font table), so
 * neither wraps text by itself and both break a line at the same word. Mirrors
 * backend/services/text_fit.py; both suites run stage_fit_cases.json.
 *
 * The fewest rows that reach the preferred size win; when none does, the row count that allows
 * the largest type; text still too wide at the smallest size is condensed, and past the
 * tightest squeeze takes more rows than the box asks for. Rows are balanced: the break that
 * makes the widest row narrowest.
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

/** table[a][b]: the width of tokens [a, b) on one row (rowWidth, for every range). */
function rowWidths(widths: number[], spaces: boolean[], space: number): number[][] {
  const count = widths.length;
  const table = Array.from({ length: count + 1 }, () => new Array<number>(count + 1).fill(0));
  for (let first = 0; first < count; first += 1) {
    let total = 0;
    for (let end = first + 1; end <= count; end += 1) {
      if (end - first > 1 && spaces[end - 2]) total += space;
      total += widths[end - 1];
      table[first][end] = total;
    }
  }
  return table;
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
  const table = rowWidths(widths, spaces, space);
  // tail[k][i]: the narrowest widest row when tokens [i, count) take k rows
  const tail = Array.from({ length: rows + 1 }, () => new Array<number>(count + 1).fill(Infinity));
  for (let start = 0; start < count; start += 1) tail[1][start] = table[start][count];
  for (let k = 2; k <= rows; k += 1) {
    for (let start = 0; start < count; start += 1) {
      let best = Infinity;
      for (const cut of places) {
        if (cut <= start || tail[k - 1][cut] === Infinity) continue;
        const widest = Math.max(table[start][cut], tail[k - 1][cut]);
        if (widest < best) best = widest;
      }
      tail[k][start] = best;
    }
  }
  const target = tail[rows][0];
  if (target === Infinity) return null;
  // The earliest breaks that reach it
  const ranges: Array<[number, number]> = [];
  let start = 0;
  for (let k = rows; k > 1; k -= 1) {
    for (const cut of places) {
      if (cut <= start || tail[k - 1][cut] === Infinity) continue;
      if (Math.max(table[start][cut], tail[k - 1][cut]) <= target + 1e-9) {
        ranges.push([start, cut]);
        start = cut;
        break;
      }
    }
  }
  ranges.push([start, count]);
  return { ranges, widest: target };
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
  let { size, ranges, widest } = chosen;
  let condense = 1;
  const smallest = floorTo(box.min, rules.size_step);
  if (size < smallest) {
    size = smallest;
    let squeeze = widest > 0 ? usable / (widest * size) : 1;
    // Still too wide at the tightest squeeze: more rows than the box asks for, rather than
    // run off the frame
    let rows = ranges.length;
    while (squeeze < rules.min_condense && rows < rules.most_rows) {
      rows += 1;
      const split = balancedRows(widths, spaces, breaks, space, rows);
      if (split === null) break;
      ({ ranges, widest } = split);
      squeeze = widest > 0 ? usable / (widest * size) : 1;
    }
    condense = Math.max(rules.min_condense, Math.floor(squeeze * 100 + 1e-9) / 100);
  }
  return { size: Math.round(size * 10000) / 10000, condense: Math.min(1, condense), rows: ranges };
}
