/**
 * Stage background maths shared with the video renderer: drift and orb motion as functions of
 * song time, the overscan sizes, the gradients and the palette.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import motion from '@shared/background_motion.json';
import {
  AURORA_ORB_COUNT,
  STAGE_BACKGROUND_OPTIONS,
  driftLayer,
  driftOffset,
  hexToRgb,
  isGeneratedStyle,
  isStageBackgroundStyle,
  orbCentre,
  orbGradient,
  orbSize,
  overscanSize,
  scrimGradient,
} from '../../theme/stageBackgrounds';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { STAGE_LOOKS, getStageLook } from '../../theme/stageLooks';

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

describe('scrim and palette', () => {
  it('draws the export scrim for each tone', () => {
    expect(scrimGradient('dark')).toBe(
      'linear-gradient(to top, rgb(0 0 0 / 0.75), rgb(0 0 0 / 0.3), rgb(0 0 0 / 0.1))'
    );
    expect(scrimGradient('light')).toBe(
      'linear-gradient(to top, rgb(255 255 255 / 0.75), rgb(255 255 255 / 0.25), rgb(255 255 255 / 0.05))'
    );
  });

  it('starts from the sung colour and prefers the colours the user picked', () => {
    const cinema = getStageLook('cinema');
    const { result } = renderHook(() => useVisualTheme(cinema));
    expect(result.current.backgroundPalette).toEqual([
      cinema.palette.sung,
      cinema.palette.singer2,
      cinema.palette.both,
    ]);

    act(() => result.current.setCustomSungColor('#123456'));
    expect(result.current.backgroundPalette).toEqual([
      '#123456',
      cinema.palette.singer2,
      cinema.palette.both,
    ]);

    act(() => {
      result.current.setCustomSinger2Color('#aa0000');
      result.current.setCustomBothColor('#00aa00');
    });
    expect(result.current.backgroundPalette).toEqual(['#123456', '#aa0000', '#00aa00']);

    // Another look glows in its own colours: the picks stay with the look they were made on
    const marquee = getStageLook('marquee');
    act(() => result.current.setSelectedTheme(marquee));
    expect(result.current.backgroundPalette).toEqual([
      marquee.palette.sung,
      marquee.palette.singer2,
      marquee.palette.both,
    ]);
  });

  it('starts from the words still to sing in a look that dims what was sung', () => {
    const prompter = getStageLook('prompter');
    expect(prompter.emphasis).toBe('unsung');
    const { result } = renderHook(() => useVisualTheme(prompter));
    expect(result.current.backgroundPalette).toEqual([
      prompter.palette.unsung,
      prompter.palette.singer2,
      prompter.palette.both,
    ]);

    // The dim colour of the sung words is not what marks the look
    act(() => result.current.setCustomSungColor('#333333'));
    expect(result.current.backgroundPalette[0]).toBe(prompter.palette.unsung);
    act(() => result.current.setCustomUnsungColor('#fff000'));
    expect(result.current.backgroundPalette[0]).toBe('#fff000');
  });

  it('gives every look a treble colour the spectrum can blend towards', () => {
    // The export lifts dark stages towards the treble colour (darkens light ones), one way
    // per channel, so each look's second palette colour (Singer 2's) sits on the right side
    // of its ground.
    for (const look of STAGE_LOOKS) {
      const base = hexToRgb(look.palette.ground);
      const treble = hexToRgb(look.palette.singer2);
      treble.forEach((channel, i) => {
        if (look.tone === 'light') expect(channel, look.id).toBeLessThanOrEqual(base[i]);
        else expect(channel, look.id).toBeGreaterThanOrEqual(base[i]);
      });
    }
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
