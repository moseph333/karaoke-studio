/**
 * Stage settings on the page root
 *
 * The stage look's id and the highlight mode are mirrored onto <html>, so styles outside the
 * stage component can follow them.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { STAGE_LOOKS, getStageLook } from '../../theme/stageLooks';

const root = document.documentElement;

describe('stage settings on the page root', () => {
  it('writes the look and highlight mode, and follows changes', () => {
    const { result } = renderHook(() => useVisualTheme(getStageLook('songbook')));

    expect(root.getAttribute('data-stage-look')).toBe('songbook');
    expect(root.getAttribute('data-sync-mode')).toBe('word');

    act(() => result.current.setSyncMode('line'));

    expect(root.getAttribute('data-sync-mode')).toBe('line');
    expect(root.getAttribute('data-stage-look')).toBe('songbook');
  });

  it('names the new look when another one is picked', () => {
    const { result } = renderHook(() => useVisualTheme(STAGE_LOOKS[0]));
    const other = STAGE_LOOKS.find((look) => look.id !== STAGE_LOOKS[0].id)!;

    act(() => result.current.setSelectedTheme(other));

    expect(root.getAttribute('data-stage-look')).toBe(other.id);
  });
});
