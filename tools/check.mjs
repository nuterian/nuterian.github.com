/*
 * check.mjs — the quality gate. Fails (exit 1) if the site drops below the bar:
 *   • axe-core: zero violations, light & dark, desktop & phone, home + open sheet + 404
 *   • Lighthouse: 100 / 100 / 100 / 100 (perf, a11y, best-practices, seo) on desktop & mobile
 *   • Budget: first load (HTML + CSS + JS + fonts + favicon) < 100 KB over the wire (gzip)
 *   • Console: no errors, no failed requests, no third-party requests except the
 *     first-party count beacon (stats.jugalm.com — see js/count.js)
 *   • Motion: prefers-reduced-motion renders a still (no animation frames)
 *   • Deploy: one visit after a deploy, the page runs on the new assets — the
 *     service worker's two caching rules alone left it one visit behind
 *   • Pages: every sitemap URL has a title, a description, its canonical and a
 *     JSON-LD node; the dates the sitemap claims for this repo's pages are git's
 *   • Mirrors: the facts the code keeps in two places — the phone breakpoint,
 *     the flock's colour, the service worker's shell, the font weight range —
 *     recomputed from the served files and held together here
 * Usage: node check.mjs [baseURL]   (default http://localhost:4173)
 */
import { chromium, devices } from 'playwright';
import { tally, watch, axeSettled, printViolations, stillFrame, noScript } from './lib.mjs';
import { createServer } from 'node:http';
import lighthouse from 'lighthouse';
import * as LH from 'lighthouse/core/config/constants.js';
import { gzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { flockColor } from '../js/hue.js';

const BASE = process.argv[2] || 'http://localhost:4174';
const OUT = process.env.OUT || new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
const { ok, fail, finish } = tally();

const browser = await chromium.launch({ args: ['--remote-debugging-port=9222'] });

// --- axe ------------------------------------------------------------------
console.log('\naxe');
for (const scheme of ['light', 'dark']) {
  for (const [label, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const { errors, thirdParty } = watch(page, BASE);

    for (const path of ['/', '/#kidscerts', '/404.html']) {
      await page.goto(BASE + path + (path.includes('#') ? '' : '?seed=1'), { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const res = await axeSettled(page, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']);
      const v = res.violations;
      if (v.length) { fail(`${scheme}/${label} ${path}: ${v.length} violation(s)`); printViolations(v); }
      else ok(`${scheme}/${label} ${path}: 0 violations (${res.passes.length} rules passed)`);
    }
    if (errors.length) fail(`${scheme}/${label}: console/request errors: ${errors.join(' | ')}`);
    if (thirdParty.length) fail(`${scheme}/${label}: third-party requests: ${thirdParty.join(', ')}`);
    await page.screenshot({ path: `${OUT}/${scheme}-${label}.png` });
    await ctx.close();
  }
}

// --- reduced motion → still ------------------------------------------------
console.log('\nmotion');
(await stillFrame(browser, BASE, { serviceWorkers: 'block' })) ? ok('reduced motion: frame is still') : fail('reduced motion: the canvas is animating');

// --- no script ------------------------------------------------------------
console.log('\nno script');
{
  const { still, sheet } = await noScript(browser, BASE, {}, `${OUT}/nojs.png`);
  still ? ok('no-js: inline still is shown') : fail('no-js: still hidden');
  sheet ? ok('no-js: #unlistr opens via :target') : fail('no-js: sheet does not open');
}

// --- policy: the CSP names the inline scripts it allows -----------------------
// The Content-Security-Policy meta allows exactly one inline script per page, by
// hash. An edit to that script — a new line in the theme restore, say — would not
// error at edit time; the browser would simply refuse to run it, and the page
// would come up on the system theme with no --vh, working, and quietly worse.
// So the hash is recomputed here from the served HTML. (A data block such as the
// JSON-LD is not a script to CSP and is not counted.)
console.log('\npolicy');
for (const path of ['/', '/404.html']) {
  const html = await (await fetch(BASE + path)).text();
  const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
  if (!csp) { fail(`${path}: no Content-Security-Policy meta`); continue; }
  const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/g)].filter(m => !/type="application\/ld\+json"/.test(m[1]));
  const missing = inline.map(m => 'sha256-' + createHash('sha256').update(m[2]).digest('base64')).filter(h => !csp.includes(`'${h}'`));
  if (missing.length) fail(`${path}: inline script hash not in CSP: ${missing.join(', ')}`);
  else ok(`${path}: ${inline.length} inline script(s), every hash in the policy`);
  const third = csp.match(/https?:\/\/[^\s;]+/g) || [];
  if (third.some(u => u !== 'https://stats.jugalm.com')) fail(`${path}: policy names an origin that is not ours: ${third.join(' ')}`);
  else ok(`${path}: the only remote origin in the policy is stats.jugalm.com`);
}

// --- behaviours that shipped as screenshots — pinned here so tuning can't
// silently undo them. All on ?still, on the worker — the path visitors take:
// `flock.step(n)` advances the simulation by hand and `flock.snapshot()` reads
// it back, so each check is deterministic and takes milliseconds, not settle-time.
console.log('\nbehaviours');
{
  const step = (page, n) => page.evaluate(n => window.flock.step(n), n);
  const snap = (page) => page.evaluate(() => window.flock.snapshot());
  const still = async (page, url, steps = 300) => {
    await page.goto(BASE + url); await page.waitForFunction(() => window.flock?.snapshot);
    await step(page, steps);
    return page;
  };
  // A landscape phone is all words: the mark stands down (homeOut), and comes
  // back when the viewport turns portrait again.
  const ctx = await browser.newContext({ viewport: { width: 667, height: 375 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await still(page, '/?seed=7&still');
  const out = await snap(page);
  (out.homeOut && out.homeBox === null) ? ok('landscape: mark stands down (homeOut, no box)') : fail(`landscape: mark did not stand down (${JSON.stringify({ box: out.homeBox, out: out.homeOut })})`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250); // let resize re-measure, then step the sim
  await step(page, 300);
  const back = (await snap(page)).homeBox;
  back ? ok('portrait: the mark returns') : fail('portrait: the mark never came back');
  // Phones fly the thinned grid (102 points), desktop the full 208.
  const pts = (await snap(page)).homePoints;
  pts === 102 ? ok(`phone mark: thinned grid (${pts} points)`) : fail(`phone mark: expected 102 points, got ${pts}`);
  await ctx.close();
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const dpage = await dctx.newPage();
  await still(dpage, '/?seed=7&still', 60);
  const dpts = (await snap(dpage)).homePoints;
  dpts === 208 ? ok(`desktop mark: full grid (${dpts} points)`) : fail(`desktop mark: expected 208 points, got ${dpts}`);
  await dctx.close();
  // The hero is bottom-anchored and must equal the viewport you can SEE. No
  // static unit manages it on every browser (style.css has the measurements),
  // so JS drives --vh from visualViewport and svh is only the no-script floor.
  // Two things are pinned: that the declaration still falls back to svh and
  // never to dvh — headless they compute equal, so only the declaration can
  // tell them apart — and that the JS path actually lands on the visible height.
  {
    const uctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const upage = await uctx.newPage();
    await upage.goto(BASE + '/?seed=1&still');
    await upage.waitForTimeout(400);
    const r = await upage.evaluate(() => {
      let decl = null;
      for (const sheet of document.styleSheets) {
        let rules; try { rules = sheet.cssRules; } catch { continue; }
        for (const rule of rules) if (rule.selectorText === '.hero') decl = rule.style.minHeight;
      }
      return { decl, hero: Math.round(document.querySelector('.hero').getBoundingClientRect().height),
               visible: Math.round(visualViewport.height) };
    });
    (r.decl && r.decl.includes('svh') && !r.decl.includes('dvh'))
      ? ok(`hero falls back to the small viewport ("${r.decl}")`)
      : fail(`hero min-height is "${r.decl}" — must fall back to svh, never dvh`);
    (r.hero === r.visible)
      ? ok(`hero fills the visible viewport (${r.hero}px)`)
      : fail(`hero is ${r.hero}px but the visible viewport is ${r.visible}px`);
    await uctx.close();
  }

  // The home box's size is the goal's, always. It used to be copied once and
  // then left behind when the fit ladder stepped — stale by 272 px — which is
  // read by the roam ring's centre and radius, so the flock circled a mark that
  // was no longer the size it thought. Forced here rather than waited for.
  {
    const bctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, serviceWorkers: 'block' });
    const bpage = await bctx.newPage();
    await still(bpage, '/?seed=7&still', 60);
    await bpage.evaluate(() => { window.flock.home = { w: 900, h: 900 / 1.557 }; });   // too big for the room: the ladder must step
    await step(bpage, 400);
    const s = await snap(bpage);
    const r = { fit: s.homeFit, want: Math.round(s.homeReq.w * s.homeFit), box: Math.round(s.homeBox.w) };
    (r.fit < 1 && r.box === r.want)
      ? ok(`home box tracks the fit (stepped to ${r.fit}, box ${r.box}px)`)
      : fail(`home box is ${r.box}px but the mark is ${r.want}px at fit ${r.fit} — the ring circles the wrong size`);
    await bctx.close();
  }

  // Where the mark rests must not depend on how you got there. Scrolled SMOOTHLY
  // down and back — a jump never showed this — the placement hysteresis used to
  // hold the mark wherever the moving goal had dragged it, 136 px off, and
  // permanently. Real wheel events, because that is the thing that broke.
  {
    const rctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, serviceWorkers: 'block' });
    const rpage = await rctx.newPage();
    await rpage.goto(BASE + '/?seed=7');
    await rpage.waitForFunction(() => window.flock?.snapshot);
    const where = async () => (await rpage.evaluate(() => window.flock.snapshot())).homeBox;
    await rpage.waitForTimeout(9000);
    const before = await where();
    for (let i = 0; i < 30; i++) { await rpage.mouse.wheel(0, 45); await rpage.waitForTimeout(25); }
    await rpage.waitForTimeout(2500);
    for (let i = 0; i < 30; i++) { await rpage.mouse.wheel(0, -45); await rpage.waitForTimeout(25); }
    await rpage.waitForTimeout(6000);
    const after = await where();
    const dy = Math.abs(after.y - before.y), dx = Math.abs(after.x - before.x);
    (dx < 12 && dy < 12)
      ? ok(`mark returns to where it started after a smooth scroll (${dx.toFixed(0)}px, ${dy.toFixed(0)}px)`)
      : fail(`mark rests ${dx.toFixed(0)}px/${dy.toFixed(0)}px from where it began — the placement is path-dependent`);
    await rctx.close();
  }

  // The name and the links are the page's whole job on first sight, so they are
  // above the fold at EVERY viewport, and the hero is never taller than the
  // screen it is meant to be exactly as tall as. Extremes included, because the
  // gutter is derived from the width and the height is what it has to fit in.
  {
    const sizes = [[320, 480], [390, 844], [667, 375], [768, 1024],
                   [1280, 800], [1440, 900], [2560, 1440], [1440, 300]];
    const bad = [];
    for (const [w, h] of sizes) {
      const vctx = await browser.newContext({ viewport: { width: w, height: h }, serviceWorkers: 'block' });
      const vpage = await vctx.newPage();
      await vpage.goto(BASE + '/?seed=7&still'); await vpage.waitForTimeout(500);
      const r = await vpage.evaluate(() => {
        const R = e => { const b = e.getBoundingClientRect(); return { t: Math.round(b.top), b: Math.round(b.bottom) }; };
        const hero = document.querySelector('.hero');
        return { h1: R(document.querySelector('h1')), lk: R(document.querySelector('.hero-links')),
                 heroH: Math.round(hero.getBoundingClientRect().height), vh: innerHeight,
                 pad: Math.round(parseFloat(getComputedStyle(hero).paddingBottom)),
                 overflowX: document.documentElement.scrollWidth > innerWidth + 1 };
      });
      const seen = x => x.t >= -1 && x.b <= r.vh + 1;
      if (!seen(r.h1)) bad.push(`${w}×${h}: the name is off-fold`);
      if (!seen(r.lk)) bad.push(`${w}×${h}: the links are off-fold`);
      if (r.heroH > r.vh + 1) bad.push(`${w}×${h}: hero ${r.heroH} > viewport ${r.vh}`);
      if (Math.abs(r.vh - r.lk.b - r.pad) > 2) bad.push(`${w}×${h}: links clear the bottom by ${r.vh - r.lk.b}, not the ${r.pad} padding`);
      if (r.overflowX) bad.push(`${w}×${h}: the document is wider than the viewport`);
      await vctx.close();
    }
    bad.length ? bad.forEach(fail) : ok(`hero: name and links above the fold, bottom-anchored, at all ${sizes.length} viewports`);
  }

  // Stop moving and one bird comes to sit beside the cursor — and leaves the
  // moment you move. `?perch=` is the wait, so this takes a second rather than
  // the 45 a visitor spends earning it. Live (not `?still`): it is a flight.
  {
    const pctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const ppage = await pctx.newPage();
    await ppage.goto(BASE + '/?seed=7&perch=1');
    await ppage.waitForFunction(() => window.flock && window.flock.count > 0);
    const PX = 980, PY = 300;
    await ppage.mouse.move(PX - 40, PY - 40);
    await ppage.mouse.move(PX, PY);
    const seat = async () => ppage.evaluate(async ([x, y]) => {
      const f = await window.flock.snapshot(), c = document.getElementById('flock').getBoundingClientRect();
      let i = -1; for (let k = 0; k < f.st.length; k++) if (f.st[k] === 3) i = k;
      return { n: f.st.filter(v => v === 3).length, i,
               d: i < 0 ? null : Math.hypot(f.x[i] - (x - c.left), f.y[i] - (y - c.top)),
               v: i < 0 ? null : Math.hypot(f.vx[i], f.vy[i]) };
    }, [PX, PY]);
    await ppage.waitForTimeout(6000);          // 1 s of stillness, then the flight over
    const on = await seat();
    (on.n === 1 && on.d < 60 && on.v < 12)
      ? ok(`perch: one bird settled ${on.d.toFixed(0)}px off the cursor at ${on.v.toFixed(1)}px/s`)
      : fail(`perch: expected exactly one settled bird near the pointer, got ${JSON.stringify(on)}`);
    await ppage.mouse.move(PX + 4, PY + 3);    // …and the moment you move, it goes
    await ppage.waitForTimeout(150);
    const off = await seat();
    off.n === 0 ? ok('perch: the first movement startles it away')
                : fail(`perch: still perched after the pointer moved (${JSON.stringify(off)})`);
    await pctx.close();
  }

  // Blocked storage must not break the theme switch (Chrome with site data off
  // throws on the localStorage accessor itself).
  const sctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const spage = await sctx.newPage();
  const serrs = [];
  spage.on('pageerror', e => serrs.push(e.message));
  await spage.addInitScript(() => Object.defineProperty(window, 'localStorage', { get() { throw new DOMException('denied', 'SecurityError'); } }));
  await spage.goto(BASE + '/?seed=1&still'); await spage.waitForTimeout(400);
  await spage.click('#theme-toggle'); await spage.waitForTimeout(300);
  const sres = await spage.evaluate(() => ({ label: document.getElementById('theme-label').textContent, theme: document.documentElement.dataset.theme }));
  (sres.label === 'Dark' && sres.theme === 'dark' && !serrs.length)
    ? ok('blocked storage: theme still switches, label follows, no errors')
    : fail(`blocked storage: ${JSON.stringify(sres)} errors: ${serrs.join(' | ')}`);
  await sctx.close();
}

// --- offline: the service worker carries the whole site --------------------
console.log('\noffline');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await ctx.newPage();
  // First visit online: the SW installs, the shell precaches, and opening a
  // sheet runs one screenshot through the runtime cache.
  await page.goto(BASE + '/#unlistr', { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => caches.match('/js/flock.js').then(r => !!r), null, { timeout: 8000 });
  await page.waitForFunction(() => { const i = document.querySelector('#sheet img'); return i && i.complete && i.naturalWidth > 0; });
  // …and the screenshot must be in the WORKER's cache, not merely in the
  // browser's. Offline used to be satisfied by an `immutable` HTTP entry alone,
  // which on Pages is ten minutes rather than forever. Note what this does NOT
  // prove: whether the <img> beat the worker to control is a race, and it was
  // measured falling both ways, so this passes with `handOver` (main.js) removed
  // too. It pins the property, not the mechanism — the mechanism is there to
  // stop the property depending on who won a race on the day.
  const cached = await page.waitForFunction(
    () => caches.match('/img/archive/unlistr-1.avif').then(r => !!r), null, { timeout: 8000 }
  ).then(() => true).catch(() => false);
  cached ? ok('offline: the sheet screenshot is in the worker\'s own cache')
         : fail('offline: the screenshot is only in the HTTP cache — the worker never saw it');
  // Now the network dies. The reload must still be the entire site.
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'load' });
  const h1 = await page.evaluate(() => document.querySelector('h1')?.textContent);
  h1 === 'Jugal Manjeshwar' ? ok('offline: the page is served from cache') : fail(`offline: page broken (h1: ${h1})`);
  try {
    await page.waitForFunction(() => window.flock && window.flock.fps > 0, null, { timeout: 8000 });
    ok('offline: the flock flies (worker + assets from cache)');
  } catch { fail('offline: the flock never drew a frame'); }
  const sheet = await page.evaluate(() => {
    const img = document.querySelector('#sheet img');
    return { open: document.getElementById('sheet').open, img: !!(img && img.complete && img.naturalWidth > 0) };
  });
  (sheet.open && sheet.img) ? ok('offline: the sheet opens with its screenshot') : fail(`offline: sheet ${JSON.stringify(sheet)}`);
  await ctx.setOffline(false);
  await ctx.close();
}

