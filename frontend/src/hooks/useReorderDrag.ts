/**
 * Dragging a row of a list to another place in it
 *
 * A row is picked up by its handle (an element marked `data-drag-handle`) with any pointer,
 * or by the row itself with a mouse or a pen: a finger on the row scrolls the page, and a
 * press on a button in it is the button's. The row follows the pointer, the rows it passes
 * make room, and letting go reports the place it was dropped at. Escape, a cancelled
 * pointer, a window that loses focus and a list that changes under the drag all put the row
 * back. Near the top or the bottom of the window the page scrolls, so a row can be carried
 * further than the screen shows.
 *
 * It is the pointer's way only: a list that uses it keeps buttons that move a row as well.
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type React from 'react';

/** How far the pointer travels before a press is a drag. */
const START_PX = 5;
/** How near the window's edge the pointer is when the page starts to scroll. */
const EDGE_PX = 56;
/** How far the page scrolls in a frame. */
const SCROLL_PX = 14;
const CONTROLS = 'button, a, input, select, textarea, [role="button"]';

export interface RowBox {
  top: number;
  height: number;
}

/**
 * The place a row lands at, `dy` pixels from where it was picked up: it passes a neighbour
 * once its leading edge crosses the neighbour's middle.
 */
export function dropIndex(rows: RowBox[], from: number, dy: number): number {
  const top = rows[from].top + dy;
  const bottom = top + rows[from].height;
  let to = from;
  for (let j = from - 1; j >= 0 && top < rows[j].top + rows[j].height / 2; j--) to = j;
  for (let j = from + 1; j < rows.length && bottom > rows[j].top + rows[j].height / 2; j++) to = j;
  return to;
}

export interface ReorderDragOptions {
  /** The rows' ids, in the order the list shows them. */
  ids: string[];
  /** A row was dropped at another place: `to` is its new index in `ids`. */
  onReorder: (id: string, to: number) => void;
}

interface DragView {
  id: string;
  from: number;
  to: number;
  dy: number;
  height: number;
}

export interface ReorderDrag<T extends HTMLElement> {
  /** Goes on the element whose children are the rows, one child a row. */
  listRef: React.RefObject<T>;
  /** The row being dragged. */
  draggingId: string | null;
  /** What a row needs: the press that picks it up, and where it sits during a drag. */
  rowProps: (
    id: string,
    index: number
  ) => {
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => void;
    style: React.CSSProperties | undefined;
  };
  /** The index a row would have if the dragged row were dropped now; its own otherwise. */
  placeOf: (index: number) => number;
}

function rowStyle(view: DragView | null, index: number): React.CSSProperties | undefined {
  if (!view) return undefined;
  if (index === view.from) return { transform: `translateY(${view.dy}px)` };
  if (index > view.from && index <= view.to) return { transform: `translateY(${-view.height}px)` };
  if (index < view.from && index >= view.to) return { transform: `translateY(${view.height}px)` };
  return undefined;
}

function rowPlace(view: DragView | null, index: number): number {
  if (!view) return index;
  if (index === view.from) return view.to;
  if (index > view.from && index <= view.to) return index - 1;
  if (index < view.from && index >= view.to) return index + 1;
  return index;
}

export function useReorderDrag<T extends HTMLElement>({
  ids,
  onReorder,
}: ReorderDragOptions): ReorderDrag<T> {
  const listRef = useRef<T>(null);
  const [view, setView] = useState<DragView | null>(null);
  /** Ends the press in hand: drops the row (`true`) or puts it back. */
  const end = useRef<(drop: boolean) => void>(() => undefined);
  const pressed = useRef(false);
  const report = useRef(onReorder);
  useLayoutEffect(() => {
    report.current = onReorder;
  });

  const press = useCallback((id: string, from: number, e: React.PointerEvent<HTMLElement>) => {
    if (pressed.current || e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    const onHandle = Boolean(target?.closest('[data-drag-handle]'));
    if (!onHandle && (e.pointerType === 'touch' || target?.closest(CONTROLS))) return;
    const list = listRef.current;
    if (!list) return;
    const rows: RowBox[] = Array.from(list.children, (child) => {
      const box = child.getBoundingClientRect();
      return { top: box.top + window.scrollY, height: box.height };
    });
    if (!rows[from]) return;

    const pointerId = e.pointerId;
    const startY = e.clientY;
    const startScroll = window.scrollY;
    const last = rows[rows.length - 1];
    // The row stays inside its list
    const lowest = rows[0].top - rows[from].top;
    const highest = last.top + last.height - rows[from].top - rows[from].height;
    let y = startY;
    let active = false;
    let to = from;
    let frame = 0;

    const travelled = () => y - startY + window.scrollY - startScroll;

    const update = () => {
      if (!active) {
        if (Math.abs(y - startY) < START_PX) return;
        active = true;
        frame = requestAnimationFrame(scrollAtEdges);
      }
      const dy = Math.min(Math.max(travelled(), lowest), highest);
      to = dropIndex(rows, from, dy);
      setView({ id, from, to, dy, height: rows[from].height });
    };

    const scrollAtEdges = () => {
      const page = document.documentElement;
      const below = page.scrollHeight - window.innerHeight - window.scrollY;
      if (y < EDGE_PX && window.scrollY > 0 && travelled() > lowest) {
        window.scrollBy({ top: -SCROLL_PX, behavior: 'instant' });
      } else if (y > window.innerHeight - EDGE_PX && below > 0 && travelled() < highest) {
        window.scrollBy({ top: SCROLL_PX, behavior: 'instant' });
      }
      frame = requestAnimationFrame(scrollAtEdges);
    };

    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      y = ev.clientY;
      update();
    };
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== pointerId) return;
      y = ev.clientY;
      update();
      finish(true);
    };
    const onCancel = (ev: PointerEvent) => {
      if (ev.pointerId === pointerId) finish(false);
    };
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape' || !active) return;
      ev.preventDefault();
      finish(false);
    };
    const onBlur = () => finish(false);

    const finish = (drop: boolean) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('scroll', update);
      window.removeEventListener('blur', onBlur);
      cancelAnimationFrame(frame);
      pressed.current = false;
      end.current = () => undefined;
      if (!active) return;
      setView(null);
      if (drop && to !== from) report.current(id, to);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('scroll', update, { passive: true });
    window.addEventListener('blur', onBlur);
    pressed.current = true;
    end.current = finish;
  }, []);

  // A list that changes under the drag (a singer called, one taken off) no longer has the
  // rows that were measured: the row goes back. So does one whose list is unmounted.
  const order = ids.join('\n');
  useEffect(() => () => end.current(false), [order]);

  const rowProps = useCallback(
    (id: string, index: number) => ({
      onPointerDown: (e: React.PointerEvent<HTMLElement>) => press(id, index, e),
      style: rowStyle(view, index),
    }),
    [press, view]
  );

  const placeOf = useCallback((index: number) => rowPlace(view, index), [view]);

  return { listRef, draggingId: view?.id ?? null, rowProps, placeOf };
}
