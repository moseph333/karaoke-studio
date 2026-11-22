/**
 * Text widths and vertical metrics of the stage typefaces, from the table the backend reads
 * too (backend/assets/shared/stage_font_metrics.json). Widths are sums of advance widths
 * without kerning, the same on both sides, which is what makes the stage and the video break a
 * line at the same word. Mirrors backend/services/font_metrics.py.
 */
import table from '@shared/stage_font_metrics.json';

export interface FaceMetrics {
  file: string;
  css_family: string;
  css_weight: number;
  css_style: 'normal' | 'italic';
  /** Multiples of the em: where the top of a row and the cap line sit above its baseline. */
  ascent: number;
  descent: number;
  cap_height: number;
  /** Each listed character's advance width in thousandths of an em. */
  advances: Record<string, number>;
}

const TABLE = table as unknown as {
  wide_advance: number;
  fallback_advance: number;
  wide_ranges: Array<[number, number]>;
  zero_ranges: Array<[number, number]>;
  faces: Record<string, FaceMetrics>;
};

/** One face's entry: its file, the names CSS knows it by, and its metrics. */
export function faceMetrics(faceId: string): FaceMetrics {
  return TABLE.faces[faceId];
}

/** Every face id in the table. */
export const STAGE_FACE_IDS: readonly string[] = Object.keys(TABLE.faces);

const inRanges = (code: number, ranges: Array<[number, number]>): boolean =>
  ranges.some(([first, last]) => first <= code && code <= last);

/** A character's advance width in thousandths of an em: the face's own, else nothing for a
 * combining mark, one em for an East Asian wide character, else the fallback width. */
export function charAdvance(faceId: string, char: string): number {
  const listed = TABLE.faces[faceId].advances[char];
  if (listed !== undefined) return listed;
  const code = char.codePointAt(0) ?? 0;
  if (inRanges(code, TABLE.zero_ranges)) return 0;
  if (inRanges(code, TABLE.wide_ranges)) return TABLE.wide_advance;
  return TABLE.fallback_advance;
}

/** How wide `text` is in ems, with `tracking` ems added after every character. */
export function textWidth(faceId: string, text: string, tracking = 0): number {
  let total = 0;
  let count = 0;
  for (const char of text) {
    total += charAdvance(faceId, char);
    count += 1;
  }
  return total / 1000 + tracking * count;
}