// --- deploy: the next visit runs on the new assets ---------------------------
// Navigations are network-first and assets stale-while-revalidate, and those two
// rules alone put a returning visitor's first visit after a deploy on the new
// page with the OLD stylesheet and scripts. sw.js now treats a changed page ETag
// as a deploy and refreshes the shell before answering. Proved here against a
// throwaway server that can change its files mid-run, the way a deploy does:
// install, precache, "deploy" a stylesheet with one new rule (and a new page
// ETag, as any deploy gives index.html), visit ONCE, read the rule.
console.log('\ndeploy');
{
  const ROOT = new URL('../', import.meta.url).pathname;
  const TYPES = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.txt': 'text/plain', '.xml': 'application/xml' };
  const override = new Map();
  const srv = createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
    let body; try { body = readFileSync(ROOT + p); } catch { res.writeHead(404); return res.end(); }
    if (override.has(p)) body = Buffer.from(override.get(p));
    const etag = '"' + createHash('sha1').update(body).digest('hex').slice(0, 16) + '"';
    const h = { 'Content-Type': TYPES[p.slice(p.lastIndexOf('.'))] || 'application/octet-stream', 'Cache-Control': 'max-age=600', ETag: etag };
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, h); return res.end(); }
    h['Content-Length'] = body.length; res.writeHead(200, h); res.end(body);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'allow' });
  const page = await ctx.newPage();
  await page.goto(base + '/', { waitUntil: 'load' });
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.waitForFunction(() => caches.match('/css/style.css').then(r => !!r), null, { timeout: 8000 });
  override.set('/css/style.css', readFileSync(ROOT + 'css/style.css', 'utf8') + '\n.deploy-probe { display: none; }\n');
  override.set('/index.html', readFileSync(ROOT + 'index.html', 'utf8').replace('</head>', '<!-- deployed --></head>'));
  await page.goto(base + '/', { waitUntil: 'load' });
  const fresh = await page.evaluate(() => [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText === '.deploy-probe'); } catch { return false; } }));
  fresh ? ok('deploy: one visit after a deploy, the page runs on the new stylesheet') : fail('deploy: the page ran on last deploy\'s stylesheet');
  await ctx.close(); srv.close();
}

