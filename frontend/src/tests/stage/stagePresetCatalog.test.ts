/**
 * Stage preset catalog
 *
 * Every preset the stage can show has a font, lyric colours and a solid backdrop. The fonts
 * and colours are the ones the exported video uses (backend/services/ass_generator.py), so
 * the preview and the render look alike.
 */

import { describe, it, expect } from 'vitest';
import { THEMES } from '../../components/VisualThemePicker';

const EXPECTED: Record<string, { font: string; sung: string; unsung: string }> = {
  afterglow: { font: "'Sora', 'Inter', sans-serif", sung: '#fbbf24', unsung: '#edebff' },
  modern_gold: { font: 'Montserrat, sans-serif', sung: '#fbbf24', unsung: '#ffffff' },
  cyber_cyan: { font: 'Montserrat, sans-serif', sung: '#06b6d4', unsung: '#ffffff' },
  neon_pink: { font: 'Montserrat, sans-serif', sung: '#ec4899', unsung: '#ffffff' },
  classic_ktv: { font: 'Montserrat, sans-serif', sung: '#facc15', unsung: '#ffffff' },
  punk_diy: { font: "'Impact', 'Arial Black', sans-serif", sung: '#facc15', unsung: '#f5f5f5' },
  tape_70s: { font: "'Georgia', serif", sung: '#f59e0b', unsung: '#fef3c7' },
  crt_ktv: { font: "'VT323', monospace", sung: '#22c55e', unsung: '#86efac' },
  clean_paper: {
    font: "'Space Grotesk', 'Helvetica Neue', sans-serif",
    sung: '#dc2626',
    unsung: '#111111',
  },
};

describe('stage preset catalog', () => {
  it('lists exactly the presets with a known look', () => {
    expect(THEMES.map((preset) => preset.id).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it('every preset has a solid stage background and a tone', () => {
    for (const preset of THEMES) {
      expect(preset.stageBg, preset.id).toMatch(/^#[0-9a-f]{6}$/i);
      expect(['dark', 'light'], preset.id).toContain(preset.tone);
    }
  });

  it('each preset keeps the font and lyric colours of its exported video', () => {
    for (const preset of THEMES) {
      const expected = EXPECTED[preset.id];
      expect(preset.fontFamily, preset.id).toBe(expected.font);
      expect(preset.previewSung.toLowerCase(), preset.id).toBe(expected.sung);
      expect(preset.previewUnsung.toLowerCase(), preset.id).toBe(expected.unsung);
    }
  });
});
