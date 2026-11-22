import { describe, expect, it } from 'vitest';
// The same cases run against the backend's placement (looks/test_stage_layout_cases.py)
import layoutCases from '@shared/stage_layout_cases.json';
import { getStageLook, type Aspect } from '../../theme/stageLooks';
import {
  columnState,
  lineText,
  partName,
  placeColumn,
  placeRowsLine,
  placeStackLine,
  placeStackNext,
  type Block,
  type Item,
} from '../../utils/stageLayout';

interface LayoutCase {
  name: string;
  layout: 'stack' | 'rows' | 'column';
  look: string;
  aspect: Aspect;
  scale: number;
  line: Record<string, unknown>;
  lines: Array<Record<string, unknown>>;
  part_name: string;
  part_names: string[];
  slot: number;
  next_line?: Record<string, unknown>;
  frame_height: number;
  expect: Record<string, unknown>;
}

const CASES = layoutCases.cases as unknown as LayoutCase[];

/** A nested value with its numbers rounded, so the two sides compare exactly. */
function rounded(value: unknown): unknown {
  if (typeof value === 'number') return Math.round(value * 1e6) / 1e6;
  if (Array.isArray(value)) return value.map(rounded);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, rounded(item)]));
  }
  return value;
}

const block = (placed: Block | null) =>
  placed && { ...placed, rows: placed.rows.map((row) => [row.first, row.end, row.baseline]) };
const item = (placed: Item | null) => placed;

describe('where each look puts a line', () => {
  it.each(CASES.map((layoutCase) => [layoutCase.name, layoutCase] as const))('%s', (_n, c) => {
    const look = getStageLook(c.look);
    const frame = look.frames[c.aspect];
    const text = (line: Record<string, unknown>, role = 'lyric') =>
      lineText(line, Boolean(look.caps[role]));
    if (c.layout === 'column') {
      const placed = placeColumn(
        look,
        frame,
        c.lines.map((line) => text(line)),
        c.part_names,
        c.scale
      );
      const got = placed.map((line) => ({
        block: block(line.block),
        label: item(line.label),
        romaji: item(line.romaji),
        offset: line.offset,
        height: line.height,
      }));
      expect(rounded(got)).toEqual(rounded(c.expect.lines));
      const states = c.expect.states as Record<string, unknown>;
      for (const [current, expected] of Object.entries(states)) {
        expect(rounded(columnState(frame, placed, Number(current), c.scale))).toEqual(
          rounded(expected)
        );
      }
      return;
    }
    const words = text(c.line);
    expect(words.tokens).toEqual(c.expect.tokens);
    const placed =
      c.layout === 'rows'
        ? placeRowsLine(look, frame, words, c.slot, c.part_name, c.scale)
        : placeStackLine(look, frame, words, c.part_name, c.scale);
    expect(rounded(block(placed.block))).toEqual(rounded(c.expect.block));
    expect(rounded(item(placed.label))).toEqual(rounded(c.expect.label));
    expect(rounded(item(placed.romaji))).toEqual(rounded(c.expect.romaji));
    if (c.next_line) {
      const waiting = placeStackNext(
        look,
        frame,
        text(c.next_line, 'next'),
        c.scale,
        Boolean(words.romaji),
        c.frame_height
      );
      expect(rounded(block(waiting))).toEqual(rounded(c.expect.next));
    }
  });

  it('draws Marquee in capitals and the other looks as the line is written', () => {
    const line = { text: 'Straße (oh yeah)' };
    expect(lineText(line, true).tokens).toEqual(['STRASSE', '(OH', 'YEAH)']);
    expect(lineText(line).tokens).toEqual(['Straße', '(oh', 'yeah)']);
    expect(lineText(line, true).adlib).toEqual([false, true, true]);
  });

  it('takes a line’s timed words as its tokens', () => {
    const text = lineText({ text: 'Hold on', words: [{ word: 'Hold' }, { word: 'on' }, 'x'] });
    expect(text.tokens).toEqual(['Hold', 'on']);
    expect(text.spaces).toEqual([true, false]);
  });

  it('shows a part’s own name or the default', () => {
    expect(partName('singer2', { singer2: ' Theo ' })).toBe('Theo');
    expect(partName('singer2', { singer2: '  ' })).toBe('Singer 2');
    expect(partName('both', null)).toBe('Both');
    expect(partName('singer1', {})).toBe('Singer 1');
  });

  it('keeps the line being sung at one height in a column', () => {
    const look = getStageLook('songbook');
    const frame = look.frames['16:9'];
    const texts = Array.from({ length: 6 }, (_, i) =>
      lineText({ text: `Line number ${i} of the song` })
    );
    const placed = placeColumn(
      look,
      frame,
      texts,
      texts.map(() => '')
    );
    for (let current = 0; current < 6; current += 1) {
      const [baseline, opacity] = columnState(frame, placed, current)[current];
      expect(baseline).toBeCloseTo(frame.lyric.baseline, 6);
      expect(opacity).toBe(1);
    }
  });
});