const loaded = { home: [], notFound: [] };   // filled by the budget section, read by mirrors
// --- budget ---------------------------------------------------------------
console.log('\nbudget');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  const sizes = [];
  page.on('response', async r => {
    const u = r.url(); if (!u.startsWith(BASE)) return;
    try { const body = await r.body(); const gz = gzipSync(body).length; sizes.push({ u: u.replace(BASE, ''), raw: body.length, gz }); } catch {}
  });
  await page.goto(BASE + '/?seed=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(500);
  const firstLoad = sizes.filter(s => !s.u.includes('/img/archive/'));
  loaded.home = firstLoad.map(s => s.u.replace(/\?.*$/, ''));
  // The 404's own load, remembered for the shell check — it is precached too.
  await page.goto(BASE + '/404.html?seed=1', { waitUntil: 'networkidle' }); await page.waitForTimeout(300);
  loaded.notFound = sizes.filter(s => !firstLoad.includes(s)).map(s => s.u.replace(/\?.*$/, ''));
  const total = firstLoad.reduce((a, s) => a + Math.min(s.raw, s.gz), 0);
  firstLoad.forEach(s => console.log(`     ${String(Math.min(s.raw, s.gz)).padStart(6)} B  ${s.u}`));
  total < 100 * 1024 ? ok(`first load ${(total / 1024).toFixed(1)} KB (gzip) < 100 KB`) : fail(`first load ${(total / 1024).toFixed(1)} KB ≥ 100 KB`);
  await ctx.close();
}

