const CACHE = 'akademik-shell-v11';
const SHELL = [
  '/',
  '/styles.css',
  '/app.js',
  '/i18n.mjs',
  '/citations.mjs',
  '/search.mjs',
  '/epub-engine.mjs',
  '/offline.mjs',
  '/downloads.mjs',
  '/vendor/pdfjs/pdf.mjs',
  '/vendor/pdfjs/pdf.worker.mjs',
  '/vendor/epubjs/jszip.min.js',
  '/vendor/epubjs/epub.min.js',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.allSettled(SHELL.map((path) => cache.add(path)));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/uploads/')
      || url.pathname.startsWith('/seed/') || url.pathname.startsWith('/ocr/')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        return await fetch(request);
      } catch {
        return (await caches.match('/')) || new Response('Çevrimdışı', { status: 503 });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const networkFirst = /\.(?:js|mjs|css|html)$/.test(url.pathname);
    if (networkFirst) {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        return (await caches.match(request, { ignoreSearch: true })) || new Response('', { status: 504 });
      }
    }
    const cached = await caches.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      const response = await fetch(request);
      if (response.ok) {
        const cache = await caches.open(CACHE);
        cache.put(request, response.clone());
      }
      return response;
    } catch {
      return new Response('', { status: 504 });
    }
  })());
});
