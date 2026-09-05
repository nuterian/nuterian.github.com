/*
 * sw.js — the site, from here on out.
 *
 * A repeat visit paints from disk; a visit with no network at all still gets
 * the whole site, flock included. Two rules, chosen for a page that deploys
 * by git push and must never serve yesterday's HTML:
 *
 *   NAVIGATIONS are network-first. A deploy lands on the very next visit;
 *   only a dead network falls back to the cached page.
 *
 *   EVERYTHING ELSE is stale-while-revalidate: answered from disk instantly,
 *   refreshed in the background. An asset is at most one visit behind, and
 *   the version below only needs bumping to *drop* things, not to update
 *   them — updates flow through on their own.
 *
 * The shell is precached at install, so offline works even for a visitor who
 * never scrolled; the archive's screenshots are cached as they are seen.
 *
 * BOTH refreshes above have to say so explicitly, because a service worker's
 * own `fetch` goes through the HTTP cache like any other — and GitHub Pages
 * serves these assets fresh for ten minutes. Left plain, the revalidation was
 * answered from that cache with the very bytes it was trying to replace, and
 * stored them again: a stylesheet could not be updated at all, on any number of
 * reloads. Measured on the dev server, which is the honest case — it serves the
 * same headers GitHub Pages does and its files change every few minutes. So
 * both send a conditional request (`no-cache`: revalidate, take a 304 when
 * nothing moved). The precache used to bypass the cache outright (`reload`),
 * and that re-downloaded the whole shell — ~100 KB, the page's entire first
 * load over again — on every first visit and every version bump, at the load
 * event, while flock.js was often still arriving. The conditional request
 * carries the same guarantee: GitHub Pages compares against the ETag it is
 * serving NOW, so the precache is exactly current rather than one visit behind,
 * and it costs eleven header-only round trips plus the three files the page
 * never loaded (measured: 100 KB → 11 KB over the wire).
 */
const V = 'flock-v3';   // v3: flock.worker.js is gone — the worker is flock.js itself
const SHELL = [
  '/', '/404.html',
  '/css/style.css',
  '/js/main.js', '/js/theme.js', '/js/count.js', '/js/hue.js', '/js/flock.js', '/js/mark.js', '/js/404.js',
  '/fonts/geist.woff2', '/fonts/geist-mono.woff2',
  '/img/mark.svg',
];

addEventListener('install', (e) => {
  e.waitUntil(caches.open(V)
    .then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'no-cache' }))))
    .then(() => skipWaiting()));
});

addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== V).map((k) => caches.delete(k))))
      .then(() => clients.claim()));
});

addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || !req.url.startsWith(location.origin)) return;

  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(V);
      try {
        const res = await fetch(req);
        // A redirected response is deliberately not cached. A navigation request
        // carries redirect mode "manual", and replaying a stored redirected
        // response against one is a spec error — which is exactly what the old
        // origin does now that nuterian.github.io 301s to jugalm.com.
        if (res.ok && !res.redirected) c.put(req, res.clone());
        return res;
      } catch {
        // Offline: the cached page if we have this one, the home page for
        // home, and the 404 for anything never seen (an uncached path is
        // exactly what the 404 already says: nothing at this address).
        return (await c.match(req, { ignoreSearch: true }))
            || (await c.match(new URL(req.url).pathname === '/' ? '/' : '/404.html'));
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const c = await caches.open(V);
    const hit = await c.match(req);
    // The cache mode depends on whether there is anything to revalidate. Holding
    // a copy, the background refresh must reach past the HTTP cache (`no-cache`)
    // or it is handed back the very bytes it is trying to replace — see the note
    // at the top. Holding NOTHING, there is no update to miss and the browser's
    // own cache is a resource, not an obstacle: it is what serves an archive
    // screenshot offline that this worker never got to see, because on a first
    // visit the <img> is requested before the worker controls the page.
    const refresh = fetch(req, hit ? { cache: 'no-cache' } : undefined)
      .then((res) => { if (res.ok) c.put(req, res.clone()); return res; })
      .catch(() => hit);
    if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
    return refresh;
  })());
});
