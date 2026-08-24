// Renders one seeded frame of the flock as inline SVG and writes it into
// index.html between <!--STILL--> markers. This is what you see with script off.
import { readFile, writeFile } from 'node:fs/promises';
import { Flock, STEP, MARK, MARK_ASPECT, wingTips } from '../js/flock.js';

// The canvas box, matching style.css (#flock: viewport + 90px bleed). Only
// the mark's SIZE is set here (== main.js homeSize()) — WHERE it sits is the
// placement solver's job, same as at runtime: it finds the whitespace above
// the hero text obstacle and glides there on its own over the 900 steps below.
const W = 1620, H = 1080;
const f = new Flock({ width: W, height: H, count: 200, seed: 2013 });
const bw = Math.min(W * 0.42, 620);
f.obstacles = [{ x: 100, y: 690, w: 560, h: 260 }]; // roughly the hero text
f.setHome(MARK, MARK_ASPECT, { w: bw, h: bw / MARK_ASPECT });
for (let i = 0; i < 900; i++) f._step(STEP);

let lines = '';
for (let i = 0; i < f.n; i++) {
  const sp = Math.hypot(f.vx[i], f.vy[i]);
  const ux = sp > 0.01 ? f.vx[i] / sp : Math.cos(f.ph[i]);
  const uy = sp > 0.01 ? f.vy[i] / sp : Math.sin(f.ph[i]);
  const [lx, ly, rx, ry] = wingTips(ux, uy, sp, f.fp[i]);
  const o = (0.35 + f.op[i] * 0.6).toFixed(2);
  const pts = `${(f.x[i] + lx).toFixed(1)},${(f.y[i] + ly).toFixed(1)} ${f.x[i].toFixed(1)},${f.y[i].toFixed(1)} ${(f.x[i] + rx).toFixed(1)},${(f.y[i] + ry).toFixed(1)}`;
  lines += `<polyline points="${pts}" opacity="${o}"/>`;
}
const svg = `<svg class="still" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${lines}</svg>`;

const path = new URL('../index.html', import.meta.url);
let html = await readFile(path, 'utf8');
const re = /<!--STILL-->[\s\S]*?<!--\/STILL-->|<!--STILL-->/;
html = html.replace(re, `<!--STILL-->\n${svg}\n<!--/STILL-->`);
await writeFile(path, html);
console.log(`still: ${f.n} strokes, ${svg.length} bytes`);
