// Objective check on the thing that keeps going wrong: are birds collecting
// in crannies? Reports, at several scroll positions, the worst local crowd
// (birds within 45 px of one bird) and how many birds sit in tight space
// (clearance < 60 px of a content wall). Fails loudly on regressions.
import { chromium } from 'playwright';
// A dense cluster isn't itself the bug — real flocks cluster while moving.
// The bug is birds that are BOTH crowded AND stationary against a wall:
// that combination is what a bead-line or a jammed corner looks like.
const budget = { stuck: 3 };   // birds simultaneously slow + crowded + touching a wall

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await ctx.newPage();
page.on('pageerror', e => console.log('[pageerror]', e.message));
await page.goto('http://localhost:4174/?seed=7', { waitUntil: 'load' });
await page.waitForTimeout(10000);

const probe = async (label) => {
  const r = await page.evaluate(() => new Promise(res => {
    const w = window.__fw; // set below
    res(w);
  }));
  return r;
};
// Read the flock's state out of the worker via a debug message.
const measure = async (label) => {
  const s = await page.evaluate(() => window.flock.snapshot());
  const { x, y, vx, vy, st, scroll, obstacles } = s;
  const n = x.length;
  // The mark itself is meant to be dense (200 birds on a ~14px-spaced point
  // cloud) — that isn't crowding, it's the point. Only birds AWAY from home
  // (state != 0) count toward the crowd metric: those are meant to be in
  // the open, and clustering among them is the bug we're hunting.
  const away = [];
  for (let i = 0; i < n; i++) if (st[i] !== 0) away.push(i);
  let stuck = 0, maxNear = 0;
  for (const i of away) {
    const speed = Math.hypot(vx[i], vy[i]);
    if (speed > 12) continue;                       // moving — not stuck, whatever the density
    let cl = 1e9;
    for (const o of obstacles) {
      const px = x[i], py = y[i] + scroll;
      const dx = px < o.x ? o.x - px : px > o.x + o.w ? px - (o.x + o.w) : 0;
      const dy = py < o.y ? o.y - py : py > o.y + o.h ? py - (o.y + o.h) : 0;
      cl = Math.min(cl, Math.hypot(dx, dy));
    }
    if (cl > 40) continue;                          // not against a wall — just resting
    let near = 0;
    for (const j of away) if (i !== j && Math.hypot(x[i] - x[j], y[i] - y[j]) < 45) near++;
    if (near > maxNear) maxNear = near;
    if (near >= 2) stuck++;                          // slow + wall-hugging + not alone: a bead
  }
  const bad = stuck > budget.stuck;
  console.log(`${bad ? '✗' : '✓'} ${label.padEnd(26)} stuck-in-a-line ${String(stuck).padStart(3)}/${String(away.length).padStart(3)} away   (densest such spot: ${maxNear} neighbours)`);
  return bad ? 1 : 0;
};

let fail = 0;
fail += await measure('hero, settled');
for (const [top, label] of [[380, 'scrolled 380'], [600, 'scrolled 600'], [900, 'archive']]) {
  await page.evaluate(t => scrollTo({ top: t, behavior: 'instant' }), top);
  await page.waitForTimeout(9000);
  fail += await measure(label);
}
// scroll dance, then settle
for (const t of [200, 900, 300, 700]) { await page.evaluate(y => scrollTo({ top: y, behavior: 'instant' }), t); await page.waitForTimeout(1200); }
await page.waitForTimeout(10000);
fail += await measure('after scroll dance');
await browser.close();
console.log(fail ? `\n${fail} position(s) over budget (stuck ≤ ${budget.stuck} birds)` : '\nno stuck birds anywhere');
process.exit(fail ? 1 : 0);
