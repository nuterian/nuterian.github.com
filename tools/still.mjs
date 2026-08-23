// Renders one seeded frame of the flock as inline SVG and writes it into
// index.html between <!--STILL--> markers. This is what you see with script off.
import { readFile, writeFile } from 'node:fs/promises';
import { Flock, STEP, MARK, MARK_ASPECT } from '../js/flock.js';

const W = 1440, H = 900;
const f = new Flock({ width: W, height: H, count: 200, seed: 2013 });
f.obstacles = [{ x: 80, y: 600, w: 520, h: 220 }]; // roughly where the hero text sits
const bw = 440, bh = bw / MARK_ASPECT;               // same placement as main.js homeBox()
f.setHome(MARK, MARK_ASPECT, { x: W / 2 - bw / 2, y: Math.max(bh / 2 + 28, H * 0.24) - bh / 2, w: bw, h: bh });
for (let i = 0; i < 900; i++) f._step(STEP);

let lines = '';
for (let i = 0; i < f.n; i++) {
  const sp = Math.hypot(f.vx[i], f.vy[i]) || 1;
  const len = Math.min(18, 2.5 + sp * 0.085);
  const x2 = f.x[i] - f.vx[i] / sp * len, y2 = f.y[i] - f.vy[i] / sp * len;
  const o = (0.35 + f.op[i] * 0.6).toFixed(2);
  lines += `<line x1="${f.x[i].toFixed(1)}" y1="${f.y[i].toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" opacity="${o}"/>`;
}
const svg = `<svg class="still" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid slice" aria-hidden="true" focusable="false">${lines}</svg>`;

const path = new URL('../index.html', import.meta.url);
let html = await readFile(path, 'utf8');
const re = /<!--STILL-->[\s\S]*?<!--\/STILL-->|<!--STILL-->/;
html = html.replace(re, `<!--STILL-->\n${svg}\n<!--/STILL-->`);
await writeFile(path, html);
console.log(`still: ${f.n} strokes, ${svg.length} bytes`);
