/**
 * Guide anchors: finds the control a guide stop points at. Controls carry a `data-guide`
 * name; some exist twice (one per screen size) or once per lyric line, so the lookup takes
 * the copy that is shown, and of those the one in view.
 */

import { intersect, type Box } from './guidePlacement';

const selectorFor = (name: string) => `[data-guide="${name}"]`;

/** Whether the page is laid out at all. It is not in the test environment, where no
 *  element has a box and "shown" cannot be told from "hidden". */
export function hasLayout(): boolean {
  return document.documentElement.getClientRects().length > 0;
}

function isShown(element: HTMLElement): boolean {
  return (
    element.getClientRects().length > 0 && window.getComputedStyle(element).visibility !== 'hidden'
  );
}

function isInView(element: HTMLElement): boolean {
  const rect = element.getBoundingClientRect();
  const x = rect.left + rect.width / 2;
  const y = rect.top + rect.height / 2;
  return x >= 0 && x <= window.innerWidth && y >= 0 && y <= window.innerHeight;
}

/** The control with this `data-guide` name that is shown, preferring one in view; null when
 *  none is shown. */
export function findAnchor(name: string): HTMLElement | null {
  const all = Array.from(document.querySelectorAll<HTMLElement>(selectorFor(name)));
  if (all.length === 0) return null;
  if (!hasLayout()) return all[0];
  const shown = all.filter(isShown);
  return shown.find(isInView) ?? shown[0] ?? null;
}

/** The first of these names that has a control to point at. */
export function findTarget(anchors: readonly string[]): HTMLElement | null {
  for (const name of anchors) {
    const element = findAnchor(name);
    if (element) return element;
  }
  return null;
}

/** Whether any of these names is on the page at all, shown or not: a control this server or
 *  this song does not have is not rendered. */
export function anchorOnPage(anchors: readonly string[]): boolean {
  return anchors.some((name) => document.querySelector(selectorFor(name)) !== null);
}

const toBox = (rect: DOMRect): Box => ({
  left: rect.left,
  top: rect.top,
  right: rect.right,
  bottom: rect.bottom,
});

/** The part of a control that is not scrolled out of the areas it sits in. */
export function visibleBox(element: HTMLElement): Box | null {
  let box: Box | null = toBox(element.getBoundingClientRect());
  for (let node = element.parentElement; node && box; node = node.parentElement) {
    if (node === document.body || node === document.documentElement) break;
    const style = window.getComputedStyle(node);
    const overflow = `${style.overflow} ${style.overflowX} ${style.overflowY}`;
    if (/(auto|scroll|hidden|clip)/.test(overflow)) {
      box = intersect(box, toBox(node.getBoundingClientRect()));
    }
  }
  return box;
}