// --- mirrors: what the code keeps in two places, held together ---------------
// A "must match" comment is a promise nobody checks. Each of these was such a
// comment; each is now recomputed from the served files, in the manner of the
// CSP hash above, so drift fails here instead of on someone's screen.
console.log('\nmirrors');
{
  const text = async (p) => (await fetch(BASE + p)).text();
  const [mainJs, css, sw, html] = await Promise.all(['/js/main.js', '/css/style.css', '/sw.js', '/'].map(text));
  const code = (js) => js.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

  // 1. The phone breakpoint: one constant in main.js, one query in style.css, no other number.
  const jsQ = mainJs.match(/const PHONE = '([^']+)'/)?.[1];
  // Every max-width query is the phone; a min-width one is a different fact (the wide desk) with no JS twin.
  const cssQ = [...new Set([...css.matchAll(/@media \((max-width: \d+px)\)/g)].map(m => m[1]))];
  const strays = (code(mainJs).match(/\b(699|700)\b/g) || []).length - 1;   // PHONE itself is one
  if (!jsQ) fail('breakpoint: main.js has no PHONE constant');
  else if (cssQ.length !== 1 || cssQ[0] !== jsQ.slice(1, -1)) fail(`breakpoint: main.js says ${jsQ}, style.css says ${cssQ.join(', ') || 'nothing'}`);
  else if (strays > 0) fail(`breakpoint: main.js still has ${strays} literal 699/700 outside PHONE`);
  else ok(`breakpoint: ${jsQ} — one copy in main.js, the same query in style.css`);

  // 2. The flock's colour: hue.js computes what --flock in style.css resolves to.
  for (const scheme of ['light', 'dark']) {
    const ctx = await browser.newContext({ viewport: { width: 1000, height: 700 }, colorScheme: scheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?seed=1&still&hue=200', { waitUntil: 'load' }); await page.waitForTimeout(400);
    const got = await page.evaluate(() => {
      const c = getComputedStyle(document.querySelector('.still')).color;
      const x = document.createElement('canvas').getContext('2d'); x.fillStyle = c; x.fillRect(0, 0, 1, 1);
      return [...x.getImageData(0, 0, 1, 1).data].slice(0, 3);
    });
    const want = flockColor(scheme === 'dark', 200).match(/[0-9a-f]{2}/g).map(h => parseInt(h, 16));
    const off = Math.max(...got.map((v, i) => Math.abs(v - want[i])));
    off <= 3 ? ok(`flock colour (${scheme}): CSS rgb(${got}) = hue.js rgb(${want})`) : fail(`flock colour (${scheme}): CSS rgb(${got}) vs hue.js rgb(${want})`);
    await ctx.close();
  }

  // 3. The service worker's shell: exactly what the two pages load, plus the favicon
  //    (headless Chromium never fetches one — the icon link is checked instead).
  const shell = [...(sw.match(/const SHELL = \[([\s\S]*?)\];/)?.[1] || '').matchAll(/'([^']+)'/g)].map(m => m[1]);
  const icon = html.match(/<link rel="icon" href="([^"]+)"/)?.[1];
  const pages = new Set([...loaded.home, ...loaded.notFound].filter(u => u !== '/sw.js' && !u.includes('/img/archive/')));
  const missing = [...pages].filter(u => !shell.includes(u));
  const extra = shell.filter(u => !pages.has(u) && u !== '/' + icon);
  if (!shell.length) fail('shell: could not read SHELL from sw.js');
  else if (missing.length) fail(`shell: the pages load ${missing.join(', ')} but sw.js does not precache it`);
  else if (extra.length) fail(`shell: sw.js precaches ${extra.join(', ')}, which neither page loads`);
  else ok(`shell: ${shell.length} entries = the two pages' loads + the favicon (${icon})`);

  // 4. The font weight range: fonts.mjs clips the axis to what style.css asks for.
  const wght = readFileSync(new URL('./fonts.mjs', import.meta.url), 'utf8').match(/WGHT = \{ min: (\d+), max: (\d+) \}/);
  const faces = [...css.matchAll(/@font-face \{[^}]*font-weight: (\d+) (\d+)/g)].map(m => [+m[1], +m[2]]);
  const used = [...css.replace(/@font-face \{[^}]*\}/g, '').matchAll(/font-weight: (\d+)/g)].map(m => +m[1]);
  if (!wght) fail('weights: fonts.mjs has no WGHT range');
  else {
    const [min, max] = [+wght[1], +wght[2]];
    const badFace = faces.filter(([a, b]) => a !== min || b !== max);
    const badUse = used.filter(w => w < min || w > max);
    if (faces.length < 2 || badFace.length) fail(`weights: @font-face ranges ${JSON.stringify(faces)} vs fonts.mjs ${min}–${max}`);
    else if (badUse.length) fail(`weights: style.css asks for ${badUse.join(', ')}, outside the subset's ${min}–${max}`);
    else ok(`weights: ${min}–${max} in fonts.mjs, both @font-face blocks, and every use (${[...new Set(used)].join(', ')})`);
  }
}

