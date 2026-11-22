import { describe, expect, it } from 'vitest';
// The same cases run against the backend's rule (looks/test_text_fit_cases.py)
import fitCases from '@shared/stage_fit_cases.json';
import { balancedRows, fitBlock, fitBox, rowWidth, type FitBox } from '../../utils/stageFit';
import { FIT_RULES } from '../../theme/stageLooks';

interface FitCase {
  name: string;
  widths: number[];
  spaces: boolean[];
  breaks: boolean[];
  space: number;
  box: FitBox;
  expect: { size: number; condense: number; rows: Array<[number, number]> };
}

const CASES = fitCases.cases as unknown as FitCase[];

describe('fitting a lyric line to its measure', () => {
  it.each(CASES.map((fitCase) => [fitCase.name, fitCase] as const))('%s', (_name, fitCase) => {
    const fit = fitBlock(
      fitCase.widths,
      fitCase.spaces,
      fitCase.breaks,
      fitCase.space,
      fitCase.box
    );
    expect(fit.size).toBeCloseTo(fitCase.expect.size, 6);
    expect(fit.condense).toBeCloseTo(fitCase.expect.condense, 6);
    expect(fit.rows).toEqual(fitCase.expect.rows);
  });

  it('never runs a fitted line past its measure unless condensing ran out', () => {
    for (const fitCase of CASES) {
      const fit = fitBlock(
        fitCase.widths,
        fitCase.spaces,
        fitCase.breaks,
        fitCase.space,
        fitCase.box
      );
      const widest = Math.max(
        0,
        ...fit.rows.map(([a, b]) => rowWidth(fitCase.widths, fitCase.spaces, fitCase.space, a, b))
      );
      if (fit.condense > FIT_RULES.min_condense) {
        expect(widest * fit.size * fit.condense).toBeLessThanOrEqual(fitCase.box.measure + 1e-6);
      }
    }
  });

  it('only ends a row where a break is allowed', () => {
    const widths = [1, 1, 1, 1];
    const spaces = [true, false, true, false];
    const split = balancedRows(widths, spaces, spaces, 0.25, 2);
    expect(split?.ranges).toEqual([
      [0, 1],
      [1, 4],
    ]);
    expect(balancedRows(widths, spaces, [false, false, false, false], 0.25, 2)).toBeNull();
  });

  it('lets a fixed size shrink before the text is condensed', () => {
    const fixed = fitBox({ size: 10, measure: 80, rows: 2 }, 1.5);
    expect(fixed).toEqual({
      measure: 80,
      min: 15 * FIT_RULES.shrink,
      prefer: 15,
      max: 15,
      rows: 2,
    });
    expect(fitBox({ min: 9, prefer: 12, max: 20, measure: 80 }, 0.5)).toEqual({
      measure: 80,
      min: 4.5,
      prefer: 6,
      max: 10,
      rows: 1,
    });
  });
});
