/*
 * engines.mjs — the same site, in the engines check.mjs doesn't run.
 * check.mjs proves the bar in Chromium; this proves the page *works* in
 * WebKit and Firefox — the engines where the risky dependencies actually
 * differ (OffscreenCanvas in a module worker, light-dark(), @property,
 * svh/dvh, :target with scripting off). Each engine takes whichever flock
 * path it supports; the gate asserts the outcome, not the path, and prints
 * the path so a silent fallback is at least a visible one.
 * Usage: node engines.mjs [baseURL]   (default http://localhost:4174)
 */
import { webkit, firefox } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE = process.argv[2] || 'http://localhost:4174';
let failures = 0;
const fail = (m) => { failures++; console.log('  ✗', m); };
const ok = (m) => console.log('  ✓', m);

for (const [name, type] of [['webkit', webkit], ['firefox', firefox]]) {
  console.log(`\n${name}`);
  const browser = await type.launch();

  // --- the page runs: no errors, no third parties, and a live flock -------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [], thirdParty = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('request', r => { if (!r.url().startsWith(BASE) && !r.url().startsWith('data:')) thirdParty.push(r.url()); });
    page.on('requestfailed', r => errors.push('request failed ' + r.url()));
    await page.goto(BASE + '/?seed=1', { waitUntil: 'networkidle' });
    // The flock is alive when frames are being drawn, whichever path drew them.
    let where = 'never started';
    try {
      await page.waitForFunction(() => window.flock && window.flock.fps > 0, null, { timeout: 8000 });
      where = await page.evaluate(() => window.flock.where);
      ok(`flock alive · ${where}`);
    } catch { fail(`flock never drew a frame (${where})`); }
    errors.length ? fail(`errors: ${errors.join(' | ')}`) : ok('no console/page/request errors');
    if (thirdParty.length) fail(`third-party requests: ${thirdParty.join(', ')}`);

    // --- axe, light and dark, on the engine's own rendering ---------------
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.waitForTimeout(600); // let the .4s theme transition finish — axe must measure settled colours
      const res = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
      if (res.violations.length) {
        // The rule id alone is not a diagnosis. This failed once in CI, on Linux
        // WebKit only, and said "color-contrast" and nothing else — no node, no
        // colours, and it does not reproduce on a Mac. A gate that cannot be
        // read from its own log costs more than it saves, so it prints the
        // element and what the rule actually measured.
        fail(`axe ${scheme}: ${res.violations.map(v => v.id).join(', ')}`);
        for (const v of res.violations) for (const n of v.nodes.slice(0, 4)) {
          console.log(`      ${v.id} · ${n.target.join(' ')}`);
          console.log(`        ${n.html.replace(/\s+/g, ' ').slice(0, 110)}`);
          const why = [...(n.any || []), ...(n.all || [])].map(c => c.message).join(' | ');
          if (why) console.log(`        ${why.replace(/\s+/g, ' ').slice(0, 220)}`);
        }
      } else ok(`axe ${scheme}: 0 violations`);
    }
    await page.emulateMedia({ colorScheme: 'light' }); await page.waitForTimeout(600);

    // --- the sheet journey: open, image, esc, focus restored --------------
    await page.click('.row[data-slug="unlistr"]');
    await page.waitForTimeout(600);
    const open = await page.evaluate(() => document.getElementById('sheet').open);
    open ? ok('sheet opens as a modal') : fail('sheet did not open');
    const imgOk = await page.evaluate(() => {
      const img = document.querySelector('#sheet img');
      return img && img.complete && img.naturalWidth > 0;
    });
    imgOk ? ok('sheet image decodes') : fail('sheet image failed to decode');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    const focusBack = await page.evaluate(() =>
      !document.getElementById('sheet').open && document.activeElement?.dataset?.slug === 'unlistr');
    focusBack ? ok('esc closes, focus returns to the row') : fail('esc/focus restore broke');

    // --- the theme switch actually switches -------------------------------
    await page.click('#theme-toggle');
    const dark = await page.evaluate(() => document.documentElement.dataset.theme === 'dark'
      && getComputedStyle(document.documentElement).colorScheme.includes('dark'));
    dark ? ok('theme toggle applies dark') : fail('theme toggle did not switch the scheme');
    await ctx.close();
  }

  // --- reduced motion is a still ------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' });
    const page = await ctx.newPage();
    await page.goto(BASE + '/?seed=1'); await page.waitForTimeout(1200);
    const a = await page.screenshot(); await page.waitForTimeout(800);
    const b = await page.screenshot();
    Buffer.compare(a, b) === 0 ? ok('reduced motion: frame is still') : fail('reduced motion: something animates');
    await ctx.close();
  }

  // --- no script: the still and the :target sheet -------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false });
    const page = await ctx.newPage();
    await page.goto(BASE + '/#unlistr'); await page.waitForTimeout(300);
    const still = await page.evaluate(() => getComputedStyle(document.querySelector('.still')).display !== 'none');
    const sheet = await page.evaluate(() => getComputedStyle(document.getElementById('unlistr')).display !== 'none');
    still ? ok('no-js: inline still is shown') : fail('no-js: still hidden');
    sheet ? ok('no-js: #unlistr opens via :target') : fail('no-js: sheet does not open');
    await ctx.close();
  }

  // --- the 404 flies too --------------------------------------------------
  {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/404.html'); await page.waitForTimeout(1500);
    errors.length ? fail(`404: ${errors.join(' | ')}`) : ok('404 runs clean');
    await ctx.close();
  }

  await browser.close();
}

console.log(failures ? `\n${failures} failure(s)` : '\nboth engines green');
process.exit(failures ? 1 : 0);
