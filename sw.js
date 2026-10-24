/**
 * Marvel Multiverse Watchlist — Service Worker
 * Strategy:
 *   - Local files  → Cache-first (instant load, updates in background)
 *   - CDN assets   → Stale-while-revalidate (serve cached, refresh silently)
 *   - Offline      → Serve cached MCU.html so the app always loads
 */

const APP_CACHE  = 'marvel-app-v1';
const CDN_CACHE  = 'marvel-cdn-v1';

// Files to pre-cache on install (app shell)
const PRECACHE_URLS = [
  './MCU.html',
  './manifest.json',
  './icons/icon.svg',
  './icons/icon-maskable.svg'
];

// CDN hostnames to cache on first fetch
const CDN_HOSTS = [
  'cdn.tailwindcss.com',
  'cdnjs.cloudflare.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com'
];

// ─── Install ───────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(APP_CACHE)
      .then(cache => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

// ─── Activate (clean up old caches) ────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== APP_CACHE && k !== CDN_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ─── Fetch ──────────────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // ── CDN assets: stale-while-revalidate ──────────────────────────────────
  if (CDN_HOSTS.some(host => url.hostname.includes(host))) {
    event.respondWith(staleWhileRevalidate(CDN_CACHE, request));
    return;
  }

  // ── Local app files: cache-first, network fallback ──────────────────────
  if (url.origin === self.location.origin) {
    event.respondWith(cacheFirstWithFallback(APP_CACHE, request));
    return;
  }
});

// ─── Strategies ─────────────────────────────────────────────────────────────

/** Serve from cache immediately; update cache in background. */
async function staleWhileRevalidate(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const networkFetch = fetch(request)
    .then(response => {
      if (response.ok || response.type === 'opaque') {
        cache.put(request, response.clone());
      }
      return response;
    })
    .catch(() => cached); // offline: fall back to cached

  return cached || networkFetch;
}

/** Serve from cache; if not cached, fetch and cache it. Offline → cached MCU.html. */
async function cacheFirstWithFallback(cacheName, request) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    // Offline and not cached → serve the app shell
    const fallback = await cache.match('./MCU.html');
    return fallback || new Response('Offline — please reload when connected.', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' }
    });
  }
}
