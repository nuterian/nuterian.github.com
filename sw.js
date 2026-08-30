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
 */
const V = 'flock-v1';
const SHELL = [
  '/', '/404.html',
  '/css/style.css',
  '/js/main.js', '/js/theme.js', '/js/hue.js', '/js/flock.js', '/js/mark.js', '/js/flock.worker.js', '/js/404.js',
  '/fonts/geist.woff2', '/fonts/geist-mono.woff2',
  '/img/mark.svg',
];

addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then((c) => c.addAll(SHELL)).then(() => skipWaiting()));
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
    const refresh = fetch(req)
      .then((res) => { if (res.ok) c.put(req, res.clone()); return res; })
      .catch(() => hit);
    if (hit) { e.waitUntil(refresh.catch(() => {})); return hit; }
    return refresh;
  })());
});
