/**
 * Vocal levels: which of a song's vocals stay in the mix (the project's `vocal_levels`, sent
 * with POST /mix and /render; see backend/services/vocal_mix.py).
 *
 * `backing` is the level of the backing vocals once the vocals are split into lead and
 * backing parts. With `by: 'lines'` the lead takes a level per singer during that singer's
 * lyric lines; with `by: 'voices'` it is the male and the female voice it was split into,
 * each at its level. A level that is not set follows the guide vocal.
 */

import type { LyricLine, SingerRole, VocalLevels } from '../types';
import { normalizeSingerRole } from '../components/stage/singers';

export const VOCAL_LEVEL_KEYS = [
  'backing',
  'singer1',
  'singer2',
  'both',
  'male',
  'female',
] as const;
export type VocalLevelKey = (typeof VOCAL_LEVEL_KEYS)[number];
export const SINGER_ROLES: readonly SingerRole[] = ['singer1', 'singer2', 'both'];

const clampLevel = (value: unknown): number | undefined => {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  return Math.round(Math.max(0, Math.min(1, value)) * 100) / 100;
};

/** The levels as the server stores them: known keys, each within 0-1 to two decimals. */
export function cleanVocalLevels(levels?: VocalLevels | null): VocalLevels {
  const clean: VocalLevels = {};
  if (!levels) return clean;
  for (const key of VOCAL_LEVEL_KEYS) {
    const level = clampLevel(levels[key]);
    if (level !== undefined) clean[key] = level;
  }
  if (levels.by === 'lines' || levels.by === 'voices') clean.by = levels.by;
  return clean;
}

/** One string per distinct set of levels ('' for none), for comparing and as an effect
 * dependency: two objects that say the same thing give the same key. */
export function vocalLevelsKey(levels?: VocalLevels | null): string {
  const clean = cleanVocalLevels(levels);
  const parts = VOCAL_LEVEL_KEYS.filter((key) => clean[key] !== undefined).map(
    (key) => `${key}=${clean[key]!.toFixed(2)}`
  );
  if (clean.by) parts.push(`by=${clean.by}`);
  return parts.join(',');
}

export const hasVocalLevels = (levels?: VocalLevels | null): boolean =>
  vocalLevelsKey(levels) !== '';

/**
 * The singer parts a song's lines hold, in display order. "both" counts when a line is sung
 * together or lines of two singers overlap, which the mix also treats as sung together.
 */
export function singerPartsInLines(lines: readonly LyricLine[]): SingerRole[] {
  const found = new Set<SingerRole>();
  const latestEnd: Partial<Record<SingerRole, number>> = {};
  const ordered = [...lines]
    .filter((line) => line.end_time > line.start_time)
    .sort((a, b) => a.start_time - b.start_time);
  for (const line of ordered) {
    const singer = normalizeSingerRole(line.singer);
    found.add(singer);
    if (singer !== 'both') {
      const other: SingerRole = singer === 'singer1' ? 'singer2' : 'singer1';
      if ((latestEnd[other] ?? -Infinity) > line.start_time) found.add('both');
    }
    latestEnd[singer] = Math.max(latestEnd[singer] ?? -Infinity, line.end_time);
  }
  return SINGER_ROLES.filter((role) => found.has(role));
}

/** Levels that divide the lead by singer, every part starting at the guide vocal's level
 * unless it already has one, so that switching the mode changes nothing to hear. */
export function divideBySinger(
  levels: VocalLevels,
  parts: readonly SingerRole[],
  guideVolume: number
): VocalLevels {
  const next: VocalLevels = { ...levels, by: 'lines' };
  for (const part of parts) next[part] = levels[part] ?? clampLevel(guideVolume) ?? 0;
  return cleanVocalLevels(next);
}

/** Levels that divide the lead into its male and female voice, each starting at the guide
 * vocal's level unless it already has one. */
export function divideByVoice(levels: VocalLevels, guideVolume: number): VocalLevels {
  const start = clampLevel(guideVolume) ?? 0;
  return cleanVocalLevels({
    ...levels,
    by: 'voices',
    male: levels.male ?? start,
    female: levels.female ?? start,
  });
}

/** Levels with the lead as one voice again; the singers' levels are kept for next time. */
export function undivide(levels: VocalLevels): VocalLevels {
  const { by: _by, ...rest } = levels;
  return cleanVocalLevels(rest);
}
