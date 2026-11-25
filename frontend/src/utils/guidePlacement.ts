/**
 * Guide placement: where the pointer's dim, ring and callout go, as plain numbers in
 * viewport pixels. Nothing here reads the page, so the sums can be tested without a layout.
 * The callout follows the tooltip's rule (`components/Tooltip.tsx`): try a side, flip when it
 * does not fit, then clamp to the screen.
 */

export interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface Size {
  width: number;
  height: number;
}

/** How far the ring stands off the control, so it never doubles the control's own outline. */
export const RING_GAP = 4;
/** Between the ring and the callout. */
export const CALLOUT_GAP = 12;
/** Between the callout and the edge of the screen. */
export const SCREEN_MARGIN = 8;
/** Below this width the callout is a band across the top or bottom edge. */
export const DOCKED_BELOW = 640;

/** The part two boxes share, or null when they do not meet. */
export function intersect(a: Box, b: Box): Box | null {
  const box = {
    left: Math.max(a.left, b.left),
    top: Math.max(a.top, b.top),
    right: Math.min(a.right, b.right),
    bottom: Math.min(a.bottom, b.bottom),
  };
  return box.right > box.left && box.bottom > box.top ? box : null;
}

/**
 * The hole in the dim: the part of the control that can be seen, with room for the ring,
 * kept on screen. Null when none of the control is in view.
 */
export function holeFor(visible: Box | null, view: Size): Box | null {
  if (!visible) return null;
  return intersect(
    {
      left: visible.left - RING_GAP,
      top: visible.top - RING_GAP,
      right: visible.right + RING_GAP,
      bottom: visible.bottom + RING_GAP,
    },
    { left: 0, top: 0, right: view.width, bottom: view.height }
  );
}

/** The rectangles that cover the screen except the hole: above, below, left and right. */
export function dimRects(hole: Box | null, view: Size): Box[] {
  if (!hole) return [{ left: 0, top: 0, right: view.width, bottom: view.height }];
  return [
    { left: 0, top: 0, right: view.width, bottom: hole.top },
    { left: 0, top: hole.bottom, right: view.width, bottom: view.height },
    { left: 0, top: hole.top, right: hole.left, bottom: hole.bottom },
    { left: hole.right, top: hole.top, right: view.width, bottom: hole.bottom },
  ].filter((box) => box.right > box.left && box.bottom > box.top);
}

/** Which edge a phone's callout band sits on: away from the control. */
export function dockEdge(hole: Box | null, view: Size): 'top' | 'bottom' {
  if (!hole) return 'bottom';
  return (hole.top + hole.bottom) / 2 > view.height / 2 ? 'top' : 'bottom';
}

export type CalloutSide = 'below' | 'above' | 'right' | 'left' | 'inside';

export interface CalloutPlace {
  left: number;
  top: number;
  side: CalloutSide;
}

const clamp = (value: number, size: number, max: number) =>
  Math.min(Math.max(value, SCREEN_MARGIN), Math.max(SCREEN_MARGIN, max - size - SCREEN_MARGIN));

/**
 * Where the callout goes on a wide screen: under the control, else over it, else beside it,
 * lined up with the control's leading edge. A control that leaves no room on any side (a
 * whole panel) gets the callout inside its bottom edge.
 */
export function placeCallout(hole: Box | null, callout: Size, view: Size): CalloutPlace {
  if (!hole) {
    return {
      left: clamp((view.width - callout.width) / 2, callout.width, view.width),
      top: clamp((view.height - callout.height) / 2, callout.height, view.height),
      side: 'inside',
    };
  }
  const left = clamp(hole.left, callout.width, view.width);
  const top = clamp(hole.top, callout.height, view.height);
  const room = {
    below: view.height - SCREEN_MARGIN - hole.bottom - CALLOUT_GAP,
    above: hole.top - CALLOUT_GAP - SCREEN_MARGIN,
    right: view.width - SCREEN_MARGIN - hole.right - CALLOUT_GAP,
    left: hole.left - CALLOUT_GAP - SCREEN_MARGIN,
  };
  if (room.below >= callout.height) {
    return { left, top: hole.bottom + CALLOUT_GAP, side: 'below' };
  }
  if (room.above >= callout.height) {
    return { left, top: hole.top - CALLOUT_GAP - callout.height, side: 'above' };
  }
  if (room.right >= callout.width) {
    return { left: hole.right + CALLOUT_GAP, top, side: 'right' };
  }
  if (room.left >= callout.width) {
    return { left: hole.left - CALLOUT_GAP - callout.width, top, side: 'left' };
  }
  return {
    left: clamp(hole.left + CALLOUT_GAP, callout.width, view.width),
    top: clamp(hole.bottom - CALLOUT_GAP - callout.height, callout.height, view.height),
    side: 'inside',
  };
}

/**
 * How far the page has to scroll (down is positive) to bring a control into the band between
 * the bars fixed to the top and bottom of the screen. A control taller than the band is
 * lined up with the band's top.
 */
export function scrollIntoBand(target: Box, band: { top: number; bottom: number }): number {
  const margin = SCREEN_MARGIN;
  const fits = target.bottom - target.top <= band.bottom - band.top - margin * 2;
  if (target.top < band.top + margin) return target.top - band.top - margin;
  if (target.bottom > band.bottom - margin) {
    return fits ? target.bottom - band.bottom + margin : target.top - band.top - margin;
  }
  return 0;
}