// --- pages: what the sitemap promises, each page keeps ------------------------
// A search engine or a language model reads the sitemap, then each page's title,
// description, canonical and structured data. Two of the four pages are other
// repos' deploys, reached live; this repo's two are read from the served files,
// and the date the sitemap claims for each is held to the date git last touched it
// — so a change to index.html that forgets the sitemap fails here, not in a crawl.
console.log('\npages');
{
  const LIVE = 'https://jugalm.com';
  const sitemap = await (await fetch(BASE + '/sitemap.xml')).text();
  const owned = { '/': 'index.html', '/2013/': '2013/' };
  const root = new URL('../', import.meta.url).pathname;
  for (const m of sitemap.matchAll(/<url><loc>([^<]+)<\/loc>(?:<lastmod>([^<]+)<\/lastmod>)?/g)) {
    const loc = m[1], lastmod = m[2], path = new URL(loc).pathname, local = path in owned;
    const res = await fetch((local ? BASE : LIVE) + path);
    if (!res.ok) { fail(`pages: ${loc} answers ${res.status}`); continue; }
    const html = await res.text();
    const missing = [];
    if (!/<title>[^<]+<\/title>/.test(html)) missing.push('title');
    if (!/<meta\s+name="description"\s+content="[^"]+"/.test(html.replace(/\s+/g, ' '))) missing.push('description');
    if (!html.replace(/\s+/g, ' ').includes(`<link rel="canonical" href="${loc}"`)) missing.push('canonical = ' + loc);
    if (!/application\/ld\+json/.test(html)) missing.push('JSON-LD');
    if (!lastmod) missing.push('lastmod in the sitemap');
    if (local && lastmod) {
      // An uncommitted change counts as today's: the commit this gate guards is the one that will carry it.
      const dirty = execSync(`git status --porcelain -- ${owned[path]}`, { cwd: root }).toString().trim();
      const touched = dirty ? new Date().toISOString().slice(0, 10) : execSync(`git log -1 --format=%cs -- ${owned[path]}`, { cwd: root }).toString().trim();
      if (touched && touched !== lastmod) missing.push(`lastmod ${lastmod} but git last touched it ${touched}`);
    }
    missing.length ? fail(`pages: ${loc} lacks ${missing.join(', ')}`) : ok(`pages: ${loc} — title, description, canonical, JSON-LD, lastmod ${lastmod}${local ? ' = git' : ''}`);
  }
}

