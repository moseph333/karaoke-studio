import { describe, expect, it } from 'vitest';
// The same cases run against the backend's plan (looks/test_stage_timeline_cases.py)
import timelineCases from '@shared/stage_timeline_cases.json';
import { lineSpan, planTimeline, type LineTiming } from '../../utils/stageTimeline';

interface TimelineCase {
  name: string;
  lines: unknown[];
  duration: number | null;
  cues: boolean;
  expect: {
    lines: LineTiming[];
    title: [number, number] | null;
    end_card: [number, number] | null;
    count_ins: Array<[number, number, number]>;
    breaks: Array<[number, number, number]>;
    first_show: number;
  };
}

const CASES = timelineCases.cases as unknown as TimelineCase[];

describe('when each line, card and cue shows', () => {
  it.each(CASES.map((timelineCase) => [timelineCase.name, timelineCase] as const))(
    '%s',
    (_name, timelineCase) => {
      const plan = planTimeline(timelineCase.lines, timelineCase.duration, timelineCase.cues);
      expect(plan.lines).toEqual(timelineCase.expect.lines);
      expect(plan.title).toEqual(timelineCase.expect.title);
      expect(plan.end_card).toEqual(timelineCase.expect.end_card);
      expect(plan.count_ins).toEqual(timelineCase.expect.count_ins);
      expect(plan.breaks).toEqual(timelineCase.expect.breaks);
      expect(plan.first_show).toBe(timelineCase.expect.first_show);
    }
  );

  it('rounds a half centisecond up, as the backend does', () => {
    const plan = planTimeline([{ start_time: 6.125, end_time: 9.125 }], 30);
    expect(plan.count_ins).toEqual([[0, 3.13, 6.13]]);
    expect(plan.lines[0].hide).toBe(10.33);
  });

  it('reads a line with missing or bad times like the backend', () => {
    expect(lineSpan({})).toEqual([0, 4]);
    expect(lineSpan({ start_time: 2, end_time: 1 })).toEqual([2, 2]);
    expect(lineSpan({ start_time: -1, end_time: NaN })).toEqual([0, 4]);
    expect(lineSpan({ start_time: '3.5', end_time: null })).toEqual([3.5, 7.5]);
  });

  it('plans nothing for a song with no lines', () => {
    for (const lines of [null, undefined, [], [null, 'x']]) {
      const plan = planTimeline(lines, 20);
      expect(plan.lines).toEqual([]);
      expect(plan.title).toBeNull();
      expect(plan.end_card).toBeNull();
    }
  });
});
