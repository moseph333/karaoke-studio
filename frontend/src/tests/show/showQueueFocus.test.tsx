/**
 * Moving a singer with the keyboard: the button that was pressed keeps the focus as its row
 * moves, a move that cannot be made (the first singer up, the last one down) is still a
 * button the focus can rest on, and the new place is said aloud.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { ToastProvider } from '../../hooks/useToast';
import {
  SHOW_QUEUE_STORAGE_KEY,
  SHOW_SAVED_AT_STORAGE_KEY,
  type ShowQueue,
} from '../../utils/showQueue';
import { ordinal } from '../../utils/format';

const entry = (id: string, singer: string): ShowQueue[number] => ({
  id,
  singer,
  status: 'waiting',
  source: { kind: 'library', projectId: 'demo', title: 'Neon Skyline', artist: 'The Static' },
});

beforeEach(() => {
  localStorage.setItem(
    SHOW_QUEUE_STORAGE_KEY,
    JSON.stringify([entry('a', 'Alex'), entry('b', 'Bo'), entry('c', 'Cy')])
  );
  localStorage.setItem(SHOW_SAVED_AT_STORAGE_KEY, String(Date.now()));
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
  );
});

afterEach(() => vi.unstubAllGlobals());

function openHost() {
  const view = render(
    <ToastProvider>
      <ShowScreen />
    </ToastProvider>
  );
  return within(view.container);
}

type Host = ReturnType<typeof openHost>;

const order = (host: Host) =>
  host.queryAllByTestId('show-queue-row').map((row) => row.textContent?.match(/Alex|Bo|Cy/)?.[0]);
const button = (host: Host, name: string) => host.getByRole('button', { name });
/** Presses a button as the keyboard does: it has the focus, then it is activated. */
function press(host: Host, name: string) {
  const target = button(host, name);
  target.focus();
  fireEvent.click(target);
}
const said = (host: Host) => host.getByTestId('show-queue-said').textContent;

describe('the focus when a singer is moved', () => {
  it('stays on "Move down" as the row moves down', () => {
    const host = openHost();

    press(host, 'Move Alex down');

    expect(order(host)).toEqual(['Bo', 'Alex', 'Cy']);
    expect(document.activeElement).toBe(button(host, 'Move Alex down'));
  });

  it('stays on "Move up" as the row moves up', () => {
    const host = openHost();

    press(host, 'Move Cy up');

    expect(order(host)).toEqual(['Alex', 'Cy', 'Bo']);
    expect(document.activeElement).toBe(button(host, 'Move Cy up'));
  });

  it('stays there when the singer reaches the head of the line, so the keyboard is not lost', () => {
    const host = openHost();
    press(host, 'Move Cy up');

    press(host, 'Move Cy up');

    expect(order(host)).toEqual(['Cy', 'Alex', 'Bo']);
    const up = button(host, 'Move Cy up');
    expect(document.activeElement).toBe(up);
    // It can go no further, and says so without leaving the keyboard's reach
    expect(up).toHaveAttribute('aria-disabled', 'true');
    expect(up).not.toBeDisabled();
  });

  it('stays there when the singer reaches the end of the line', () => {
    const host = openHost();
    press(host, 'Move Alex down');

    press(host, 'Move Alex down');

    const down = button(host, 'Move Alex down');
    expect(document.activeElement).toBe(down);
    expect(down).toHaveAttribute('aria-disabled', 'true');
  });
});

describe('a move that cannot be made', () => {
  it('does nothing when pressed', () => {
    const host = openHost();

    press(host, 'Move Alex up');
    press(host, 'Move Cy down');

    expect(order(host)).toEqual(['Alex', 'Bo', 'Cy']);
  });

  it('is marked only at the ends of the line', () => {
    const host = openHost();

    expect(button(host, 'Move Alex up')).toHaveAttribute('aria-disabled', 'true');
    expect(button(host, 'Move Cy down')).toHaveAttribute('aria-disabled', 'true');
    for (const name of ['Move Alex down', 'Move Bo up', 'Move Bo down', 'Move Cy up']) {
      expect(button(host, name)).not.toHaveAttribute('aria-disabled', 'true');
    }
  });
});

describe('where a moved singer now stands', () => {
  it('is said aloud', () => {
    const host = openHost();
    expect(said(host)).toBe('');

    press(host, 'Move Cy up');
    expect(said(host)).toBe('Cy is now 2nd of 3');

    press(host, 'Move Cy up');
    expect(said(host)).toBe('Cy is now 1st of 3');
  });

  it('is said politely, in a region of its own that sighted hosts do not see', () => {
    const host = openHost();

    const region = host.getByTestId('show-queue-said');
    expect(region).toHaveAttribute('role', 'status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveClass('sr-only');
  });

  it('is not said for a move that was not made', () => {
    const host = openHost();

    press(host, 'Move Alex up');

    expect(said(host)).toBe('');
  });

  it('is counted as 1st, 2nd, 3rd, 4th, and so on', () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 23, 101, 111].map(ordinal)).toEqual([
      '1st',
      '2nd',
      '3rd',
      '4th',
      '11th',
      '12th',
      '13th',
      '21st',
      '22nd',
      '23rd',
      '101st',
      '111th',
    ]);
  });
});
