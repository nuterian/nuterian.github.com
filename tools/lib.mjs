/*
 * lib.mjs — what the gates share.
 *
 * check.mjs (Chromium: the bar) and engines.mjs (WebKit and Firefox: does it
 * work) had grown separate copies of the same checks, and the copies had
 * already disagreed once — one froze transitions before axe, the other leaned
 * on a wait. One copy of each now: the tally, the errors and third parties
 * watched per page, axe on the settled design, the reduced-motion still, the
 * no-script still and its :target sheet. Not a command; imported.
 */
import AxeBuilder from '@axe-core/playwright';

// stats.jugalm.com is ours — Umami on our own box — allowed here rather than
// switching the third-party check off, so anything ELSE that phones home fails.
export const COUNT_ORIGIN = 'https://stats.jugalm.com';
export const DESKTOP = { viewport: { width: 1440, height: 900 } };

export function tally() {
  let failures = 0;
  return {
    ok: (m) => console.log('  ✓', m),
    fail: (m) => { failures++; console.log('  ✗', m); },
    finish: (green) => { console.log(failures ? `\n${failures} failure(s)` : `\n${green}`); process.exit(failures ? 1 : 0); },
  };
}

// Errors and third-party requests, collected from before the first navigation.
export function watch(page, base) {
  const errors = [], thirdParty = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('request', r => { const u = r.url(); if (!u.startsWith(base) && !u.startsWith('data:') && !u.startsWith(COUNT_ORIGIN)) thirdParty.push(u); });
  page.on('requestfailed', r => errors.push('request failed ' + r.url()));
  return { errors, thirdParty };
}

// axe on the SETTLED design. Switching the scheme on a live page starts the .4s
// theme fade, and axe walks the document over time — on a slow runner it sampled
// different elements at different points in it: an h1 at the light theme's
// #55544f and a paragraph at the dark theme's #e9e8e3, both against the same
// half-way background, a "violation" that exists in no frame anyone can stop on.
// Waiting longer only makes it rarer, so transitions are off for the pass. As a
// constructed stylesheet, not an injected <style>: the page's Content-Security-
// Policy allows no inline styles and WebKit enforces it on Playwright's
// addStyleTag too. CSSOM is not governed by CSP, and the site adopts no sheets of
// its own, so clearing the list afterwards is safe.
export async function axeSettled(page, tags) {
  await page.evaluate(() => { const s = new CSSStyleSheet(); s.replaceSync('*,*::before,*::after{transition:none!important}'); document.adoptedStyleSheets = [s]; });
  await page.waitForTimeout(250);
  const res = await new AxeBuilder({ page }).withTags(tags).analyze();
  await page.evaluate(() => { document.adoptedStyleSheets = []; });
  return res;
}

// The rule id alone is not a diagnosis. A CI run once said "color-contrast" and
// nothing else — no node, no colours — and did not reproduce on a Mac. A gate that
// cannot be read from its own log costs more than it saves, so this prints the
// element and what the rule actually measured.
export function printViolations(violations) {
  for (const v of violations) for (const n of v.nodes.slice(0, 4)) {
    console.log(`      ${v.id} · ${n.target.join(' ')}`);
    console.log(`        ${n.html.replace(/\s+/g, ' ').slice(0, 110)}`);
    const why = [...(n.any || []), ...(n.all || [])].map(c => c.message).join(' | ');
    if (why) console.log(`        ${why.replace(/\s+/g, ' ').slice(0, 220)}`);
  }
}

// Reduced motion is a still: two screenshots 800 ms apart must be the same bytes.
export async function stillFrame(browser, base, opts = {}) {
  const ctx = await browser.newContext({ ...DESKTOP, reducedMotion: 'reduce', ...opts });
  const page = await ctx.newPage();
  await page.goto(base + '/?seed=1'); await page.waitForTimeout(1200);
  const a = await page.screenshot({ fullPage: false }); await page.waitForTimeout(800);
  const b = await page.screenshot({ fullPage: false });
  await ctx.close();
  return Buffer.compare(a, b) === 0;
}

// No script: the inline still is shown, and a sheet opens on :target alone.
export async function noScript(browser, base, opts = {}, shot = null) {
  const ctx = await browser.newContext({ ...DESKTOP, javaScriptEnabled: false, ...opts });
  const page = await ctx.newPage();
  await page.goto(base + '/#unlistr'); await page.waitForTimeout(300);
  const still = await page.evaluate(() => getComputedStyle(document.querySelector('.still')).display !== 'none');
  const sheet = await page.evaluate(() => getComputedStyle(document.getElementById('unlistr')).display !== 'none');
  if (shot) await page.screenshot({ path: shot });
  await ctx.close();
  return { still, sheet };
}
