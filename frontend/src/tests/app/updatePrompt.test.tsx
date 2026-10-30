/**
 * The studio offers a reload once the server serves a newer build: it compares the hashed entry
 * script of the index.html served at / with the one the open page loaded.
 */

import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import { ToastProvider } from '../../hooks/useToast';
import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_MIN_GAP_MS,
  UPDATE_PROMPT_MESSAGE,
  entryScript,
  useUpdatePrompt,
} from '../../hooks/useUpdatePrompt';

const OLD = '/assets/index-old111.js';
const NEW = '/assets/index-new222.js';
const NEWER = '/assets/index-new333.js';

const page = (entry: string) =>
  '<!doctype html><html><head><script>document.documentElement.dataset.theme = "dark";</script>' +
  `<script type="module" crossorigin src="${entry}"></script></head>` +
  '<body><div id="root"></div></body></html>';

let served: string | Error = page(OLD);
let status = 200;
const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
  if (served instanceof Error) throw served;
  const html = served;
  return { ok: status >= 200 && status < 300, status, text: async () => html } as Response;
});

let visibility: DocumentVisibilityState = 'visible';

function Probe() {
  useUpdatePrompt();
  return null;
}

function renderInBuiltPage(entry: string | null = OLD) {
  if (entry) {
    const script = document.createElement('script');
    script.type = 'module';
    script.setAttribute('src', entry);
    document.head.appendChild(script);
  }
  return render(
    <ToastProvider>
      <Probe />
    </ToastProvider>
  );
}

/** Lets the check's fetch, text() and toast settle. */
const settle = () =>
  act(async () => {
    for (let i = 0; i < 10; i++) await Promise.resolve();
  });

async function tabBecomesVisible() {
  visibility = 'visible';
  document.dispatchEvent(new Event('visibilitychange'));
  await settle();
}

async function wait(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
  await settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  served = page(OLD);
  status = 200;
  visibility = 'visible';
  vi.stubGlobal('fetch', fetchMock);
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.head.querySelectorAll('script[type="module"]').forEach((s) => s.remove());
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe('entryScript', () => {
  it('reads the hashed entry of a built page and ignores the dev server entry', () => {
    const parse = (html: string) => new DOMParser().parseFromString(html, 'text/html');
    expect(entryScript(parse(page(NEW)))).toBe(NEW);
    expect(entryScript(parse(page('/src/main.tsx')))).toBeNull();
    expect(entryScript(parse('<html><body>Bad gateway</body></html>'))).toBeNull();
  });
});

describe('useUpdatePrompt', () => {
  it('does nothing outside a built page', async () => {
    served = page(NEW);
    renderInBuiltPage(null);

    await tabBecomesVisible();
    window.dispatchEvent(new Event('focus'));
    await wait(UPDATE_CHECK_INTERVAL_MS);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByText(UPDATE_PROMPT_MESSAGE)).not.toBeInTheDocument();
  });

  it('offers a reload when the server serves a newer build', async () => {
    const location = Object.getOwnPropertyDescriptor(window, 'location');
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...window.location, reload },
    });
    try {
      served = page(NEW);
      renderInBuiltPage(OLD);

      await tabBecomesVisible();

      expect(fetchMock).toHaveBeenCalledWith('/', { cache: 'no-store' });
      expect(screen.getByText(UPDATE_PROMPT_MESSAGE)).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Reload' }));
      expect(reload).toHaveBeenCalledTimes(1);
      expect(screen.queryByText(UPDATE_PROMPT_MESSAGE)).not.toBeInTheDocument();
    } finally {
      if (location) Object.defineProperty(window, 'location', location);
    }
  });

  it('stays quiet while the server serves the same build', async () => {
    renderInBuiltPage(OLD);

    await tabBecomesVisible();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(UPDATE_PROMPT_MESSAGE)).not.toBeInTheDocument();
  });

  it('stays quiet when the page cannot be fetched, as while the server restarts', async () => {
    renderInBuiltPage(OLD);

    served = new TypeError('Failed to fetch');
    await tabBecomesVisible();
    expect(fetchMock).toHaveBeenCalledTimes(1);

    served = page(NEW);
    status = 502;
    await wait(UPDATE_CHECK_MIN_GAP_MS);
    await tabBecomesVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);

    expect(screen.queryByText(UPDATE_PROMPT_MESSAGE)).not.toBeInTheDocument();
  });

  it('offers each build once and replaces the offer when an even newer one appears', async () => {
    renderInBuiltPage(OLD);

    served = page(NEW);
    await tabBecomesVisible();
    expect(screen.getByText(UPDATE_PROMPT_MESSAGE)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /dismiss notification/i }));

    // Dismissed: the same build isn't offered again
    await wait(UPDATE_CHECK_MIN_GAP_MS);
    await tabBecomesVisible();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText(UPDATE_PROMPT_MESSAGE)).not.toBeInTheDocument();

    // A later build is
    served = page(NEWER);
    await wait(UPDATE_CHECK_MIN_GAP_MS);
    await tabBecomesVisible();
    expect(screen.getAllByText(UPDATE_PROMPT_MESSAGE)).toHaveLength(1);

    // And while that offer is still showing, a newer one replaces it rather than stacking
    served = page('/assets/index-new444.js');
    await wait(UPDATE_CHECK_MIN_GAP_MS);
    await tabBecomesVisible();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(screen.getAllByText(UPDATE_PROMPT_MESSAGE)).toHaveLength(1);
  });

  it('checks every 5 minutes while the tab is visible', async () => {
    renderInBuiltPage(OLD);
    served = page(NEW);

    await wait(UPDATE_CHECK_INTERVAL_MS - 1000);
    expect(fetchMock).not.toHaveBeenCalled();

    await wait(1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.getByText(UPDATE_PROMPT_MESSAGE)).toBeInTheDocument();
  });

  it('never fetches while the tab is hidden', async () => {
    renderInBuiltPage(OLD);

    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    await wait(UPDATE_CHECK_INTERVAL_MS * 2);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('fetches once when focus and visibilitychange fire together', async () => {
    renderInBuiltPage(OLD);

    window.dispatchEvent(new Event('focus'));
    await tabBecomesVisible();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops checking once unmounted', async () => {
    const { unmount } = renderInBuiltPage(OLD);
    unmount();

    await tabBecomesVisible();
    await wait(UPDATE_CHECK_INTERVAL_MS);

    expect(fetchMock).not.toHaveBeenCalled();
  });
});
