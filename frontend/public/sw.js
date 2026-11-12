/*
 * Karaoke Studio service worker.
 *
 * Keeps the installed app from opening onto the browser's error page when the studio server
 * is down or restarting after an update: page loads go to the network first and fall back to
 * a cached offline page. Vite's hashed /assets/ files never change, so they are kept in a
 * small cache for faster launches. Nothing else is touched: /api and /static (projects, audio,
 * renders) always go straight to the server, and the page itself is never served from cache,
 * so a new build shows up as soon as the server has it.
 */

const SHELL_CACHE = 'karaoke-shell-v1';
const ASSET_CACHE = 'karaoke-assets-v1';
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icon.svg', '/icon-192.png'];
const MAX_ASSETS = 60;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  const keep = [SHELL_CACHE, ASSET_CACHE];
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((name) => !keep.includes(name)).map((name) => caches.delete(name)))
      )
      .then(() => self.clients.claim())
  );
});

async function trimAssetCache(cache) {
  const keys = await cache.keys();
  // Oldest first: drop entries beyond the cap (old builds' bundles)
  await Promise.all(
    keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((k) => cache.delete(k))
  );
}

async function pageWithOfflineFallback(request) {
  try {
    return await fetch(request);
  } catch (err) {
    const offline = await caches.match(OFFLINE_URL);
    if (offline) return offline;
    throw err;
  }
}

async function cachedAsset(request) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === 'basic') {
    await cache.put(request, response.clone());
    trimAssetCache(cache).catch(() => {});
  }
  return response;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(pageWithOfflineFallback(request));
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(cachedAsset(request));
  }
  // Everything else (/api, /static, icons, the manifest) goes to the network untouched
});
