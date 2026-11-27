/**
 * Replacing or removing the uploaded stage background tells the server to delete the old
 * file. Its id is kept only in this browser's stage settings, so the server never knew an
 * upload was no longer shown and kept every one.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useVisualTheme } from '../../hooks/useVisualTheme';
import { STAGE_SETTINGS_STORAGE_KEY } from '../../theme/stageSettingsStorage';

const OLD = '0a1b2c3d_first.png';
const NEW = '4e5f6a7b_second.mp4';

describe('the uploaded stage background', () => {
  let deleted: string[];

  beforeEach(() => {
    deleted = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (input: RequestInfo | URL, init?: RequestInit) => {
        if (init?.method === 'DELETE') deleted.push(input.toString());
        return new Response(JSON.stringify({ status: 'ok', deleted: true }));
      }
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('is deleted from the server when another is uploaded in its place', () => {
    const { result } = renderHook(() => useVisualTheme());
    act(() => result.current.setCustomBgId(OLD));
    expect(deleted).toEqual([]); // the first upload replaces nothing

    act(() => result.current.setCustomBgId(NEW));

    expect(deleted).toEqual([`/api/background/${OLD}`]);
    expect(result.current.customBgId).toBe(NEW);
  });

  it('is deleted from the server when it is removed', () => {
    const { result } = renderHook(() => useVisualTheme());
    act(() => result.current.setCustomBgId(OLD));

    act(() => result.current.setCustomBgId(''));

    expect(deleted).toEqual([`/api/background/${OLD}`]);
    expect(result.current.backgroundStyle).toBe('artwork');
  });

  it('is deleted when it came from an earlier visit', () => {
    localStorage.setItem(
      STAGE_SETTINGS_STORAGE_KEY,
      JSON.stringify({ version: 2, backgroundStyle: 'custom', customBgId: OLD })
    );
    const { result } = renderHook(() => useVisualTheme(undefined, { persist: true }));
    expect(result.current.customBgId).toBe(OLD);

    act(() => result.current.setCustomBgId(NEW));

    expect(deleted).toEqual([`/api/background/${OLD}`]);
  });

  it('is left alone by every other stage setting, and by the same upload set again', () => {
    const { result } = renderHook(() => useVisualTheme());
    act(() => result.current.setCustomBgId(OLD));

    act(() => {
      result.current.setBackgroundStyle('aurora');
      result.current.setFontSizeScale(1.2);
      result.current.setCustomBgId(OLD);
    });

    expect(deleted).toEqual([]);
    expect(result.current.customBgId).toBe(OLD);
  });

  it('changes at once even when the server cannot be reached', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useVisualTheme());
    act(() => result.current.setCustomBgId(OLD));

    await act(async () => result.current.setCustomBgId(''));

    expect(result.current.customBgId).toBe('');
  });
});
