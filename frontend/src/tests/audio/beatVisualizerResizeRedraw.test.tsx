import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render } from '@testing-library/react';
import { BeatVisualizer } from '../../components/BeatVisualizer';

type Ctx = { clearRect: ReturnType<typeof vi.fn> };

describe('BeatVisualizer when its box is resized', () => {
  let resize: () => void;
  let contexts: Ctx[];
  const realResizeObserver = window.ResizeObserver;

  beforeEach(() => {
    contexts = [];
    resize = () => {};
    window.ResizeObserver = class {
      constructor(callback: () => void) {
        resize = callback;
      }
      observe() {}
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;
    const getContext = window.HTMLCanvasElement.prototype.getContext;
    vi.spyOn(window.HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (
      this: HTMLCanvasElement,
      ...args: unknown[]
    ) {
      const ctx = (getContext as (...a: unknown[]) => unknown).apply(this, args);
      contexts.push(ctx as Ctx);
      return ctx as never;
    });
    vi.spyOn(window, 'requestAnimationFrame').mockReturnValue(1);
  });

  afterEach(() => {
    window.ResizeObserver = realResizeObserver;
    vi.restoreAllMocks();
  });

  const framesDrawn = () => contexts.reduce((n, ctx) => n + ctx.clearRect.mock.calls.length, 0);

  // Setting a canvas's width or height erases it, so a paused visualizer that is resized
  // (the stage going fullscreen, the window changing size) must paint its resting bars again
  it('paints the resting bars again while paused', () => {
    render(<BeatVisualizer analyserNode={null} isPlaying={false} />);
    expect(framesDrawn()).toBe(1);

    act(() => resize());

    expect(framesDrawn()).toBe(2);
  });

  it('leaves drawing to the animation loop while playing', () => {
    render(<BeatVisualizer analyserNode={null} isPlaying />);
    const before = framesDrawn();

    act(() => resize());

    expect(framesDrawn()).toBe(before);
    expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1);
  });
});
