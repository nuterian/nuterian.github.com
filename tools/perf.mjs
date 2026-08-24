// Journey performance benchmark. Measures what a user feels: main-thread
// frame times (rAF deltas) and long tasks, through the common journeys.
// Headless WebGL is software (SwiftShader), so absolute numbers are
// pessimistic vs real hardware; budgets are set for that floor and the run
// fails loudly on regressions. Usage: node perf.mjs [--throttle 4]
import { chromium } from 'playwright';

const throttle = process.argv.includes('--throttle') ? +process.argv[process.argv.indexOf('--throttle') + 1] : 0;
const budgets = throttle
  ? { p95: 40, over34: 12, longScroll: 2 }   // 4× throttled: a low-end laptop
  : { p95: 34, over34: 2, longScroll: 0 };   // unthrottled headless (software GL drops the odd frame; the tail and long tasks are the real tripwires)

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
await page.addInitScript(() => {
  window.__frames = []; window.__long = [];
  try { new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] }); } catch {}
  let last = 0;
  const loop = t => { if (last) window.__frames.push(t - last); last = t; requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
});
const cdp = await ctx.newCDPSession(page);
if (throttle) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });

const reset = () => page.evaluate(() => { window.__frames.length = 0; window.__long.length = 0; });
const stats = async (name) => {
  const { f, l } = await page.evaluate(() => ({ f: window.__frames.slice(), l: window.__long.slice() }));
  f.sort((a, b) => a - b);
  const q = p => f.length ? f[Math.min(f.length - 1, (f.length * p) | 0)] : 0;
  const over = ms => f.filter(x => x > ms).length / (f.length || 1) * 100;
  return { name, frames: f.length, mean: f.reduce((a, b) => a + b, 0) / (f.length || 1), p95: q(0.95), max: f.length ? f[f.length - 1] : 0, over17: over(17.5), over34: over(34), long: l.length, longWorst: Math.max(0, ...l) };
};
const scroll = (dy, speed = 1600) => cdp.send('Input.synthesizeScrollGesture', { x: 800, y: 500, xDistance: 0, yDistance: dy, speed });

const rows = [];
// Journey 1: load & settle.
await page.goto('http://localhost:4174/?seed=7', { waitUntil: 'load' });
await reset(); await page.waitForTimeout(6000);
rows.push(await stats('settle (idle on hero)'));
// Journey 2: scroll to the footer and back, wheel-style.
await reset();
await scroll(-1400); await scroll(-1400); await page.waitForTimeout(200);
await scroll(1400); await scroll(1400); await page.waitForTimeout(200);
rows.push(await stats('scroll down + back'));
// Journey 3: pointer sweep through the mark (flock scatters).
await reset();
for (let k = 0; k < 3; k++) { await page.mouse.move(300, 250, { steps: 15 }); await page.mouse.move(1300, 450, { steps: 25 }); }
await page.waitForTimeout(300);
rows.push(await stats('pointer sweep (scatter)'));
// Journey 4: archive — open a sheet, scroll it, step through, close.
await reset();
await scroll(-1200); await page.locator('.row[data-slug="kidscerts"]').click(); await page.waitForTimeout(500);
await scroll(-800); await page.keyboard.press('ArrowRight'); await page.waitForTimeout(400);
await page.keyboard.press('Escape'); await page.waitForTimeout(400);
rows.push(await stats('archive open/browse/close'));

const flock = await page.evaluate(() => ({ where: window.flock?.where, n: window.flock?.count, fps: window.flock?.fps }));
await browser.close();

console.log(`\nperf — ${throttle ? throttle + 'x CPU throttle' : 'unthrottled'} · 1600×1000 @2x · renderer: ${flock.where} · birds: ${flock.n} · sim fps: ${flock.fps}`);
console.log('journey                      frames  mean   p95    max   >17ms  >34ms  longtasks');
let fail = 0;
for (const r of rows) {
  const bad = r.p95 > budgets.p95 || r.over34 > budgets.over34 || (r.name.startsWith('scroll') && r.long > budgets.longScroll);
  if (bad) fail++;
  console.log(`${bad ? '✗' : '✓'} ${r.name.padEnd(26)} ${String(r.frames).padStart(5)} ${r.mean.toFixed(1).padStart(6)} ${r.p95.toFixed(1).padStart(6)} ${r.max.toFixed(0).padStart(6)} ${r.over17.toFixed(1).padStart(6)}% ${r.over34.toFixed(1).padStart(5)}% ${String(r.long).padStart(5)}${r.long ? ` (worst ${r.longWorst}ms)` : ''}`);
}
console.log(fail ? `\n${fail} journey(s) over budget (p95 ≤ ${budgets.p95}ms, >34ms ≤ ${budgets.over34}%)` : '\nall journeys within budget');
process.exit(fail ? 1 : 0);