// --- Lighthouse -----------------------------------------------------------
console.log('\nlighthouse');
for (const formFactor of ['desktop', 'mobile']) {
  const r = await lighthouse(BASE + '/', {
    port: 9222, output: 'json', logLevel: 'silent',
    onlyCategories: ['performance', 'accessibility', 'best-practices', 'seo'],
    formFactor,
    screenEmulation: formFactor === 'desktop' ? { mobile: false, width: 1440, height: 900, deviceScaleFactor: 1, disabled: false } : LH.screenEmulationMetrics.mobile,
    throttling: formFactor === 'desktop' ? LH.throttling.desktopDense4G : LH.throttling.mobileSlow4G,
    emulatedUserAgent: formFactor === 'desktop' ? LH.userAgents.desktop : LH.userAgents.mobile,
  });
  const cats = r.lhr.categories;
  const scores = Object.fromEntries(Object.entries(cats).map(([k, v]) => [k, Math.round(v.score * 100)]));
  const line = Object.entries(scores).map(([k, v]) => `${k} ${v}`).join(' · ');
  const min = Math.min(...Object.values(scores));
  min === 100 ? ok(`${formFactor}: ${line}`) : fail(`${formFactor}: ${line}`);
  if (min < 100) for (const [k, v] of Object.entries(cats)) if (v.score < 1) {
    const bad = v.auditRefs.map(a => r.lhr.audits[a.id]).filter(a => a.score !== null && a.score < 1 && a.scoreDisplayMode !== 'informative');
    bad.forEach(a => console.log(`     - [${k}] ${a.id}: ${a.displayValue || ''} ${a.title}`));
  }
  const m = r.lhr.audits.metrics?.details?.items?.[0];
  if (m) console.log(`     FCP ${m.firstContentfulPaint}ms · LCP ${m.largestContentfulPaint}ms · TBT ${m.totalBlockingTime}ms · CLS ${m.cumulativeLayoutShift}`);
}

await browser.close();
finish('all green');
