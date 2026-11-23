/**
 * Values the studio shares with the backend come from backend/assets/shared, imported as
 * @shared/<name>.json: the stage looks, the singer labels, the confidence thresholds and
 * the upload limit.
 */

import { describe, it, expect } from 'vitest';
import stageLooks from '@shared/stage_looks.json';
import singerAliases from '@shared/singer_aliases.json';
import thresholds from '@shared/confidence_thresholds.json';
import uploadLimits from '@shared/upload_limits.json';
import {
  DEFAULT_PART_NAMES,
  DEFAULT_STAGE_LOOK_ID,
  LEGACY_LOOK_IDS,
  STAGE_LOOKS,
  getStageLook,
} from '../../theme/stageLooks';
import { normalizeSingerRole } from '../../components/stage/singers';
import { LOW_CONFIDENCE_THRESHOLD, getLineIssues } from '../../utils/timelineReview';
import { HIGH_CONFIDENCE_THRESHOLD } from '../../utils/lineRealign';
import {
  MAX_AUDIO_SIZE,
  validateAudioFile,
} from '../../components/track-search/LocalAudioUploader';
import { LyricLine } from '../../types';

describe('values shared with the backend', () => {
  it('stage looks: every shared look in order, the default, and the presets they replaced', () => {
    expect(STAGE_LOOKS.map((look) => look.id)).toEqual(stageLooks.looks.map((look) => look.id));
    STAGE_LOOKS.forEach((look, i) => {
      const shared = stageLooks.looks[i];
      expect(look).toMatchObject({
        name: shared.name,
        description: shared.description,
        layout: shared.layout,
        tone: shared.tone,
        emphasis: shared.emphasis,
        palette: shared.palette,
      });
      expect(Object.keys(look.frames).sort()).toEqual(['16:9', '9:16']);
    });
    expect(DEFAULT_STAGE_LOOK_ID).toBe(stageLooks.default_look);
    expect(STAGE_LOOKS.map((look) => look.id)).toContain(stageLooks.default_look);
    expect(DEFAULT_PART_NAMES).toEqual(stageLooks.default_part_names);

    // A song or a setting from before the looks names one of the nine presets
    const replaced = Object.entries(stageLooks.legacy_ids);
    expect(replaced).toHaveLength(9);
    expect(Object.keys(LEGACY_LOOK_IDS)).toEqual(replaced.map(([id]) => id));
    for (const [id, entry] of replaced) {
      expect(getStageLook(id).id, id).toBe(entry.look);
      expect(
        STAGE_LOOKS.map((look) => look.id),
        id
      ).toContain(entry.look);
    }
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
