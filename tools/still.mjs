// Renders one seeded frame of the flock as inline SVG and writes it into
// index.html between <!--STILL--> markers. This is what you see with script off.
import { readFile, writeFile } from 'node:fs/promises';
import { Flock, STEP, MARK, MARK_ASPECT, wingTips } from '../js/flock.js';

// The canvas box, matching style.css (#flock: min(92vw,1040) x min(52vh,660)).
const W = 1040, H = 520;
const f = new Flock({ width: W, height: H, count: 200, seed: 2013 });
const bw = Math.min(W * 0.66, H * 0.66 * MARK_ASPECT), bh = bw / MARK_ASPECT; // == main.js homeBox()
let sx = 0, sy = 0; for (let i = 0; i < MARK.length; i += 2) { sx += MARK[i]; sy += MARK[i + 1]; }
const cx = sx / (MARK.length / 2) / 100, cy = sy / (MARK.length / 2) / 100;
f.setHome(MARK, MARK_ASPECT, { x: W / 2 - bw * cx, y: H / 2 - bh * cy, w: bw, h: bh });
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
