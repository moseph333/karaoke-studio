/**
 * Switching stage looks
 *
 * Picking another look in the Look panel changes the stage's type, layout and colours.
 * Colours the user set by hand belong to the look they were picked on: they do not follow to
 * another look, and they are there again on returning to theirs.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { STAGE_LOOKS, getStageLook } from '../../theme/stageLooks';

const root = document.documentElement;
const marquee = getStageLook('marquee');

describe('switching stage looks', () => {
  it('keeps hand-picked colours with the look they were picked on', () => {
    const { result } = renderHook(() => useVisualTheme(marquee));
    act(() => {
      result.current.setCustomSungColor('#ff0055');
      result.current.setCustomUnsungColor('#00ffcc');
    });

    for (const next of STAGE_LOOKS.filter((look) => look.id !== 'marquee')) {
      act(() => result.current.setSelectedTheme(next));
      expect(result.current.selectedTheme.id).toBe(next.id);
      // Another look shows its own colours, and nothing counts as chosen there
      expect(result.current.activeSungColor, next.id).toBe(next.palette.sung);
      expect(result.current.activeUnsungColor, next.id).toBe(next.palette.unsung);
      expect(result.current.customSungColor, next.id).toBeNull();
      expect(result.current.customUnsungColor, next.id).toBeNull();

      // ...and the picks are there again on the look they were made on
      act(() => result.current.setSelectedTheme(marquee));
      expect(result.current.activeSungColor, next.id).toBe('#ff0055');
      expect(result.current.activeUnsungColor, next.id).toBe('#00ffcc');
      expect(result.current.customSungColor, next.id).toBe('#ff0055');
    }
  });

  it("leaves a colour that was not set as the look's own", () => {
    const { result } = renderHook(() => useVisualTheme(marquee));
    act(() => result.current.setCustomSungColor('#ff0055'));

    expect(result.current.activeSungColor).toBe('#ff0055');
    expect(result.current.activeUnsungColor).toBe(marquee.palette.unsung);
    // Only the colour that was picked counts as chosen (and is sent with an export)
    expect(result.current.customSungColor).toBe('#ff0055');
    expect(result.current.customUnsungColor).toBeNull();
    expect(result.current.customSinger2Color).toBeNull();
    expect(result.current.customBothColor).toBeNull();
  });

  it('returns to the current look colours on reset, leaving other looks their picks', () => {
    const { result } = renderHook(() => useVisualTheme(marquee));
    act(() => result.current.setCustomSungColor('#ff0055'));
    act(() => result.current.setSelectedTheme(getStageLook('songbook')));
    act(() => result.current.setCustomSungColor('#123456'));
    expect(result.current.activeSungColor).toBe('#123456');

    act(() => result.current.resetThemeDefaults());

    expect(result.current.selectedTheme.id).toBe('songbook');
    expect(result.current.customSungColor).toBeNull();
    expect(result.current.activeSungColor).toBe(getStageLook('songbook').palette.sung);
    expect(result.current.activeUnsungColor).toBe(getStageLook('songbook').palette.unsung);

    act(() => result.current.setSelectedTheme(marquee));
    expect(result.current.activeSungColor).toBe('#ff0055');
  });

  it('stays consistent through fifty quick switches', () => {
    const { result } = renderHook(() => useVisualTheme(marquee));
    act(() => result.current.setCustomSungColor('#abcdef'));

    let last = marquee;
    for (let i = 0; i < 50; i++) {
      last = STAGE_LOOKS[i % STAGE_LOOKS.length];
      act(() => result.current.setSelectedTheme(last));
    }

    // 50 switches over five looks end on the fifth, not on the one with the pick
    expect(last.id).not.toBe('marquee');
    expect(result.current.selectedTheme.id).toBe(last.id);
    expect(result.current.activeSungColor).toBe(last.palette.sung);
    expect(result.current.activeUnsungColor).toBe(last.palette.unsung);
    expect(root.getAttribute('data-stage-look')).toBe(last.id);

    act(() => result.current.setSelectedTheme(marquee));
    expect(result.current.activeSungColor).toBe('#abcdef');
  });
});
