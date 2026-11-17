/**
 * The screen stays on while a song plays: a wake lock is held during playback, given back
 * on pause, and taken again when the page returns from the background.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useScreenWakeLock } from '../../hooks/useScreenWakeLock';

interface FakeLock {
  released: boolean;
  release: () => Promise<void>;
}

let locks: FakeLock[];
let request: ReturnType<typeof vi.fn>;
let visibility: DocumentVisibilityState;

function installWakeLock() {
  request = vi.fn().mockImplementation(async () => {
    const lock: FakeLock = {
      released: false,
      release: vi.fn().mockImplementation(async () => {
        lock.released = true;
      }),
    };
    locks.push(lock);
    return lock;
  });
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request } });
}

async function setVisibility(state: DocumentVisibilityState) {
  visibility = state;
  await act(async () => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

const flush = () => act(async () => {});

describe('useScreenWakeLock', () => {
  beforeEach(() => {
    locks = [];
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () => visibility,
    });
    installWakeLock();
  });

  afterEach(() => {
    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  it('holds a screen lock while playing and releases it on pause', async () => {
    const { rerender } = renderHook(({ playing }) => useScreenWakeLock(playing), {
      initialProps: { playing: false },
    });
    await flush();
    expect(request).not.toHaveBeenCalled();

    rerender({ playing: true });
    await flush();
    expect(request).toHaveBeenCalledWith('screen');
    expect(locks).toHaveLength(1);
    expect(locks[0].released).toBe(false);

    rerender({ playing: false });
    await flush();
    expect(locks[0].released).toBe(true);
  });

  it('takes the lock again when the page comes back mid-song', async () => {
    renderHook(() => useScreenWakeLock(true));
    await flush();
    // The browser drops the lock when the page is hidden
    locks[0].released = true;
    await setVisibility('hidden');
    expect(request).toHaveBeenCalledTimes(1);

    await setVisibility('visible');
    expect(request).toHaveBeenCalledTimes(2);
    expect(locks[1].released).toBe(false);
  });

  it('does not stack locks when the page becomes visible with one still held', async () => {
    renderHook(() => useScreenWakeLock(true));
    await flush();
    await setVisibility('visible');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('releases a lock that arrives after playback already stopped', async () => {
    const { unmount } = renderHook(() => useScreenWakeLock(true));
    unmount(); // before the request resolves
    await flush();
    expect(locks).toHaveLength(1);
    expect(locks[0].released).toBe(true);
  });

  it('plays on when the browser refuses the lock or has no such API', async () => {
    request.mockRejectedValueOnce(new DOMException('denied', 'NotAllowedError'));
    const refused = renderHook(() => useScreenWakeLock(true));
    await flush();
    refused.unmount();

    delete (navigator as unknown as Record<string, unknown>).wakeLock;
    expect(() => renderHook(() => useScreenWakeLock(true))).not.toThrow();
  });
});
