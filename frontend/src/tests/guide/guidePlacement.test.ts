/**
 * Where the guide's dim, ring and callout go: sums on boxes, with no page to measure.
 */
import { describe, it, expect } from 'vitest';
import {
  CALLOUT_GAP,
  RING_GAP,
  SCREEN_MARGIN,
  dimRects,
  dockEdge,
  holeFor,
  intersect,
  placeCallout,
  scrollIntoBand,
  type Box,
} from '../../utils/guidePlacement';

const view = { width: 1280, height: 800 };
const area = (box: Box) => (box.right - box.left) * (box.bottom - box.top);

describe('the hole in the dim', () => {
  it('stands the ring off the control', () => {
    expect(holeFor({ left: 100, top: 200, right: 300, bottom: 240 }, view)).toEqual({
      left: 100 - RING_GAP,
      top: 200 - RING_GAP,
      right: 300 + RING_GAP,
      bottom: 240 + RING_GAP,
    });
  });

  it('stays on screen for a control that runs off it', () => {
    expect(holeFor({ left: -50, top: 700, right: 400, bottom: 1200 }, view)).toEqual({
      left: 0,
      top: 700 - RING_GAP,
      right: 400 + RING_GAP,
      bottom: 800,
    });
  });

  it('is nothing when the control is out of view', () => {
    expect(holeFor(null, view)).toBeNull();
    expect(holeFor({ left: 0, top: 900, right: 100, bottom: 950 }, view)).toBeNull();
  });

  it('shares only what two boxes have in common', () => {
    const a = { left: 0, top: 0, right: 100, bottom: 100 };
    expect(intersect(a, { left: 50, top: 60, right: 200, bottom: 200 })).toEqual({
      left: 50,
      top: 60,
      right: 100,
      bottom: 100,
    });
    expect(intersect(a, { left: 100, top: 0, right: 200, bottom: 100 })).toBeNull();
  });
});

describe('the dim', () => {
  it('covers the whole screen except the hole, without overlapping', () => {
    const hole = { left: 300, top: 200, right: 700, bottom: 320 };
    const rects = dimRects(hole, view);
    expect(rects).toHaveLength(4);
    expect(rects.reduce((sum, r) => sum + area(r), 0)).toBe(
      area({ ...hole, left: 0, top: 0, right: 1280, bottom: 800 }) - area(hole)
    );
    for (const rect of rects) expect(intersect(rect, hole)).toBeNull();
    for (const [i, a] of rects.entries()) {
      for (const b of rects.slice(i + 1)) expect(intersect(a, b)).toBeNull();
    }
  });

  it('leaves out the sides a hole at the edge has no room for', () => {
    const rects = dimRects({ left: 0, top: 0, right: 1280, bottom: 60 }, view);
    expect(rects).toEqual([{ left: 0, top: 60, right: 1280, bottom: 800 }]);
  });

  it('covers everything when there is nothing to point at', () => {
    expect(dimRects(null, view)).toEqual([{ left: 0, top: 0, right: 1280, bottom: 800 }]);
  });
});

describe('the callout on a wide screen', () => {
  const callout = { width: 360, height: 200 };

  it('goes under the control, lined up with its leading edge', () => {
    const hole = { left: 400, top: 100, right: 600, bottom: 140 };
    expect(placeCallout(hole, callout, view)).toEqual({
      left: 400,
      top: 140 + CALLOUT_GAP,
      side: 'below',
    });
  });

  it('goes over a control near the bottom', () => {
    const hole = { left: 400, top: 700, right: 600, bottom: 760 };
    expect(placeCallout(hole, callout, view)).toEqual({
      left: 400,
      top: 700 - CALLOUT_GAP - 200,
      side: 'above',
    });
  });

  it('goes beside a control as tall as the screen', () => {
    const tall = { left: 900, top: 60, right: 1280, bottom: 800 };
    expect(placeCallout(tall, callout, view)).toMatchObject({
      side: 'left',
      left: 900 - CALLOUT_GAP - 360,
    });
    const tallOnLeft = { left: 0, top: 60, right: 400, bottom: 800 };
    expect(placeCallout(tallOnLeft, callout, view)).toMatchObject({
      side: 'right',
      left: 400 + CALLOUT_GAP,
    });
  });

  it('goes inside the bottom of a control that fills the screen', () => {
    const full = { left: 0, top: 60, right: 1280, bottom: 800 };
    const place = placeCallout(full, callout, view);
    expect(place.side).toBe('inside');
    expect(place.top + callout.height).toBeLessThanOrEqual(800 - SCREEN_MARGIN);
    expect(place.left).toBeGreaterThanOrEqual(SCREEN_MARGIN);
  });

  it('never leaves the screen', () => {
    const atRight = { left: 1200, top: 100, right: 1276, bottom: 140 };
    const place = placeCallout(atRight, callout, view);
    expect(place.left + callout.width).toBeLessThanOrEqual(1280 - SCREEN_MARGIN);
    const atLeft = { left: -4, top: 100, right: 60, bottom: 140 };
    expect(placeCallout(atLeft, callout, view).left).toBe(SCREEN_MARGIN);
  });

  it('sits in the middle with nothing to point at', () => {
    expect(placeCallout(null, callout, view)).toEqual({ left: 460, top: 300, side: 'inside' });
  });
});

describe('the callout band on a phone', () => {
  const phone = { width: 375, height: 812 };

  it('keeps away from the control', () => {
    expect(dockEdge({ left: 0, top: 80, right: 375, bottom: 300 }, phone)).toBe('bottom');
    expect(dockEdge({ left: 0, top: 600, right: 375, bottom: 800 }, phone)).toBe('top');
    expect(dockEdge(null, phone)).toBe('bottom');
  });
});

describe('scrolling a control out from under the bars', () => {
  const band = { top: 56, bottom: 700 };

  it('leaves a control that is already clear', () => {
    expect(scrollIntoBand({ left: 0, top: 200, right: 300, bottom: 260 }, band)).toBe(0);
  });

  it('scrolls up for one under the header and down for one under the dock', () => {
    expect(scrollIntoBand({ left: 0, top: 20, right: 300, bottom: 80 }, band)).toBe(
      20 - 56 - SCREEN_MARGIN
    );
    expect(scrollIntoBand({ left: 0, top: 680, right: 300, bottom: 760 }, band)).toBe(
      760 - 700 + SCREEN_MARGIN
    );
  });

  it('lines a control taller than the band up with the band’s top', () => {
    expect(scrollIntoBand({ left: 0, top: 300, right: 300, bottom: 1500 }, band)).toBe(
      300 - 56 - SCREEN_MARGIN
    );
  });
});
