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
import { tally, watch, axeSettled, printViolations, stillFrame, noScript, DESKTOP } from './lib.mjs';

const BASE = process.argv[2] || 'http://localhost:4174';
const { ok, fail, finish } = tally();

for (const [name, type] of [['webkit', webkit], ['firefox', firefox]]) {
  console.log(`\n${name}`);
  const browser = await type.launch();

  // --- the page runs: no errors, no third parties, and a live flock -------
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    const { errors, thirdParty } = watch(page, BASE);
    await page.goto(BASE + '/?seed=1', { waitUntil: 'networkidle' });
    // The flock is alive when frames are being drawn, whichever path drew them.
    let where = 'never started';
    try {
      await page.waitForFunction(() => window.flock && window.flock.fps > 0, null, { timeout: 8000 });
      where = await page.evaluate(() => window.flock.where);
      ok(`flock alive · ${where}`);
    } catch { where = await page.evaluate(() => window.flock?.where).catch(() => where); fail(`flock never drew a frame (renderer: ${where})`); }
    errors.length ? fail(`errors: ${errors.join(' | ')}`) : ok('no console/page/request errors');
    if (thirdParty.length) fail(`third-party requests: ${thirdParty.join(', ')}`);

    // --- axe, light and dark, on the engine's own rendering ---------------
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      // On the settled design, transitions frozen — see lib.mjs for the CI failure that taught it.
      const res = await axeSettled(page, ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
      if (res.violations.length) { fail(`axe ${scheme}: ${res.violations.map(v => v.id).join(', ')}`); printViolations(res.violations); }
      else ok(`axe ${scheme}: 0 violations`);
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
  (await stillFrame(browser, BASE)) ? ok('reduced motion: frame is still') : fail('reduced motion: something animates');

  // --- no script: the still and the :target sheet -------------------------
  {
    const { still, sheet } = await noScript(browser, BASE);
    still ? ok('no-js: inline still is shown') : fail('no-js: still hidden');
    sheet ? ok('no-js: #unlistr opens via :target') : fail('no-js: sheet does not open');
  }

  // --- the 404 flies too --------------------------------------------------
  {
    const ctx = await browser.newContext(DESKTOP);
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/404.html'); await page.waitForTimeout(1500);
    errors.length ? fail(`404: ${errors.join(' | ')}`) : ok('404 runs clean');
    await ctx.close();
  }

  await browser.close();
}

finish('both engines green');
