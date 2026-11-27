/**
 * Dragging a singer's row to another place in a show's queue: by the row with a mouse, by
 * its grip with a finger, what the list shows on the way, and what puts the row back.
 */

import React, { useReducer } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ShowQueueList } from '../../components/show/ShowQueueList';
import { dropIndex } from '../../hooks/useReorderDrag';
import {
  showQueueReducer,
  waitingEntries,
  type ShowQueue,
  type ShowSource,
} from '../../utils/showQueue';

/** Each row's height on the page; the list starts at the top of it. */
const ROW = 60;

const video = (title: string): ShowSource => ({
  kind: 'youtube',
  videoId: 'a3vO3thiYV4',
  title,
  artist: 'Zoom Karaoke',
});
const four: ShowQueue = ['Alex', 'Bo', 'Cy', 'Di'].map((singer) => ({
  id: singer.toLowerCase(),
  singer,
  source: video(`${singer}'s song`),
  status: 'waiting',
}));

const Queue: React.FC = () => {
  const [queue, dispatch] = useReducer(showQueueReducer, four);
  return (
    <ShowQueueList
      waiting={waitingEntries(queue)}
      finished={[]}
      videos={{}}
      busy={false}
      onStart={() => undefined}
      onMove={(id, by) => dispatch({ type: 'move', id, by })}
      onPlace={(id, at) => dispatch({ type: 'place', id, at })}
      onRemove={(id) => dispatch({ type: 'remove', id })}
      onAgain={() => undefined}
      onClearFinished={() => undefined}
    />
  );
};

