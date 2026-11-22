import { describe, expect, it } from 'vitest';
// Made from the videos' own subtitle files (python -m backend.tools.stage_cases): what the
// video draws at a moment is what the stage must draw then
import sceneCases from '@shared/stage_scene_cases.json';
import { faceMetrics } from '../../theme/stageFontMetrics';
import { getStageLook, type Aspect } from '../../theme/stageLooks';
import {
  planStage,
  sceneAt,
  wordFill,
  type SceneText,
  type StageStyle,
} from '../../utils/stageScene';

interface DrawnText {
  role: string;
  x: number;
  opacity: number;
  text: string;
  align: string;
  top: number;
  face: string;
  size: number;
  condense: number;
  sung: string;
  unsung?: string;
}
interface DrawnShape {
  role: string;
  x: number;
  opacity: number;
  y: number;
  color: string;
  width?: number;
}
interface SceneCase {
  name: string;
  look: string;
  aspect: Aspect;
  time: number;
  expect: { texts: DrawnText[]; shapes: DrawnShape[] };
}

const SONG = sceneCases.song as unknown as {
  lines: unknown[];
  title: string;
  artist: string;
  duration: number;
  part_names: Record<string, string>;
};
const CASES = sceneCases.cases as unknown as SceneCase[];
const WITH_LINE = new Set(['lyric', 'next', 'sung', 'part', 'romaji', 'countin']);

function styleOf(lookId: string, aspect: Aspect): StageStyle {
  const look = getStageLook(lookId);
  const { sung, unsung, singer2, both } = look.palette;
  return {
    look,
    aspect,
    sung,
    unsung,
    singer2,
    both,
    scale: 1,
    syncMode: 'word',
    cues: true,
    partNames: SONG.part_names,
  };
}

/** The scene's texts as the subtitle file has them: one entry per row, by its top edge. */
function drawnTexts(texts: SceneText[], adlibScale: number): DrawnText[] {
  const rows: DrawnText[] = [];
  for (const text of texts) {
    for (const row of text.rows) {
      const tallest = row.words.length && row.words.every((word) => word.adlib) ? adlibScale : 1;
      const drawn = row.words
        .map((word, i) => word.text + (word.space && i < row.words.length - 1 ? ' ' : ''))
        .join('');
      rows.push({
        role:
          WITH_LINE.has(text.role) && text.line !== null ? `${text.role}:${text.line}` : text.role,
        x: text.x,
        opacity: text.opacity,
        text: drawn,
        align: text.align,
        top: row.baseline + text.dy - faceMetrics(text.face).ascent * text.size * tallest,
        face: text.face,
        size: text.size,
        condense: text.condense,
        sung: text.sungColor,
        ...(text.role === 'lyric' ? { unsung: text.unsungColor } : {}),
      });
    }
  }
  return rows.sort((a, b) => (a.role === b.role ? a.top - b.top : a.role < b.role ? -1 : 1));
}

const PLANS = new Map<string, ReturnType<typeof planStage>>();
function planOf(lookId: string, aspect: Aspect) {
  const key = `${lookId} ${aspect}`;
  let plan = PLANS.get(key);
  if (!plan) {
    plan = planStage(SONG.lines, SONG.duration, styleOf(lookId, aspect), {
      title: SONG.title,
      artist: SONG.artist,
    });
    PLANS.set(key, plan);
  }
  return plan;
}

describe('the stage draws what the video draws', () => {
  it.each(CASES.map((sceneCase) => [sceneCase.name, sceneCase] as const))('%s', (_name, c) => {
    const plan = planOf(c.look, c.aspect);
    const scene = sceneAt(plan, c.time);
    const texts = drawnTexts(scene.texts, plan.style.look.adlib.scale);
    expect(texts.map((text) => `${text.role} ${text.text}`)).toEqual(
      c.expect.texts.map((text) => `${text.role} ${text.text}`)
    );
    texts.forEach((text, i) => {
      const expected = c.expect.texts[i];
      const where = `${c.name}: ${text.role}`;
      expect(text.x, where).toBeCloseTo(expected.x, 2);
      expect(text.top, where).toBeCloseTo(expected.top, 1);
      expect(text.size, where).toBeCloseTo(expected.size, 2);
      expect(text.condense, where).toBeCloseTo(expected.condense, 2);
      expect(Math.abs(text.opacity - expected.opacity), where).toBeLessThan(0.012);
      expect([text.align, text.face, text.sung, text.unsung]).toEqual([
        expected.align,
        expected.face,
        expected.sung,
        expected.unsung,
      ]);
    });

    const shapes = scene.shapes
      .map((shape) => ({
        role: shape.role === 'countin' ? shape.key.split(':').slice(0, 2).join(':') : shape.key,
        x: shape.x,
        y: shape.y,
        opacity: shape.opacity,
        color: shape.color,
        width: shape.width,
      }))
      .sort((a, b) => (a.role === b.role ? a.x - b.x : a.role < b.role ? -1 : 1));
    expect(shapes.map((shape) => shape.role)).toEqual(c.expect.shapes.map((shape) => shape.role));
    shapes.forEach((shape, i) => {
      const expected = c.expect.shapes[i];
      const where = `${c.name}: ${shape.role}`;
      // The progress line is a full-width bar under a clip that opens: its left edge is 0
      expect(shape.x, where).toBeCloseTo(expected.x, 2);
      expect(shape.y, where).toBeCloseTo(expected.y, 2);
      expect(Math.abs(shape.opacity - expected.opacity), where).toBeLessThan(0.012);
      expect(shape.color).toBe(expected.color);
      if (expected.width !== undefined) expect(shape.width, where).toBeCloseTo(expected.width, 1);
    });
  });

  it('fills a word over its own time and a whole line at once in line mode', () => {
    const plan = planOf('ktv', '16:9');
    const lyric = sceneAt(plan, 13.4).texts.find((text) => text.role === 'lyric') as SceneText;
    const [first, second] = lyric.rows[0].words;
    expect(wordFill(lyric, first, 13.4)).toBe(1);
    expect(wordFill(lyric, second, (second.start as number) + 0.1)).toBeGreaterThan(0);
    expect(wordFill(lyric, second, (second.start as number) + 0.1)).toBeLessThan(1);
    expect(wordFill(lyric, second, second.start as number)).toBe(0);
    const whole: SceneText = { ...lyric, sweep: 'line', flipAt: 12 };
    expect(wordFill(whole, second, 11.99)).toBe(0);
    expect(wordFill(whole, second, 12)).toBe(1);
    expect(wordFill({ ...lyric, sweep: 'none' }, first, 99)).toBe(0);
  });

  it('draws nothing but the progress line for a song with no lines', () => {
    const plan = planStage([], 30, styleOf('marquee', '16:9'));
    const scene = sceneAt(plan, 10);
    expect(scene.texts).toEqual([]);
    expect(scene.shapes.map((shape) => shape.role)).toEqual(['progress']);
    expect(sceneAt(plan, 10, false).shapes).toEqual([]);
  });
});
