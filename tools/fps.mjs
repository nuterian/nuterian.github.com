// Measures the frame rate the flock actually achieves — the number the user
// sees — across worker/main-thread and canvas configurations.
import { chromium } from 'playwright';
const configs = [
  ['worker · small canvas @1.5x', '?seed=7'],
  ['main   · small canvas @1.5x', '?seed=7&mainthread'],
  ['worker · small canvas @2x',   '?seed=7&fdpr=2'],
  ['worker · 600 birds',          '?seed=7&n=600'],
];
const browser = await chromium.launch();
console.log('\nflock frame rate — 1600x1000 @2x device\n');
console.log('configuration                 draws/s  main-rAF/s  birds');
for (const [name, q] of configs) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => { window.__r = 0; const l = () => { window.__r++; requestAnimationFrame(l); }; requestAnimationFrame(l); });
  await page.goto('http://localhost:4174/' + q, { waitUntil: 'load' });
  await page.waitForTimeout(3000);
  const a = await page.evaluate(() => ({ r: window.__r, t: performance.now() }));
  await page.waitForTimeout(3000);
  const b = await page.evaluate(() => ({ r: window.__r, t: performance.now(), fps: window.flock?.fps, n: window.flock?.count }));
  console.log(`${name.padEnd(28)} ${String(b.fps ?? '-').padStart(7)} ${(((b.r - a.r) / (b.t - a.t)) * 1000).toFixed(1).padStart(11)} ${String(b.n ?? '-').padStart(6)}`);
  await ctx.close();
}
await browser.close();
