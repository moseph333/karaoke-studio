/**
 * Values the studio shares with the backend come from backend/assets/shared, imported as
 * @shared/<name>.json: the stage presets, the singer labels, the confidence thresholds and
 * the upload limit.
 */

import { describe, it, expect } from 'vitest';
import stagePresets from '@shared/stage_presets.json';
import singerAliases from '@shared/singer_aliases.json';
import thresholds from '@shared/confidence_thresholds.json';
import uploadLimits from '@shared/upload_limits.json';
import { DEFAULT_BOTH_COLOR, DEFAULT_SINGER2_COLOR, THEMES } from '../theme/stagePresets';
import { normalizeSingerRole } from '../components/stage/singers';
import { LOW_CONFIDENCE_THRESHOLD, getLineIssues } from '../utils/timelineReview';
import { HIGH_CONFIDENCE_THRESHOLD } from '../utils/lineRealign';
import { MAX_AUDIO_SIZE, validateAudioFile } from '../components/track-search/LocalAudioUploader';
import { LyricLine } from '../types';

describe('values shared with the backend', () => {
  it('stage presets: every shared preset in order, plus what only the stage shows', () => {
    expect(THEMES.map((theme) => theme.id)).toEqual(stagePresets.presets.map((p) => p.id));
    THEMES.forEach((theme, i) => {
      const shared = stagePresets.presets[i];
      expect(theme).toMatchObject({
        name: shared.name,
        description: shared.description,
        primary_color: shared.primary_color,
        secondary_color: shared.secondary_color,
      });
      expect(theme.fontFamily).toBeTruthy();
      expect(theme.stageBg).toMatch(/^#[0-9a-f]{6}$/i);
    });
    expect(THEMES.find((theme) => theme.id === 'afterglow')).toMatchObject({
      singer2Color: '#f472b6',
      bothColor: '#5eead4',
    });
    expect(THEMES.find((theme) => theme.id === 'modern_gold')).not.toHaveProperty('singer2Color');
    expect([DEFAULT_SINGER2_COLOR, DEFAULT_BOTH_COLOR]).toEqual(['#ff00b3', '#7bfa50']);
  });

  it('singer labels: the stage reads every label the export does', () => {
    for (const [label, role] of Object.entries(singerAliases)) {
      expect(normalizeSingerRole(label)).toBe(role);
    }
    expect(normalizeSingerRole('S2')).toBe('singer2');
    expect(normalizeSingerRole(' together ')).toBe('both');
    expect(normalizeSingerRole('someone else')).toBe('singer1');
    expect(normalizeSingerRole(undefined)).toBe('singer1');
  });

  it('lines labelled "s2" and "partner" are one voice when checking for overlaps', () => {
    // Free-form labels, as older songs and imported lyrics may carry
    const line = (id: number, start: number, singer: string): LyricLine => ({
      id,
      text: 'La la',
      start_time: start,
      end_time: start + 2,
      singer: singer as LyricLine['singer'],
      words: [{ word: 'La', start_time: start, end_time: start + 2 }],
    });
    const kinds = getLineIssues(line(1, 0, 's2'), line(2, 1.5, 'partner')).map((i) => i.kind);
    expect(kinds).toContain('overlap');
  });

  it('confidence thresholds and the upload limit', () => {
    expect([LOW_CONFIDENCE_THRESHOLD, HIGH_CONFIDENCE_THRESHOLD]).toEqual([
      thresholds.low,
      thresholds.high,
    ]);
    expect(MAX_AUDIO_SIZE).toBe(uploadLimits.track_mb * 1024 * 1024);
    const tooBig = new File(['x'], 'song.mp3');
    Object.defineProperty(tooBig, 'size', { value: MAX_AUDIO_SIZE + 1 });
    expect(validateAudioFile(tooBig)).toBe(
      `Audio file exceeds ${uploadLimits.track_mb}MB limit. Please choose a smaller file.`
    );
  });
});
