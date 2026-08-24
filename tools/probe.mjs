// Isolate what actually costs: canvas area, DPR, or something else entirely.
// Runs the same scroll+idle journey under configurations that vary ONE thing.
import { chromium } from 'playwright';
const throttle = +(process.argv[2] || 4);

const configs = [
  ['control: no canvas at all', '?seed=7&nocanvas'],
  ['current: full hero @2x',    '?seed=7'],
  ['half-height hero @2x',      '?seed=7&fh=560'],
  ['full hero @1x',             '?seed=7&fdpr=1'],
  ['half-height @1x',           '?seed=7&fh=560&fdpr=1'],
  ['full hero @2x, 40 birds',   '?seed=7&n=40'],
];

const browser = await chromium.launch();
console.log(`\nprobe — ${throttle}x CPU throttle · 1600x1000 @2x device\n`);
console.log('configuration                 idle p95   scroll p95  scroll mean  >34ms');
for (const [name, q] of configs) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.addInitScript(() => {
    window.__f = []; let last = 0;
    const loop = t => { if (last) window.__f.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
  await page.goto('http://localhost:4174/' + q, { waitUntil: 'load' });
  if (q.includes('nocanvas')) await page.evaluate(() => { const c = document.getElementById('flock'); c.style.display = 'none'; });
  await page.waitForTimeout(4000);
  const grab = async () => { const f = await page.evaluate(() => { const x = window.__f.slice(); window.__f.length = 0; return x; }); f.sort((a,b)=>a-b); return f; };
  await grab(); await page.waitForTimeout(2500);
  const idle = await grab();
  for (let k = 0; k < 3; k++) {
    await cdp.send('Input.synthesizeScrollGesture', { x: 800, y: 500, xDistance: 0, yDistance: -700, speed: 1200 });
    await cdp.send('Input.synthesizeScrollGesture', { x: 800, y: 500, xDistance: 0, yDistance: 700, speed: 1200 });
  }
  const scr = await grab();
  const q95 = a => a.length ? a[Math.min(a.length-1,(a.length*0.95)|0)] : 0;
  const mean = a => a.reduce((x,y)=>x+y,0)/(a.length||1);
  const over = a => a.filter(x=>x>34).length/(a.length||1)*100;
  console.log(`${name.padEnd(28)} ${q95(idle).toFixed(1).padStart(8)} ${q95(scr).toFixed(1).padStart(11)} ${mean(scr).toFixed(1).padStart(12)} ${over(scr).toFixed(1).padStart(6)}%`);
  await ctx.close();
}
await browser.close();
