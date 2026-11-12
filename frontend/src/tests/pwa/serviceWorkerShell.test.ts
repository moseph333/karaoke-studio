/**
 * public/sw.js, run in a fake service worker scope: failed page loads fall back to the
 * offline page, hashed assets are cached, and API and media requests are never intercepted.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFrontendFile } from '../helpers/bootScriptUtils';
import { registerServiceWorker } from '../../utils/serviceWorker';

type Listener = (event: unknown) => void;

interface FakeFetchEvent {
  request: { url: string; method: string; mode: string };
  respondWith: ReturnType<typeof vi.fn>;
}

function loadWorker(fetchImpl: (req: unknown) => Promise<Response>) {
  const listeners: Record<string, Listener> = {};
  const stores = new Map<string, Map<string, Response>>();
  const keyOf = (req: unknown) => (typeof req === 'string' ? req : (req as { url: string }).url);
  const openStore = (name: string) => {
    if (!stores.has(name)) stores.set(name, new Map());
    const store = stores.get(name)!;
    return {
      match: async (req: unknown) => store.get(new URL(keyOf(req), ORIGIN).href),
      put: async (req: unknown, res: Response) => {
        store.set(new URL(keyOf(req), ORIGIN).href, res);
      },
      addAll: async (urls: string[]) => {
        urls.forEach((u) => store.set(new URL(u, ORIGIN).href, new Response(`cached ${u}`)));
      },
      keys: async () => [...store.keys()].map((url) => ({ url })),
      delete: async (req: unknown) => store.delete(keyOf(req)),
    };
  };
  const caches = {
    open: async (name: string) => openStore(name),
    keys: async () => [...stores.keys()],
    delete: async (name: string) => stores.delete(name),
    match: async (req: unknown) => {
      for (const name of stores.keys()) {
        const hit = await openStore(name).match(req);
        if (hit) return hit;
      }
      return undefined;
    },
  };
  const self = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, fn: Listener) => {
      listeners[type] = fn;
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
  };
  const fetchMock = vi.fn(fetchImpl);
  new Function('self', 'caches', 'fetch', readFrontendFile('public/sw.js'))(
    self,
    caches,
    fetchMock
  );
  return { listeners, stores, caches, fetchMock };
}

const ORIGIN = 'https://karaoke.example';

function fetchEvent(path: string, mode = 'cors', method = 'GET'): FakeFetchEvent {
  return {
    request: { url: `${ORIGIN}${path}`, method, mode },
    respondWith: vi.fn(),
  };
}

async function install(worker: ReturnType<typeof loadWorker>) {
  let done: Promise<unknown> = Promise.resolve();
  worker.listeners.install({ waitUntil: (p: Promise<unknown>) => (done = p) });
  await done;
}

describe('service worker', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('precaches the offline page on install', async () => {
    const worker = loadWorker(() => Promise.reject(new Error('offline')));
    await install(worker);
    expect(await worker.caches.match('/offline.html')).toBeDefined();
  });

  it.each([
    '/api/projects',
    '/static/output/song.mp4',
    '/static/stems/a/vocals.wav',
    '/manifest.json',
  ])('leaves %s to the network', (path) => {
    const worker = loadWorker(() => Promise.resolve(new Response('net')));
    const event = fetchEvent(path);
    worker.listeners.fetch(event);
    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it('leaves non-GET requests and other origins alone', () => {
    const worker = loadWorker(() => Promise.resolve(new Response('net')));
    const post = fetchEvent('/', 'navigate', 'POST');
    worker.listeners.fetch(post);
    const other = {
      request: { url: 'https://fonts.example/x.css', method: 'GET', mode: 'cors' },
      respondWith: vi.fn(),
    };
    worker.listeners.fetch(other);
    expect(post.respondWith).not.toHaveBeenCalled();
    expect(other.respondWith).not.toHaveBeenCalled();
  });

  it('serves page loads from the network, never from cache', async () => {
    const worker = loadWorker(() => Promise.resolve(new Response('fresh page')));
    await install(worker);
    const event = fetchEvent('/?project=p1', 'navigate');
    worker.listeners.fetch(event);
    const response: Response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe('fresh page');
  });

  it('falls back to the offline page when the server cannot be reached', async () => {
    const worker = loadWorker(() => Promise.reject(new TypeError('Failed to fetch')));
    await install(worker);
    const event = fetchEvent('/', 'navigate');
    worker.listeners.fetch(event);
    const response: Response = await event.respondWith.mock.calls[0][0];
    expect(await response.text()).toBe('cached /offline.html');
  });

  it('caches hashed assets after the first load', async () => {
    // jsdom's Response.type is "default"; the worker only caches same-origin "basic" ones
    const worker = loadWorker(async () => {
      const res = new Response('bundle');
      Object.defineProperty(res, 'type', { value: 'basic' });
      return res;
    });
    const first = fetchEvent('/assets/index-abc.js');
    worker.listeners.fetch(first);
    await first.respondWith.mock.calls[0][0];
    const second = fetchEvent('/assets/index-abc.js');
    worker.listeners.fetch(second);
    await second.respondWith.mock.calls[0][0];
    expect(worker.fetchMock).toHaveBeenCalledTimes(1);
  });

  it('drops caches from older worker versions on activate', async () => {
    const worker = loadWorker(() => Promise.resolve(new Response('net')));
    await (await worker.caches.open('karaoke-shell-v0')).put('/x', new Response('old'));
    let done: Promise<unknown> = Promise.resolve();
    worker.listeners.activate({ waitUntil: (p: Promise<unknown>) => (done = p) });
    await done;
    expect(await worker.caches.keys()).not.toContain('karaoke-shell-v0');
  });
});

describe('registerServiceWorker', () => {
  it('registers /sw.js in production builds only', () => {
    const register = vi.fn().mockResolvedValue(undefined);
    const nav = { serviceWorker: { register } } as unknown as Navigator;
    registerServiceWorker(nav, window, false);
    expect(register).not.toHaveBeenCalled();
    registerServiceWorker(nav, window, true);
    expect(register).toHaveBeenCalledWith('/sw.js');
  });

  it('skips browsers without service workers', () => {
    expect(() => registerServiceWorker({} as Navigator, window, true)).not.toThrow();
  });
});
