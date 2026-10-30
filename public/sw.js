'use strict';

const CACHE = 'qmreader-offline-v1';
const OFFLINE = '/offline.html';
const STATIC = [OFFLINE, '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(STATIC)));
  // Updates wait until existing tabs close; never reload an active reading session.
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith('qmreader-offline-') && key !== CACHE)
    .map(key => caches.delete(key)))));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (STATIC.includes(url.pathname) && !url.search) {
    event.respondWith(caches.open(CACHE).then(async cache =>
      (await cache.match(request)) || fetch(request)));
    return;
  }
  // Never intercept APIs, media, account mutations, or third-party requests.
  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(async () => {
      const cache = await caches.open(CACHE);
      return (await cache.match(OFFLINE)) || Response.error();
    }));
  }
});
