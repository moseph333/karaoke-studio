/**
 * Stage settings on the page root
 *
 * The stage look is mirrored onto <html> (the preset id, the highlight mode and the lyric
 * size and colours as CSS variables), so styles outside the stage component can follow it.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { THEMES } from '../../components/VisualThemePicker';

const root = document.documentElement;

describe('stage settings on the page root', () => {
  it('writes the preset, highlight mode and lyric size, and follows changes', () => {
    const paper = THEMES.find((preset) => preset.id === 'clean_paper')!;
    const { result } = renderHook(() => useVisualTheme(paper));

    expect(root.getAttribute('data-stage-preset')).toBe('clean_paper');
    expect(root.getAttribute('data-sync-mode')).toBe('word');
    expect(root.style.getPropertyValue('--karaoke-font-scale')).toBe('1');

    act(() => {
      result.current.setFontSizeScale(1.5);
      result.current.setSyncMode('line');
      result.current.setCustomSungColor('#ff1122');
    });

    expect(root.getAttribute('data-sync-mode')).toBe('line');
    expect(root.style.getPropertyValue('--karaoke-font-scale')).toBe('1.5');
    expect(root.style.getPropertyValue('--karaoke-sung-color')).toBe('#ff1122');
  });

  it('names the new preset when another one is picked', () => {
    const { result } = renderHook(() => useVisualTheme(THEMES[0]));
    const other = THEMES.find((preset) => preset.id !== THEMES[0].id)!;

    act(() => result.current.setSelectedTheme(other));

    expect(root.getAttribute('data-stage-preset')).toBe(other.id);
  });
});
