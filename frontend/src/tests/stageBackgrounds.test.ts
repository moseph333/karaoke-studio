/**
 * Stage background maths shared with the video renderer: drift and orb motion as functions of
 * song time, the overscan sizes, the gradients, the palette and the lyric outline.
 */

import { describe, it, expect } from 'vitest';
import motion from '../theme/backgroundMotion.json';
import {
  AURORA_ORB_COUNT,
  DEFAULT_BACKGROUND_ACCENTS,
  STAGE_BACKGROUND_OPTIONS,
  driftLayer,
  driftOffset,
  hexToRgb,
  isGeneratedStyle,
  isStageBackgroundStyle,
  lyricOutline,
  orbCentre,
  orbGradient,
  orbSize,
  overscanSize,
  scrimGradient,
  stageBackgroundPalette,
} from '../theme/stageBackgrounds';
import { THEMES, getStageBackground } from '../theme/stagePresets';

describe('drifting art', () => {
  it('uses the same even overscan sizes as the renderer', () => {
    expect(overscanSize(1920, 1080)).toEqual([2150, 1210]);
    expect(overscanSize(1080, 1920)).toEqual([1210, 2150]);
  });

  it('follows the slow Lissajous path the export crop follows', () => {
    expect(driftOffset(0).x).toBeCloseTo(0, 10);
    expect(driftOffset(0).y).toBeCloseTo(Math.sin(motion.drift.phaseY), 10);
    expect(driftOffset(10).x).toBeCloseTo(driftOffset(10 + motion.drift.periodX).x, 10);
    expect(driftOffset(10).y).toBeCloseTo(driftOffset(10 + motion.drift.periodY).y, 10);
  });

  it('moves the still the distance the export crop window moves the other way', () => {
    const time = 7.3;
    const layer = driftLayer(time, '16:9');
    const kx = 2150 / 1920;
    const ky = 1210 / 1080;
    expect(parseFloat(layer.width)).toBeCloseTo(kx * 100, 3);
    expect(parseFloat(layer.height)).toBeCloseTo(ky * 100, 3);
    expect(parseFloat(layer.left)).toBeCloseTo((-(kx - 1) / 2) * 100, 3);

    // translate3d percentages are of the still itself (kx times the frame width)
    const [tx, ty] = /translate3d\(([-\d.]+)%, ([-\d.]+)%/
      .exec(layer.transform)!
      .slice(1)
      .map(Number);
    const { x, y } = driftOffset(time);
    // On a 1920 px wide frame the content moves -(iw-ow)/2 * sx px, as the crop's x does
    expect(((tx / 100) * kx * 1920).toFixed(2)).toBe(((-(2150 - 1920) / 2) * x).toFixed(2));
    expect(((ty / 100) * ky * 1080).toFixed(2)).toBe(((-(1210 - 1080) / 2) * y).toFixed(2));
  });
});

describe('aurora', () => {
  it('places each orb where the export overlay puts it', () => {
    expect(AURORA_ORB_COUNT).toBe(3);
    motion.aurora.orbs.forEach((orb, i) => {
      const t = 12.5;
      expect(orbCentre(i, t).x).toBeCloseTo(
        orb.x + orb.ax * Math.sin((2 * Math.PI * t) / orb.periodX + orb.phaseX),
        10
      );
      expect(orbCentre(i, t).y).toBeCloseTo(
        orb.y + orb.ay * Math.sin((2 * Math.PI * t) / orb.periodY + orb.phaseY),
        10
      );
    });
  });

  it('sizes orbs by the longer side and fades them like the Gaussian sprite', () => {
    const side = 2 * motion.aurora.extent * motion.aurora.sigma;
    expect(orbSize(1920, 1080)).toBeCloseTo(side * 1920, 6);
    expect(orbSize(1080, 1920)).toBeCloseTo(side * 1920, 6);

    const dark = orbGradient('#fbbf24', 'dark');
    expect(dark.startsWith('radial-gradient(circle closest-side, ')).toBe(true);
    expect(dark).toContain(`rgb(251 191 36 / ${motion.aurora.alpha.dark.toFixed(4)}) 0.0%`);
    expect(dark).toContain('rgb(251 191 36 / 0.0031) 100.0%');
    expect(orbGradient('#dc2626', 'light')).toContain(
      `rgb(220 38 38 / ${motion.aurora.alpha.light.toFixed(4)}) 0.0%`
    );
  });
});

describe('scrim, palette and outline', () => {
  it('draws the export scrim for each tone', () => {
    expect(scrimGradient('dark')).toBe(
      'linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.3), rgb(0 0 0 / 0.1))'
    );
    expect(scrimGradient('light')).toBe(
      'linear-gradient(to top, rgb(255 255 255 / 0.75), rgb(255 255 255 / 0.25), rgb(255 255 255 / 0.05))'
    );
  });

  it('starts from the sung colour and prefers the colours the user picked', () => {
    const afterglow = THEMES.find((t) => t.id === 'afterglow')!;
    const tape = THEMES.find((t) => t.id === 'tape_70s')!;
    expect(stageBackgroundPalette(afterglow, { sung: '#fbbf24' })).toEqual([
      '#fbbf24',
      '#f472b6',
      '#5eead4',
    ]);
    expect(stageBackgroundPalette(tape, { sung: '#f59e0b', singer2: null, both: null })).toEqual([
      '#f59e0b',
      ...tape.backgroundAccents!,
    ]);
    expect(
      stageBackgroundPalette(tape, { sung: '#123456', singer2: '#aa0000', both: '#00aa00' })
    ).toEqual(['#123456', '#aa0000', '#00aa00']);
    expect(
      stageBackgroundPalette({ ...tape, backgroundAccents: undefined }, { sung: '#fff' })
    ).toEqual(['#fff', ...DEFAULT_BACKGROUND_ACCENTS]);
  });

  it('gives every preset accents the spectrum can blend towards', () => {
    // The export lifts dark stages towards the treble colour (lightens light ones), one way
    // per channel, so each curated treble accent sits on the right side of the stage colour.
    for (const theme of THEMES) {
      expect(theme.backgroundAccents, theme.id).toHaveLength(2);
      const base = hexToRgb(getStageBackground(theme));
      const treble = hexToRgb(theme.backgroundAccents![0]);
      treble.forEach((channel, i) => {
        if (theme.tone === 'light') expect(channel, theme.id).toBeLessThanOrEqual(base[i]);
        else expect(channel, theme.id).toBeGreaterThanOrEqual(base[i]);
      });
    }
  });

  it('outlines lyrics the way the export does', () => {
    const dark = lyricOutline('dark').split(', ');
    expect(dark).toHaveLength(8);
    expect(dark[0]).toBe('0.058em 0.000em 0 #111111');
    expect(lyricOutline('light').split(', ')[0]).toBe('0.038em 0.000em 0 #ffffff');
  });
});

describe('style registry', () => {
  it('knows the styles and which ones the renderer generates', () => {
    expect(STAGE_BACKGROUND_OPTIONS.map((o) => o.value)).toEqual([
      'artwork',
      'drift',
      'aurora',
      'spectrum',
      'color',
    ]);
    expect(isStageBackgroundStyle('custom')).toBe(true);
    expect(isStageBackgroundStyle('Aurora')).toBe(false);
    expect(isStageBackgroundStyle(undefined)).toBe(false);
    expect(isGeneratedStyle('aurora')).toBe(true);
    expect(isGeneratedStyle('spectrum')).toBe(true);
    expect(isGeneratedStyle('drift')).toBe(false);
  });
});
