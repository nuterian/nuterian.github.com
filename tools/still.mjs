// Renders one seeded frame of the flock as inline SVG and writes it into
// index.html between <!--STILL--> markers. This is what you see with script off.
import { readFile, writeFile } from 'node:fs/promises';
import { Flock, STEP, MARK, MARK_ASPECT } from '../js/flock.js';

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

// Ask the flock for the very same geometry the live renderer draws, rather
// than a second copy of the pose maths here — the still is then the canvas's
// first frame by construction, and cannot drift from it.
f.geometry();
const { _tips: tips, _alp: alp } = f;
let lines = '';
for (let i = 0; i < f.n; i++) {
  if (alp[i] === 0) continue;                     // off-stage, same as the canvas
  const o = i * 4, x = f.x[i], y = f.y[i];
  const pts = `${(x + tips[o]).toFixed(1)},${(y + tips[o + 1]).toFixed(1)} ${x.toFixed(1)},${y.toFixed(1)} ${(x + tips[o + 2]).toFixed(1)},${(y + tips[o + 3]).toFixed(1)}`;
  lines += `<polyline points="${pts}" opacity="${alp[i].toFixed(2)}"/>`;
}
const svg = `<svg class="still" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">${lines}</svg>`;

const path = new URL('../index.html', import.meta.url);
let html = await readFile(path, 'utf8');
const re = /<!--STILL-->[\s\S]*?<!--\/STILL-->|<!--STILL-->/;
html = html.replace(re, `<!--STILL-->\n${svg}\n<!--/STILL-->`);
await writeFile(path, html);
console.log(`still: ${f.n} strokes, ${svg.length} bytes`);
