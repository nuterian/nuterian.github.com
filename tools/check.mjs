/*
 * check.mjs — the quality gate. Fails (exit 1) if the site drops below the bar:
 *   • axe-core: zero violations, light & dark, desktop & phone, home + open sheet + 404
 *   • Lighthouse: 100 / 100 / 100 / 100 (perf, a11y, best-practices, seo) on desktop & mobile
 *   • Budget: first load (HTML + CSS + JS + fonts + favicon) < 100 KB over the wire (gzip)
 *   • Console: no errors, no failed requests, no third-party requests except the
 *     first-party count beacon (stats.jugalm.com — see js/count.js)
 *   • Motion: prefers-reduced-motion renders a still (no animation frames)
 * Usage: node check.mjs [baseURL]   (default http://localhost:4173)
 */
import { chromium, devices } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import lighthouse from 'lighthouse';
import * as LH from 'lighthouse/core/config/constants.js';
import { gzipSync } from 'node:zlib';
import { mkdirSync } from 'node:fs';

const BASE = process.argv[2] || 'http://localhost:4174';
const OUT = process.env.OUT || new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });
let failures = 0;
const fail = (m) => { failures++; console.log('  ✗', m); };
const ok = (m) => console.log('  ✓', m);

const browser = await chromium.launch({ args: ['--remote-debugging-port=9222'] });

// --- axe ------------------------------------------------------------------
console.log('\naxe');
for (const scheme of ['light', 'dark']) {
  for (const [label, opts] of [['desktop', { viewport: { width: 1440, height: 900 } }], ['phone', devices['iPhone 13']]]) {
    const ctx = await browser.newContext({ ...opts, colorScheme: scheme, serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    const thirdParty = [];
    // stats.jugalm.com is ours — Umami on our own box, named here rather than
    // switching the check off, so anything ELSE that ever phones home still fails.
    const COUNT_ORIGIN = 'https://stats.jugalm.com';
    page.on('request', r => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:') && !r.url().startsWith(COUNT_ORIGIN)) thirdParty.push(r.url()); });
    page.on('requestfailed', r => errors.push('request failed ' + r.url()));

    for (const path of ['/', '/#kidscerts', '/404.html']) {
      await page.goto(BASE + path + (path.includes('#') ? '' : '?seed=1'), { waitUntil: 'networkidle' });
      await page.waitForTimeout(700);
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa', 'best-practice']).analyze();
      const v = res.violations;
      if (v.length) { fail(`${scheme}/${label} ${path}: ${v.length} violation(s)`); v.forEach(x => console.log('     -', x.id, x.impact, x.nodes.length, 'node(s):', x.nodes[0]?.html?.slice(0, 100))); }
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
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await page.goto(BASE + '/?seed=1'); await page.waitForTimeout(1200);
  const a = await page.screenshot({ fullPage: false }); await page.waitForTimeout(800);
  const b = await page.screenshot({ fullPage: false });
  if (Buffer.compare(a, b) === 0) ok('reduced motion: frame is still'); else fail('reduced motion: the canvas is animating');
  await ctx.close();
}

// --- no script ------------------------------------------------------------
console.log('\nno script');
{
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
  const page = await ctx.newPage();
  await page.goto(BASE + '/#unlistr'); await page.waitForTimeout(300);
  const stillVisible = await page.evaluate(() => getComputedStyle(document.querySelector('.still')).display !== 'none');
  const sheetVisible = await page.evaluate(() => getComputedStyle(document.getElementById('unlistr')).display !== 'none');
  stillVisible ? ok('no-js: inline still is shown') : fail('no-js: still hidden');
  sheetVisible ? ok('no-js: #unlistr opens via :target') : fail('no-js: sheet does not open');
  await page.screenshot({ path: `${OUT}/nojs.png` });
  await ctx.close();
}

// --- behaviours that shipped as screenshots — pinned here so tuning can't
// silently undo them. All on ?still&mainthread: the sim is stepped by hand,
// so each check is deterministic and takes milliseconds, not settle-time.
console.log('\nbehaviours');
{
  const still = async (page, url, steps = 300) => {
    await page.goto(BASE + url); await page.waitForFunction(() => window.flock?._runner);
    await page.evaluate((n) => { const r = window.flock._runner; for (let i = 0; i < n; i++) r.flock.advance(1 / 60); }, steps);
    return page;
  };
  // A landscape phone is all words: the mark stands down (homeOut), and comes
  // back when the viewport turns portrait again.
  const ctx = await browser.newContext({ viewport: { width: 667, height: 375 }, serviceWorkers: 'block' });
  const page = await ctx.newPage();
  await still(page, '/?seed=7&still&mainthread');
  const out = await page.evaluate(() => ({ box: window.flock._runner.flock.homeBox, out: window.flock._runner.flock.homeOut }));
  (out.out && out.box === null) ? ok('landscape: mark stands down (homeOut, no box)') : fail(`landscape: mark did not stand down (${JSON.stringify(out)})`);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(250); // let resize re-measure, then step the sim
  await page.evaluate(() => { const r = window.flock._runner; for (let i = 0; i < 300; i++) r.flock.advance(1 / 60); });
  const back = await page.evaluate(() => window.flock._runner.flock.homeBox);
  back ? ok('portrait: the mark returns') : fail('portrait: the mark never came back');
  // Phones fly the thinned grid (102 points), desktop the full 208.
  const pts = await page.evaluate(() => window.flock._runner.flock.home.points.length / 2);
  pts === 102 ? ok(`phone mark: thinned grid (${pts} points)`) : fail(`phone mark: expected 102 points, got ${pts}`);
  await ctx.close();
  const dctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
  const dpage = await dctx.newPage();
  await still(dpage, '/?seed=7&still&mainthread', 60);
  const dpts = await dpage.evaluate(() => window.flock._runner.flock.home.points.length / 2);
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
    await ppage.goto(BASE + '/?seed=7&perch=1&mainthread');
    await ppage.waitForFunction(() => window.flock?._runner?.flock);
    const PX = 980, PY = 300;
    await ppage.mouse.move(PX - 40, PY - 40);
    await ppage.mouse.move(PX, PY);
    const seat = async () => ppage.evaluate(([x, y]) => {
      const f = window.flock._runner.flock, c = document.getElementById('flock').getBoundingClientRect();
      let i = -1; for (let k = 0; k < f.n; k++) if (f.st[k] === 3) i = k;
      return { n: [...f.st].filter(v => v === 3).length, i,
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
  const total = firstLoad.reduce((a, s) => a + Math.min(s.raw, s.gz), 0);
  firstLoad.forEach(s => console.log(`     ${String(Math.min(s.raw, s.gz)).padStart(6)} B  ${s.u}`));
  total < 100 * 1024 ? ok(`first load ${(total / 1024).toFixed(1)} KB (gzip) < 100 KB`) : fail(`first load ${(total / 1024).toFixed(1)} KB ≥ 100 KB`);
  await ctx.close();
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
console.log(failures ? `\n${failures} failure(s)` : '\nall green');
process.exit(failures ? 1 : 0);
