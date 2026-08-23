// Headless tuning harness: simulate N seconds and rasterise frames.
// node tune.mjs '{"wCohesion":0.4}' 8 16 25
import sharp from 'sharp';
import { Flock, STEP } from '../js/flock.js';
const [,, json = '{}', ...times] = process.argv;
const params = JSON.parse(json);
const W = 1440, H = 900;
const f = new Flock({ width: W, height: H, count: 200, seed: 7, params });
f.obstacles = [{ x: 72, y: 575, w: 440, h: 230 }];
const OUT = process.env.OUT || new URL('./out/', import.meta.url).pathname;
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
let t = 0;
for (const T of (times.length ? times.map(Number) : [8, 16, 25])) {
  while (t < T) { f._step(STEP); t += STEP; }
  let lines = '';
  for (let i = 0; i < f.n; i++) {
    const sp = Math.hypot(f.vx[i], f.vy[i]) || 1, len = Math.min(18, 2.5 + sp * 0.085);
    lines += `<line x1="${f.x[i].toFixed(1)}" y1="${f.y[i].toFixed(1)}" x2="${(f.x[i] - f.vx[i] / sp * len).toFixed(1)}" y2="${(f.y[i] - f.vy[i] / sp * len).toFixed(1)}" opacity="${(0.35 + f.op[i] * 0.6).toFixed(2)}"/>`;
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}"><rect width="100%" height="100%" fill="#faf9f6"/><rect x="72" y="575" width="440" height="230" fill="none" stroke="#ddd"/><g stroke="#3b5aa0" stroke-width="1.25" stroke-linecap="round">${lines}</g></svg>`;
  await sharp(Buffer.from(svg)).resize(960).png().toFile(`${OUT}/tune-${T}.png`);
  // crude cluster stat: mean nearest-neighbour distance and bbox coverage
  let sum = 0; for (let i = 0; i < f.n; i++) { let best = 1e9; for (let j = 0; j < f.n; j++) if (j !== i) { const d = Math.hypot(f.x[i] - f.x[j], f.y[i] - f.y[j]); if (d < best) best = d; } sum += best; }
  const cells = new Set(); for (let i = 0; i < f.n; i++) cells.add(((f.x[i] / 180) | 0) + ',' + ((f.y[i] / 180) | 0));
  console.log(`t=${T}s  meanNN=${(sum / f.n).toFixed(1)}px  coverage=${cells.size}/${Math.ceil(W / 180) * Math.ceil(H / 180)} cells`);
}
