// Bump CACHE whenever the shell or its response headers change. Navigations are
// network-first, so a new CSP applies immediately while online; but an offline
// launch falls back to the cached '/' response below, which carries the CSP
// header it was captured with. Without a rename, `activate` keeps that entry
// forever and the v133 blob: style-src fix never reaches offline EPUB reading.
// v26: the '/' shell body now carries a build-derived ?v= token, so a cached v25
// shell would keep pointing at the pre-token URL.
// v27: epub-engine.mjs rewrites a chapter's external embed into a link card and
// styles.css styles it; a cached v26 shell would pair the new engine with the old
// stylesheet, so the card would render unstyled.
// v28: the sign-in box (index.html, app.js, styles.css) changed shape; a cached v27 shell
// would show the old form next to the new script.
// v29: the same files gain the AI buttons and panel; a cached v28 shell would pair the
// old markup with the new script.
// v30: the Yönetim button and panel were added to index.html, app.js and styles.css; a cached v29
// shell would pair the old markup with the new script.
// v31: app.js names the users in the admin usage list; a cached v30 shell would keep the old script.
// v32: the library shelf (library.mjs, library-model.mjs, library.css, the catalogue controls in index.html and
// app.js) and read aloud (read-aloud.mjs, read-aloud-sources.mjs, the player): a cached v31 shell would pair the
// old markup with the new scripts.
// v33: read aloud follows the spoken word and skips page furniture (read-aloud.mjs, read-aloud-sources.mjs,
// the player markup in index.html, styles.css): a cached v32 shell would pair the old markup with the new scripts.
// v34: app.js heals a page whose HTML is older than its scripts and no longer dies on missing read-aloud markup;
// the service worker itself is now marked never-keep-at-the-edge. A cached v33 shell would keep the old script.
// v35: the selection bar is a panel now (index.html, styles.css, app.js: the passage under the actions, the note
// field a text area) and buildSelection clips a range that runs past the text layer; a cached v34 shell would
// pair the old markup with the new script.
// v36: the library has a sidebar, three designs, grid/list and book covers (index.html, library-designs.css/.mjs,
// library-covers.mjs, app.js); the edit form has a cover field. A cached v35 shell would pair the old markup with
// the new script.
// v37: the reader has a new shell (top bar, tool rail, page controls, a docked read-aloud strip, a one-row selection
// bar) and EPUB text settings (index.html, styles.css, app.js, reader-appearance.mjs, epub-engine.mjs). A cached v36
// shell would pair the old markup with the new script.
// v38: the selection bar is a compact row of icon buttons and sits clear of the selected words (index.html, styles.css,
// app.js). A cached v37 shell would pair the old markup with the new script.
// v39: catalogue cards show subject, title, author, publisher/year/language; night-mode form controls; a movable selection bar
// (index.html, app.js, styles.css, library-designs.css). A cached v38 shell would pair the old markup with the new script.
// v40: catalogue subjects are broad groups with translated labels (subject-groups.mjs, app.js, library-designs.css). A cached v39 shell
// would pair the old markup with the new script.
// v41: reading a selection aloud stops with the selection (read-aloud.mjs, read-aloud-sources.mjs); larger covers in the list layout
// (library-designs.css). A cached v40 shell would pair the old markup with the new script.
// v42: list-layout covers fill their frame; an EPUB selection that ends on a paragraph break is read to its end only (library-designs.css,
// read-aloud-sources.mjs). A cached v41 shell would pair the old markup with the new script.
// v43: the edit form reports a record of the shared catalogue that cannot be changed (app.js, i18n.mjs). A cached v42 shell would pair the old
// script with the new server answer.
// v44: the first subject decides a book's group (subject-groups.mjs). A cached v43 shell would keep the old grouping.
// v45: covers of the two public-demo books (library-covers.mjs). A cached v44 shell would not know them.
// v46: theme and surround swatches, foldable contents (index.html, app.js, styles.css, i18n.mjs). A cached v45 shell would pair the old
// markup with the new script.
const CACHE = 'akademik-shell-v47';
const SHELL = [
  '/',
  '/styles.css',
  '/library.css',
  '/library.mjs',
  '/library-model.mjs',
  '/library-designs.css',
  '/library-designs.mjs',
  '/library-covers.mjs',
  '/reader-appearance.mjs',
  '/subject-groups.mjs',
  '/design-init.js',
  '/app.js',
  '/i18n.mjs',
  '/citations.mjs',
  '/read-aloud.mjs',
  '/read-aloud-sources.mjs',
  '/pdf-structure.mjs',
  '/ocr-layer.mjs',
  '/search.mjs',
  '/epub-engine.mjs',
  '/offline.mjs',
  '/downloads.mjs',
  '/book-variants.mjs',
  '/book-links.mjs',
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
    // Bump CACHE whenever the PDF.js distribution changes so API and worker stay aligned.
    // Only public PDF.js assets use cache-first; authenticated content bypasses this handler.
    if (url.pathname.startsWith('/vendor/pdfjs/')) {
      const cache = await caches.open(CACHE);
      const cached = await cache.match(request);
      if (cached) return cached;
      try {
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      } catch {
        return new Response('', { status: 504 });
      }
    }
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
