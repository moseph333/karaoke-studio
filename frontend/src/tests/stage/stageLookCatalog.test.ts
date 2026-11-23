/**
 * Stage look catalog
 *
 * The five looks the stage and the exported video are drawn in: each has a solid ground, a
 * tone, lyric colours and typefaces the font table knows. The nine presets the looks replaced
 * still name a look, so a song or a setting from before keeps a stage.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_STAGE_LOOK_ID,
  STAGE_LOOKS,
  getStageLook,
  isLookId,
  legacyLook,
  type LookFrame,
} from '../../theme/stageLooks';
import { STAGE_FACE_IDS, faceMetrics } from '../../theme/stageFontMetrics';

const HEX = /^#[0-9a-f]{6}$/i;

/** The look each replaced preset is nearest to. */
const REPLACED: Record<string, string> = {
  afterglow: 'marquee',
  punk_diy: 'marquee',
  modern_gold: 'ktv',
  classic_ktv: 'ktv',
  cyber_cyan: 'ktv',
  neon_pink: 'ktv',
  tape_70s: 'cinema',
  crt_ktv: 'prompter',
  clean_paper: 'songbook',
};

/** Every face a frame names. */
function frameFaces(frame: LookFrame): string[] {
  return [
    frame.lyric.face,
    frame.next?.face,
    frame.label.face,
    frame.cue.face,
    frame.title.face,
    frame.artist.face,
  ].filter((face): face is string => Boolean(face));
}

describe('stage look catalog', () => {
  it('lists exactly the five looks, starting with the default', () => {
    expect(STAGE_LOOKS.map((look) => look.id)).toEqual([
      'marquee',
      'ktv',
      'songbook',
      'cinema',
      'prompter',
    ]);
    expect(DEFAULT_STAGE_LOOK_ID).toBe('marquee');
    expect(getStageLook(DEFAULT_STAGE_LOOK_ID)).toBe(STAGE_LOOKS[0]);
    for (const look of STAGE_LOOKS) {
      expect(isLookId(look.id), look.id).toBe(true);
      expect(getStageLook(look.id), look.id).toBe(look);
      expect(look.name, look.id).toBeTruthy();
      expect(look.description, look.id).toBeTruthy();
    }
  });

  it('every look has a solid stage ground, a tone and lyric colours', () => {
    for (const look of STAGE_LOOKS) {
      expect(['dark', 'light'], look.id).toContain(look.tone);
      expect(['sung', 'unsung'], look.id).toContain(look.emphasis);
      expect(Object.keys(look.palette).sort(), look.id).toEqual(
        ['both', 'cue', 'ground', 'quiet', 'singer2', 'sung', 'unsung'].sort()
      );
      for (const [name, colour] of Object.entries(look.palette)) {
        expect(colour, `${look.id} ${name}`).toMatch(HEX);
      }
      // What is sung must be told apart from what is not
      expect(look.palette.sung, look.id).not.toBe(look.palette.unsung);
    }
    expect(STAGE_LOOKS.filter((look) => look.tone === 'light').map((look) => look.id)).toEqual([
      'songbook',
    ]);
  });

  it('each look draws in typefaces the font table knows, in both formats', () => {
    for (const look of STAGE_LOOKS) {
      const faces = [
        ...frameFaces(look.frames['16:9']),
        ...frameFaces(look.frames['9:16']),
        look.adlib.face,
        look.romaji.face,
      ].filter((face): face is string => Boolean(face));
      for (const face of faces) {
        expect(STAGE_FACE_IDS, `${look.id} ${face}`).toContain(face);
        expect(faceMetrics(face).css_family, `${look.id} ${face}`).toBeTruthy();
      }
    }
  });

  it('gives each of the nine replaced presets the look nearest it', () => {
    for (const [preset, look] of Object.entries(REPLACED)) {
      expect(getStageLook(preset).id, preset).toBe(look);
      expect(legacyLook(preset)?.look, preset).toBe(look);
      // Only a look's own id counts as one: an old id is never stored as the look
      expect(isLookId(preset), preset).toBe(false);
    }
    expect(legacyLook('marquee')).toBeNull();
    expect(legacyLook('gone')).toBeNull();
    for (const unknown of ['gone', '', null, undefined, 7]) {
      expect(getStageLook(unknown).id).toBe(DEFAULT_STAGE_LOOK_ID);
    }
  });
});
