/**
 * Switching stage presets
 *
 * Picking another preset in the Look panel changes the stage's font and colours. Colours the
 * user set by hand stay through every switch until they reset them.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { STAGE_PRESETS_IN_DISPLAY_ORDER, getStagePreset } from '../../theme/stagePresets';

const root = document.documentElement;
const preset = (id: string) => getStagePreset(id)!;

describe('switching stage presets', () => {
  it('keeps hand-picked sung and unsung colours through every preset', () => {
    const { result } = renderHook(() => useVisualTheme(preset('punk_diy')));
    act(() => {
      result.current.setCustomSungColor('#ff0055');
      result.current.setCustomUnsungColor('#00ffcc');
    });

    for (const next of STAGE_PRESETS_IN_DISPLAY_ORDER) {
      act(() => result.current.setSelectedTheme(next));
      expect(result.current.selectedTheme.id).toBe(next.id);
      expect(result.current.activeSungColor, next.id).toBe('#ff0055');
      expect(result.current.activeUnsungColor, next.id).toBe('#00ffcc');
      expect(root.style.getPropertyValue('--karaoke-sung-color')).toBe('#ff0055');
    }
  });

  it('lets a colour that was not set follow the preset', () => {
    const { result } = renderHook(() => useVisualTheme(preset('punk_diy')));
    act(() => result.current.setCustomSungColor('#ff0055'));
    expect(result.current.activeUnsungColor).toBe('#f5f5f5');

    act(() => result.current.setSelectedTheme(preset('tape_70s')));

    expect(result.current.activeSungColor).toBe('#ff0055');
    expect(result.current.activeUnsungColor).toBe('#fef3c7');
    // Only the overridden colour is sent to the export as a custom value
    expect(result.current.effectiveTheme.secondary_color).toBe(preset('tape_70s').secondary_color);
  });

  it('returns to the current preset colours on reset', () => {
    const { result } = renderHook(() => useVisualTheme(preset('punk_diy')));
    act(() => {
      result.current.setCustomSungColor('#ff0055');
      result.current.setSelectedTheme(preset('clean_paper'));
    });

    act(() => result.current.resetThemeDefaults());

    expect(result.current.selectedTheme.id).toBe('clean_paper');
    expect(result.current.activeSungColor).toBe('#dc2626');
    expect(result.current.activeUnsungColor).toBe('#111111');
  });

  it('puts the preset font on the page root', () => {
    const { result } = renderHook(() => useVisualTheme(preset('punk_diy')));
    expect(root.style.getPropertyValue('--karaoke-font-family')).toContain('Impact');

    act(() => result.current.setSelectedTheme(preset('tape_70s')));
    expect(root.style.getPropertyValue('--karaoke-font-family')).toContain('Georgia');

    act(() => result.current.setSelectedTheme(preset('crt_ktv')));
    expect(root.style.getPropertyValue('--karaoke-font-family')).toContain('VT323');

    act(() => result.current.setSelectedTheme(preset('clean_paper')));
    expect(root.style.getPropertyValue('--karaoke-font-family')).toContain('Space Grotesk');
  });

  it('stays consistent through fifty quick switches', () => {
    const { result } = renderHook(() => useVisualTheme(preset('punk_diy')));
    act(() => result.current.setCustomSungColor('#abcdef'));

    let last = preset('punk_diy');
    for (let i = 0; i < 50; i++) {
      last = STAGE_PRESETS_IN_DISPLAY_ORDER[i % STAGE_PRESETS_IN_DISPLAY_ORDER.length];
      act(() => result.current.setSelectedTheme(last));
    }

    expect(result.current.selectedTheme.id).toBe(last.id);
    expect(result.current.activeSungColor).toBe('#abcdef');
    expect(result.current.activeUnsungColor).toBe(last.previewUnsung);
    expect(root.getAttribute('data-stage-preset')).toBe(last.id);
  });
});
