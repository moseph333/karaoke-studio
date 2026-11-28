/**
 * A new night: the queue outlasts the night it was made on, so the host screen says when the
 * one it opened with is from another day and offers to start again with an empty one. "Start
 * a new night" is also under the queue at any time, and asks first, as "Clear the list" does.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import { StageWindow } from '../../components/stage-window/StageWindow';
import { ToastProvider } from '../../hooks/useToast';
import {
  OLD_QUEUE_MS,
  SHOW_QUEUE_STORAGE_KEY,
  SHOW_SAVED_AT_STORAGE_KEY,
  SHOW_TITLE_STORAGE_KEY,
  isOldQueue,
  loadShowSavedAt,
  saveShowQueue,
  showQueueReducer,
  type ShowQueue,
} from '../../utils/showQueue';
import { loadShowResume, saveShowResume } from '../../utils/showResume';
import { installFakeYouTube, removeFakeYouTube } from '../helpers/fakeYouTube';

const HOUR = 60 * 60 * 1000;
// A Thursday evening
const THEN = new Date(2026, 10, 26, 22, 30).getTime();

const entry = (
  id: string,
  singer: string,
  status: ShowQueue[number]['status']
): ShowQueue[number] => ({
  id,
  singer,
  status,
  source: { kind: 'youtube', videoId: 'a3vO3thiYV4', title: 'Dancing Queen', artist: 'Zoom' },
});

const queue: ShowQueue = [
  entry('e0', 'Di', 'done'),
  entry('e1', 'Alex', 'waiting'),
  entry('e2', 'Bo', 'waiting'),
];

const json = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });

beforeEach(() => {
  installFakeYouTube();
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) =>
      String(input).startsWith('/api/show/videos/')
        ? json({ embeddable: true, status: 'none', progress: 0, url: null, downloads: true })
        : json({})
    )
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  removeFakeYouTube();
});

/** A queue in this browser, last saved so long ago (or, with null, nobody knows when). */
function savedQueue(entries: ShowQueue, ago: number | null) {
  localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(entries));
  if (ago === null) localStorage.removeItem(SHOW_SAVED_AT_STORAGE_KEY);
  else localStorage.setItem(SHOW_SAVED_AT_STORAGE_KEY, String(Date.now() - ago));
}

function openShow() {
  const stageView = render(<StageWindow />, {
    container: document.body.appendChild(document.createElement('div')),
  });
  const view = render(
    <ToastProvider>
      <ShowScreen />
    </ToastProvider>,
    { container: document.body.appendChild(document.createElement('div')) }
  );
  return { host: within(view.container), stage: within(stageView.container) };
}

type Host = ReturnType<typeof openShow>['host'];
const rows = (host: Host) => host.queryAllByTestId('show-queue-row').length;
const stored = (): ShowQueue =>
  JSON.parse(localStorage.getItem(SHOW_QUEUE_STORAGE_KEY) ?? '[]') as ShowQueue;

describe('telling an old night’s queue', () => {
  it('is one saved more than half a day ago, or nobody knows when', () => {
    const now = Date.now();
    expect(isOldQueue(now - OLD_QUEUE_MS - 1000, now)).toBe(true);
    expect(isOldQueue(now - OLD_QUEUE_MS + 1000, now)).toBe(false);
    expect(isOldQueue(null, now)).toBe(true);
  });

  it('goes by when the queue was last saved', () => {
    const before = Date.now();

    saveShowQueue(queue);

    expect(loadShowSavedAt()).toBeGreaterThanOrEqual(before);
    expect(loadShowSavedAt()).toBeLessThanOrEqual(Date.now());
  });

  it('knows nothing of a queue saved before the time was written down', () => {
    localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));

    expect(loadShowSavedAt()).toBeNull();
  });
});

