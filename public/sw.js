import { APP_CACHE, cacheKeyForRequest, classifyRequest, extractBuildAssets, obsoleteAppCaches, prepareCacheWrite } from './sw-policy.js';

const APP_SHELL = ['/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(APP_CACHE).then(async cache => {
    const response = await fetch('/index.html', { cache: 'no-store' });
    if (!response.ok) throw new Error(`App shell request failed: ${response.status}`);
    const html = await response.clone().text();
    await cache.put('/index.html', response);
    await cache.addAll([...APP_SHELL, ...extractBuildAssets(html, location.origin)]);
  }));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(obsoleteAppCaches(keys).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', event => {
  if (event.data?.type === 'CATETIN_ACTIVATE_UPDATE') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  const strategy = classifyRequest(event.request.url, event.request.mode, location.origin);
  if (strategy === 'bypass') return;
  if (strategy === 'cache-first') {
    const cacheKey = cacheKeyForRequest(event.request.url, location.origin);
    event.respondWith(caches.match(cacheKey).then(cached => cached ?? fetch(event.request).then(async response => {
      const prepared = prepareCacheWrite(response);
      if (prepared) await caches.open(APP_CACHE).then(cache => cache.put(cacheKey, prepared.cacheCopy)).catch(() => undefined);
      return response;
    })));
    return;
  }
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).then(async response => {
      const prepared = prepareCacheWrite(response);
      if (prepared) await caches.open(APP_CACHE).then(cache => cache.put('/index.html', prepared.cacheCopy)).catch(() => undefined);
      return response;
    }).catch(() => caches.match('/index.html')));
  }
});