beforeEach(() => {
  // jsdom lays nothing out: a row is as far down the page as it is down its list
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement
  ) {
    const index = this.parentElement ? Array.from(this.parentElement.children).indexOf(this) : 0;
    return new DOMRect(0, index * ROW, 600, ROW);
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

const rows = () => screen.getAllByTestId('show-queue-row');
const rowOf = (singer: string) => {
  const row = rows().find((r) => r.textContent?.includes(`${singer}'s song`));
  if (!row) throw new Error(`${singer} is not in the queue`);
  return row;
};
const order = () => rows().map((row) => row.textContent?.match(/Alex|Bo|Cy|Di/)?.[0]);
const numbers = () => rows().map((row) => row.querySelector('[data-drag-handle]')?.textContent);
const shifts = () => rows().map((row) => row.style.transform);
const dragged = () => rows().filter((row) => row.hasAttribute('data-dragging'));

/** The middle of a singer's row, as the pointer's height on the page. */
const middleOf = (singer: string) => rows().indexOf(rowOf(singer)) * ROW + ROW / 2;

interface Press {
  /** What is pressed: the singer's name in the row unless the grip or a button is given. */
  on?: Element;
  pointerType?: 'mouse' | 'touch' | 'pen';
}

function pressRow(singer: string, { on, pointerType = 'mouse' }: Press = {}) {
  const y = middleOf(singer);
  fireEvent.pointerDown(on ?? screen.getByText(singer), {
    pointerId: 1,
    pointerType,
    button: 0,
    clientY: y,
  });
  return {
    moveBy(dy: number) {
      fireEvent.pointerMove(window, { pointerId: 1, pointerType, clientY: y + dy });
    },
    release(dy: number) {
      fireEvent.pointerUp(window, { pointerId: 1, pointerType, clientY: y + dy });
    },
  };
}

const gripOf = (singer: string) => {
  const grip = rowOf(singer).querySelector('[data-drag-handle]');
  if (!grip) throw new Error(`${singer}'s row has no grip`);
  return grip;
};

describe('where a dragged row lands', () => {
  const boxes = [0, 1, 2, 3].map((i) => ({ top: i * ROW, height: ROW }));

  it('stays put until its edge is past the middle of the next row', () => {
    expect(dropIndex(boxes, 1, 0)).toBe(1);
    expect(dropIndex(boxes, 1, 29)).toBe(1);
    expect(dropIndex(boxes, 1, 31)).toBe(2);
    expect(dropIndex(boxes, 1, -29)).toBe(1);
    expect(dropIndex(boxes, 1, -31)).toBe(0);
  });

  it('passes as many rows as it is carried over', () => {
    expect(dropIndex(boxes, 0, 3 * ROW)).toBe(3);
    expect(dropIndex(boxes, 3, -3 * ROW)).toBe(0);
    expect(dropIndex(boxes, 0, 2 * ROW - 31)).toBe(1);
  });

  it('measures rows of different heights by their own middles', () => {
    const uneven = [
      { top: 0, height: 40 },
      { top: 40, height: 120 },
      { top: 160, height: 40 },
    ];
    expect(dropIndex(uneven, 0, 55)).toBe(0);
    expect(dropIndex(uneven, 0, 65)).toBe(1);
    expect(dropIndex(uneven, 2, -55)).toBe(2);
    expect(dropIndex(uneven, 2, -65)).toBe(1);
  });
});

describe('dragging a singer in the queue', () => {
  it('moves a row down to where it is let go', () => {
    render(<Queue />);

    const drag = pressRow('Alex');
    drag.moveBy(2 * ROW);
    drag.release(2 * ROW);

    expect(order()).toEqual(['Bo', 'Cy', 'Alex', 'Di']);
    expect(dragged()).toEqual([]);
    expect(shifts()).toEqual(['', '', '', '']);
  });

  it('moves a row up to where it is let go', () => {
    render(<Queue />);

    const drag = pressRow('Di');
    drag.moveBy(-3 * ROW);
    drag.release(-3 * ROW);

    expect(order()).toEqual(['Di', 'Alex', 'Bo', 'Cy']);
  });

  it('carries the row with the pointer while the rows it passes make room', () => {
    render(<Queue />);

    const drag = pressRow('Alex');
    drag.moveBy(2 * ROW);

    expect(dragged()).toEqual([rowOf('Alex')]);
    expect(shifts()).toEqual([
      `translateY(${2 * ROW}px)`,
      `translateY(${-ROW}px)`,
      `translateY(${-ROW}px)`,
      '',
    ]);
    // The list is still in its old order; the numbers already say where everyone will be
    expect(order()).toEqual(['Alex', 'Bo', 'Cy', 'Di']);
    expect(numbers()).toEqual(['3', '1', '2', '4']);
    drag.release(2 * ROW);
    expect(numbers()).toEqual(['1', '2', '3', '4']);
  });

  it('keeps the row inside the queue however far the pointer goes', () => {
    render(<Queue />);

    const drag = pressRow('Bo');
    drag.moveBy(-900);
    expect(rowOf('Bo').style.transform).toBe(`translateY(${-ROW}px)`);
    drag.moveBy(900);
    expect(rowOf('Bo').style.transform).toBe(`translateY(${2 * ROW}px)`);
    drag.release(900);

    expect(order()).toEqual(['Alex', 'Cy', 'Di', 'Bo']);
  });

  it('leaves the queue alone when the row is let go where it was', () => {
    render(<Queue />);

    const drag = pressRow('Bo');
    drag.moveBy(ROW);
    drag.moveBy(10);
    drag.release(10);

    expect(order()).toEqual(['Alex', 'Bo', 'Cy', 'Di']);
    expect(dragged()).toEqual([]);
  });

  it('takes a press that hardly moves as a click, not a drag', () => {
    render(<Queue />);

    const drag = pressRow('Bo');
    drag.moveBy(3);
    expect(dragged()).toEqual([]);
    drag.release(3);

    expect(order()).toEqual(['Alex', 'Bo', 'Cy', 'Di']);
  });

  it('puts the row back on Escape', () => {
    render(<Queue />);

    const drag = pressRow('Alex');
    drag.moveBy(2 * ROW);
    fireEvent.keyDown(window, { key: 'Escape' });

    expect(dragged()).toEqual([]);
    expect(shifts()).toEqual(['', '', '', '']);
    drag.release(2 * ROW);
    expect(order()).toEqual(['Alex', 'Bo', 'Cy', 'Di']);
  });

  it('puts the row back when the pointer is cancelled', () => {
    render(<Queue />);

    const drag = pressRow('Alex', { on: gripOf('Alex'), pointerType: 'touch' });
    drag.moveBy(2 * ROW);
    fireEvent.pointerCancel(window, { pointerId: 1 });

    expect(dragged()).toEqual([]);
    expect(order()).toEqual(['Alex', 'Bo', 'Cy', 'Di']);
  });

  it('follows one pointer and ignores another', () => {
    render(<Queue />);

    const drag = pressRow('Alex');
    drag.moveBy(ROW);
    fireEvent.pointerMove(window, { pointerId: 2, clientY: 500 });
    fireEvent.pointerUp(window, { pointerId: 2, clientY: 500 });

    expect(dragged()).toEqual([rowOf('Alex')]);
    drag.release(ROW);
    expect(order()).toEqual(['Bo', 'Alex', 'Cy', 'Di']);
  });
});

describe('what picks a row up', () => {
  it('is the grip under a finger, since a finger on the row scrolls the page', () => {
    render(<Queue />);

    const onRow = pressRow('Alex', { pointerType: 'touch' });
    onRow.moveBy(2 * ROW);
    expect(dragged()).toEqual([]);
    onRow.release(2 * ROW);
    expect(order()).toEqual(['Alex', 'Bo', 'Cy', 'Di']);

    const onGrip = pressRow('Alex', { on: gripOf('Alex'), pointerType: 'touch' });
    onGrip.moveBy(2 * ROW);
    onGrip.release(2 * ROW);
    expect(order()).toEqual(['Bo', 'Cy', 'Alex', 'Di']);
  });

  it('is never one of the row’s buttons', () => {
    render(<Queue />);

    const drag = pressRow('Bo', { on: screen.getByRole('button', { name: 'Start Bo' }) });
    drag.moveBy(2 * ROW);
    expect(dragged()).toEqual([]);
    drag.release(2 * ROW);

    expect(order()).toEqual(['Alex', 'Bo', 'Cy', 'Di']);
  });

  it('is the left mouse button only', () => {
    render(<Queue />);

    fireEvent.pointerDown(screen.getByText('Alex'), { pointerId: 1, button: 2, clientY: 30 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 30 + 2 * ROW });

    expect(dragged()).toEqual([]);
  });

  it('leaves the arrow buttons working beside it', () => {
    render(<Queue />);

    fireEvent.click(screen.getByRole('button', { name: 'Move Di up' }));

    expect(order()).toEqual(['Alex', 'Bo', 'Di', 'Cy']);
  });
});

describe('a queue that changes during a drag', () => {
  it('puts the row back rather than drop it among rows that moved', () => {
    render(<Queue />);

    const drag = pressRow('Alex');
    drag.moveBy(2 * ROW);
    fireEvent.click(screen.getByRole('button', { name: 'Take Cy off the queue' }));

    expect(dragged()).toEqual([]);
    expect(order()).toEqual(['Alex', 'Bo', 'Di']);
    drag.release(2 * ROW);
    expect(order()).toEqual(['Alex', 'Bo', 'Di']);
  });
});
