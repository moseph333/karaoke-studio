/**
 * "Start the song" pressed the instant the host screen appears, before React has run the
 * screen's start-up effects. One of those effects stops whatever a removed singer was
 * playing; run at start-up, with nobody on, it used to wipe the note of which song was being
 * loaded after the press had made it, so the song's data was thrown away when it arrived and
 * the singer stood on stage with no song.
 *
 * The screen is rendered here as the app renders it, outside the test helpers that settle
 * every effect before going on, and pressed from the first moment its button exists.
 */

import React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot, type Root } from 'react-dom/client';
import { waitFor } from '@testing-library/react';
import { ShowScreen } from '../../components/show/ShowScreen';
import type { ProjectState } from '../../types';
import {
  SHOW_QUEUE_STORAGE_KEY,
  SHOW_SAVED_AT_STORAGE_KEY,
  type ShowQueue,
} from '../../utils/showQueue';

const song = {
  id: 'demo',
  status: 'ready',
  title: 'Neon Skyline',
  artist: 'The Midnight Static',
  duration: 62,
  master_audio_url: '/static/output/demo_mix.wav',
  lines: [],
} as unknown as ProjectState;

const queue: ShowQueue = [
  {
    id: 'e1',
    singer: 'Cy',
    status: 'waiting',
    source: { kind: 'library', projectId: 'demo', title: 'Neon Skyline', artist: 'The Static' },
  },
];

type ActFlag = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

let root: Root;
let container: HTMLElement;
let actEnvironment: boolean | undefined;

beforeEach(() => {
  // The screen is rendered and pressed without `act`, as in a browser
  actEnvironment = (globalThis as ActFlag).IS_REACT_ACT_ENVIRONMENT;
  (globalThis as ActFlag).IS_REACT_ACT_ENVIRONMENT = false;
  localStorage.setItem(SHOW_QUEUE_STORAGE_KEY, JSON.stringify(queue));
  localStorage.setItem(SHOW_SAVED_AT_STORAGE_KEY, String(Date.now()));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL) => {
      const body = String(input) === '/api/project/demo' ? song : {};
      return new Response(JSON.stringify(body), {
        headers: { 'Content-Type': 'application/json' },
      });
    })
  );
  container = document.body.appendChild(document.createElement('div'));
  root = createRoot(container);
});

afterEach(() => {
  root.unmount();
  container.remove();
  vi.unstubAllGlobals();
  (globalThis as ActFlag).IS_REACT_ACT_ENVIRONMENT = actEnvironment;
});

/** Resolves with the button as soon as it is in the page: in the same turn it was drawn. */
function firstSightOf(name: string): Promise<HTMLButtonElement> {
  const find = () =>
    Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent?.trim() === name
    ) ?? null;
  return new Promise((resolve) => {
    const seen = find();
    if (seen) {
      resolve(seen);
      return;
    }
    const observer = new MutationObserver(() => {
      const button = find();
      if (!button) return;
      observer.disconnect();
      resolve(button);
    });
    observer.observe(container, { childList: true, subtree: true });
  });
}

describe('Start the song, pressed as the host screen appears', () => {
  it('loads the song', async () => {
    root.render(<ShowScreen />);

    (await firstSightOf('Start the song')).click();

    await waitFor(() =>
      expect(container.querySelector('[data-testid="show-audio"]')).not.toBeNull()
    );
    expect(container.querySelector('[data-testid="show-audio"]')).toHaveAttribute(
      'src',
      '/static/output/demo_mix.wav'
    );
    expect(container.textContent).toContain('Now singing');
  });
});
