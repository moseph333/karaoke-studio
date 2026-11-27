/**
 * Opening the stage window from the studio's stage, and the frame clock a stage window runs
 * on: a live position with no player behind it.
 */

import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { LyricDisplay } from '../../components/LyricDisplay';
import { ToastProvider } from '../../hooks/useToast';
import { useInterpolatedTime } from '../../hooks/useInterpolatedTime';
import {
  STAGE_WINDOW_NAME,
  canOpenStageWindow,
  openStageWindow,
  stageWindowUrl,
} from '../../utils/stageWindowOpen';
import type { LyricLine } from '../../types';

const lines: LyricLine[] = [
  {
    id: 1,
    text: 'hello world',
    start_time: 1,
    end_time: 3,
    words: [
      { word: 'hello', start_time: 1, end_time: 2 },
      { word: 'world', start_time: 2, end_time: 3 },
    ],
  },
];

/** A window as `window.open` returns it. */
function fakeWindow(href: string) {
  return {
    closed: false,
    focus: vi.fn(),
    moveTo: vi.fn(),
    resizeTo: vi.fn(),
    location: { href, replace: vi.fn() },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (window as { getScreenDetails?: unknown }).getScreenDetails;
});

describe('opening the stage window', () => {
  it('opens the app at ?stage=1 in a window of its own', () => {
    const opened = fakeWindow('http://localhost/?stage=1');
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);

    expect(openStageWindow()).toBe(opened);

    expect(open).toHaveBeenCalledWith(
      '/?stage=1',
      STAGE_WINDOW_NAME,
      expect.stringContaining('popup')
    );
    expect(opened.focus).toHaveBeenCalled();
    expect(stageWindowUrl()).toBe('/?stage=1');
  });

  it('brings an open stage window forward without reloading it', () => {
    const opened = fakeWindow('http://localhost/?stage=1');
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);

    openStageWindow(true);

    expect(open).toHaveBeenCalledWith('', STAGE_WINDOW_NAME, expect.any(String));
    expect(opened.location.replace).not.toHaveBeenCalled();
    expect(opened.focus).toHaveBeenCalled();
  });

  it('loads the stage into a blank window when the one believed open is gone', () => {
    const blank = fakeWindow('about:blank');
    vi.spyOn(window, 'open').mockReturnValue(blank as unknown as Window);

    openStageWindow(true);

    expect(blank.location.replace).toHaveBeenCalledWith('/?stage=1');
  });

  it('reports a blocked popup', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);

    expect(openStageWindow()).toBeNull();
  });

  it('moves the window to the other screen where the browser names the screens', async () => {
    const opened = fakeWindow('http://localhost/?stage=1');
    vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    const laptop = { availLeft: 0, availTop: 0, availWidth: 1440, availHeight: 900 };
    const tv = { availLeft: 1440, availTop: 0, availWidth: 1920, availHeight: 1080 };
    (window as { getScreenDetails?: unknown }).getScreenDetails = vi
      .fn()
      .mockResolvedValue({ screens: [laptop, tv], currentScreen: laptop });

    openStageWindow();
    await act(async () => {});

    expect(opened.moveTo).toHaveBeenCalledWith(1440, 0);
    expect(opened.resizeTo).toHaveBeenCalledWith(1920, 1080);
  });

  it('leaves the window where it opened when the screens may not be read', async () => {
    const opened = fakeWindow('http://localhost/?stage=1');
    vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    (window as { getScreenDetails?: unknown }).getScreenDetails = vi
      .fn()
      .mockRejectedValue(new DOMException('denied', 'NotAllowedError'));

    openStageWindow();
    await act(async () => {});

    expect(opened.moveTo).not.toHaveBeenCalled();
  });

  it('is possible wherever windows can talk to each other', () => {
    expect(canOpenStageWindow()).toBe(true);
  });
});

describe('the stage toolbar button', () => {
  it('opens the stage window', () => {
    const opened = fakeWindow('http://localhost/?stage=1');
    const open = vi.spyOn(window, 'open').mockReturnValue(opened as unknown as Window);
    render(<LyricDisplay lines={lines} currentTime={0} duration={60} />);

    fireEvent.click(screen.getByRole('button', { name: 'Open the stage window' }));

    expect(open).toHaveBeenCalledWith('/?stage=1', STAGE_WINDOW_NAME, expect.any(String));
  });

  it('says so when the browser blocks the window', () => {
    vi.spyOn(window, 'open').mockReturnValue(null);
    render(
      <ToastProvider>
        <LyricDisplay lines={lines} currentTime={0} duration={60} />
      </ToastProvider>
    );

    fireEvent.click(screen.getByRole('button', { name: 'Open the stage window' }));

    expect(screen.getByText(/blocked the stage window/)).toBeInTheDocument();
  });

  it('is left out of the fullscreen stage', () => {
    render(<LyricDisplay lines={lines} currentTime={0} duration={60} />);

    fireEvent.click(screen.getByTestId('stage-fullscreen-toggle'));

    expect(screen.queryByTestId('stage-window-open')).toBeNull();
  });
});

describe('the frame clock with a live position and no player', () => {
  it('follows the live position past the point where it used to stop', () => {
    let frame: FrameRequestCallback | null = null;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      frame = cb;
      return 1;
    });
    let live = 10;

    const { result } = renderHook(() =>
      useInterpolatedTime({ currentTime: 10, isPlaying: true, getLiveTime: () => live })
    );
    // Two seconds on with no new `currentTime`: far past the 350 ms the loop coasts by itself
    live = 12;
    act(() => frame?.(performance.now()));

    expect(result.current).toBeCloseTo(12, 1);
  });
});