describe('a host screen opened with another night’s queue', () => {
  it('says which day the queue is from, and how much is in it', () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, now: THEN + 6 * 24 * HOUR });
    savedQueue(queue, 6 * 24 * HOUR);

    const { host } = openShow();

    const line = host.getByTestId('show-old-queue');
    expect(line).toHaveTextContent('This queue is from');
    expect(line).toHaveTextContent('Thursday');
    expect(line).toHaveTextContent('2 waiting, 1 sung.');
  });

  it('starts a new night: nobody waiting, nobody sung, and the stage shows the night’s name', () => {
    localStorage.setItem(SHOW_TITLE_STORAGE_KEY, 'Thursday at Sluggos');
    savedQueue(queue, 2 * 24 * HOUR);
    const { host, stage } = openShow();
    expect(stage.getByTestId('stage-up-next')).toHaveTextContent('Alex');

    fireEvent.click(host.getByRole('button', { name: 'Start a new night' }));

    expect(rows(host)).toBe(0);
    expect(host.queryByTestId('show-sung')).toBeNull();
    expect(host.queryByTestId('show-old-queue')).toBeNull();
    expect(stored()).toEqual([]);
    expect(stage.getByRole('heading', { name: 'Thursday at Sluggos' })).toBeInTheDocument();
    expect(screen.getByText('A new night: the queue is empty')).toBeInTheDocument();
  });

  it('keeps the queue when told to, and does not ask again', () => {
    savedQueue(queue, 2 * 24 * HOUR);
    const { host } = openShow();

    fireEvent.click(host.getByRole('button', { name: 'Keep this queue' }));

    expect(host.queryByTestId('show-old-queue')).toBeNull();
    expect(rows(host)).toBe(2);
    expect(stored()).toHaveLength(3);
  });

  it('says a queue of no known date is from an earlier night', () => {
    savedQueue(queue, null);

    const { host } = openShow();

    expect(host.getByTestId('show-old-queue')).toHaveTextContent(
      'This queue is from an earlier night.'
    );
  });

  it('forgets the song that could have been picked up', () => {
    savedQueue(queue, 2 * 24 * HOUR);
    saveShowResume({ entryId: 'e1', time: 83, duration: 200 });
    const { host } = openShow();
    expect(host.getByRole('button', { name: 'Resume at 1:23' })).toBeInTheDocument();

    fireEvent.click(host.getByRole('button', { name: 'Start a new night' }));

    expect(loadShowResume()).toBeNull();
  });
});

describe('a host screen opened with tonight’s queue', () => {
  it('says nothing about it', () => {
    savedQueue(queue, HOUR);

    const { host } = openShow();

    expect(host.queryByTestId('show-old-queue')).toBeNull();
    expect(rows(host)).toBe(2);
  });

  it('says nothing about an empty queue, however old', () => {
    savedQueue([], 30 * 24 * HOUR);

    const { host } = openShow();

    expect(host.queryByTestId('show-old-queue')).toBeNull();
  });

  it('does not ask on the next opening of a queue it has just seen', () => {
    savedQueue(queue, 2 * 24 * HOUR);
    const first = render(
      <ToastProvider>
        <ShowScreen />
      </ToastProvider>
    );
    first.unmount();

    const { host } = openShow();

    expect(host.queryByTestId('show-old-queue')).toBeNull();
  });
});

describe('starting a new night from under the queue', () => {
  it('asks first, and keeps the queue when told to', () => {
    savedQueue(queue, HOUR);
    const { host } = openShow();

    fireEvent.click(host.getByRole('button', { name: 'Start a new night' }));
    expect(host.getByRole('alertdialog')).toHaveTextContent('Start a new night?');
    fireEvent.click(host.getByRole('button', { name: 'Keep the queue' }));

    expect(rows(host)).toBe(2);
    expect(host.queryByRole('alertdialog')).toBeNull();
  });

  it('clears everybody once confirmed', () => {
    savedQueue(queue, HOUR);
    const { host } = openShow();

    fireEvent.click(host.getByRole('button', { name: 'Start a new night' }));
    fireEvent.click(host.getByRole('button', { name: 'Clear the queue' }));

    expect(rows(host)).toBe(0);
    expect(host.queryByTestId('show-sung')).toBeNull();
    expect(stored()).toEqual([]);
  });

  it('is not offered while a song is on', async () => {
    savedQueue(queue, HOUR);
    const { host } = openShow();

    fireEvent.click(host.getByRole('button', { name: 'Start the song' }));
    await act(async () => {});

    expect(host.queryByRole('button', { name: 'Start a new night' })).toBeNull();
  });

  it('is not offered with nothing to clear', () => {
    const { host } = openShow();

    expect(host.queryByRole('button', { name: 'Start a new night' })).toBeNull();
  });

  it('is offered once at a time: not under the queue while the line above asks', () => {
    savedQueue(queue, 2 * 24 * HOUR);

    const { host } = openShow();

    expect(host.getAllByRole('button', { name: 'Start a new night' })).toHaveLength(1);
  });
});

describe('clearing the list of who has sung', () => {
  it('asks first', () => {
    savedQueue(queue, HOUR);
    const { host } = openShow();

    fireEvent.click(host.getByRole('button', { name: 'Clear the list' }));
    expect(host.getByTestId('show-sung')).toHaveTextContent('Di');
    fireEvent.click(host.getByRole('button', { name: 'Keep the list' }));
    expect(host.getByTestId('show-sung')).toHaveTextContent('Di');

    fireEvent.click(host.getByRole('button', { name: 'Clear the list' }));
    fireEvent.click(host.getByRole('button', { name: 'Clear it' }));

    expect(host.queryByTestId('show-sung')).toBeNull();
    // Those waiting stay
    expect(rows(host)).toBe(2);
  });
});

describe('the queue’s own rule', () => {
  it('clears everything, and is the same queue when there was nothing', () => {
    expect(showQueueReducer(queue, { type: 'clear' })).toEqual([]);
    const empty: ShowQueue = [];
    expect(showQueueReducer(empty, { type: 'clear' })).toBe(empty);
  });
});
