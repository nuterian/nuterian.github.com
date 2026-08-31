// Does the flock fly like birds? Gates the four things that were wrong before
// the flight system existed, and draws the one thing a screenshot cannot show.
//
//   attitude  — nobody rotates faster than a bird can. The heading used to be
//               read straight off the velocity, and a bird hovering on the mark
//               at 8 px/s spun at up to 10 744 °/s.
//   size      — every bird reaches the SAME full spread, whatever its speed.
//               Wing length used to scale with velocity: 2.3× longer sprinting.
//   wingbeat  — every bird's beat actually advances. The phase used to be set
//               once at birth and never touched, so nothing ever flapped.
//   repose    — a bird settled on the mark HOLDS its wings and flaps now and
//               then. It used to beat at 7.2 Hz forever — one cycle every 8
//               frames on 183 birds at once, which reads as a shimmer.
//   pacing    — one simulation step per displayed frame. Real rAF deltas beat
//               against the fixed 60 Hz step: half the frames were wrong.
//
// The first three run headless in node (flock.js is pure). The fourth needs a
// real browser's rAF timings, so it captures them and replays them here.
// Writes out/wingbeat.png — a filmstrip of one beat per gait, at 9×.
// Usage: node flight.mjs [baseURL]
import { chromium } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
import { Flock, STEP } from '../js/flock.js';
import { MARK, MARK_ASPECT } from '../js/mark.js';

const BASE = process.argv[2] || 'http://localhost:4174';
const OUT = new URL('./out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

const budget = {
  turnMax: 400,     // °/s — a hard ceiling on how fast any bird may swing round
  spanSpread: 3,    // % — most the slowest birds' full spread may differ from the fastest'
  beatOctants: 6,   // of 8 — how much of the beat circle every bird must visit in 2 s
  reposeP50: 0.35,  // px — median wing-tip travel per frame for a settled bird…
  reposeP99: 0.80,  // px — …but it must still flap sometimes, or it is a corpse
  pacedFrames: 98,  // % of real frames that must take exactly one step
};
let fail = 0;
const line = (bad, name, detail) => {
  console.log(`${bad ? '✗' : '✓'} ${name.padEnd(26)} ${detail}`);
  fail += bad ? 1 : 0;
};

// --- a flock, settled, with something going on ------------------------------
const W = 1440, H = 900;
const f = new Flock({ width: W, height: H, count: 200, seed: 7 });
const bw = Math.min(W * 0.42, 620);
f.setHome(MARK, MARK_ASPECT, { w: bw, h: bw / MARK_ASPECT });
f.obstacles = [{ x: 90, y: 1070, w: 800, h: 420 }];
for (let i = 0; i < 900; i++) f._step(STEP);

const N = f.n;
const sp = i => Math.hypot(f.vx[i], f.vy[i]);
const span = i => Math.hypot(f._tips[i * 4], f._tips[i * 4 + 1]);
const pct = (a, q) => { const b = [...a].sort((x, y) => x - y); return b[Math.min(b.length - 1, Math.floor(q * b.length))]; };

// 12 s, with a pointer sweep through the mark at 4 s so every gait is exercised.
const prev = new Float32Array(N); for (let i = 0; i < N; i++) prev[i] = f.hd[i];
const turn = [];
const maxSpan = new Float32Array(N);      // biggest spread each bird reaches
const meanSpeed = new Float64Array(N);
const octants = Array.from({ length: N }, () => new Set());
let over = 0, samples = 0;

for (let s = 0; s < 12 * 60; s++) {
  const b = f.homeBox;
  if (s >= 240 && s < 300) f.setPointer(b.x - 40 + (b.w + 80) * (s - 240) / 60, b.y + b.h / 2);
  if (s === 300) f.setPointer(-1e4, -1e4, false);
  f._step(STEP);
  f.geometry();
  for (let i = 0; i < N; i++) {
    let d = f.hd[i] - prev[i];
    if (d > Math.PI) d -= 6.283; else if (d < -Math.PI) d += 6.283;
    const degps = Math.abs(d) / STEP * 180 / Math.PI;
    turn.push(degps); samples++; if (degps > budget.turnMax) over++;
    prev[i] = f.hd[i];
    const sv = span(i); if (sv > maxSpan[i]) maxSpan[i] = sv;
    meanSpeed[i] += sp(i) / (12 * 60);
    if (s < 120) octants[i].add(Math.floor(f.fp[i] / (6.283 / 8)));   // first 2 s
  }
}

// --- attitude ---------------------------------------------------------------
{
  const p50 = pct(turn, 0.5), p999 = pct(turn, 0.999);
  let mx = 0; for (const v of turn) if (v > mx) mx = v;
  line(mx > budget.turnMax, 'attitude · turn rate',
    `p50 ${p50.toFixed(0)} · p99.9 ${p999.toFixed(0)} · max ${mx.toFixed(0)} °/s (≤ ${budget.turnMax}), ${over}/${samples} over`);
}

// --- size -------------------------------------------------------------------
// The invariant is NOT that span is constant — the beat foreshortens it every
// cycle, which is the whole point. It is that every bird passes through the
// same FULL spread whatever its speed, so a fast bird is not a bigger bird.
{
  const order = [...Array(N).keys()].sort((a, b) => meanSpeed[a] - meanSpeed[b]);
  const q = Math.max(1, (N / 4) | 0);
  const avg = ix => ix.reduce((a, i) => a + maxSpan[i], 0) / ix.length;
  const slow = avg(order.slice(0, q)), fast = avg(order.slice(-q));
  const spread = Math.abs(slow - fast) / Math.max(slow, fast) * 100;
  line(spread > budget.spanSpread, 'size · full spread',
    `slowest quartile ${slow.toFixed(2)} px vs fastest ${fast.toFixed(2)} px — ${spread.toFixed(1)}% apart (≤ ${budget.spanSpread}%), tunable ${f.p.wing}`);
}

// --- wingbeat ---------------------------------------------------------------
{
  let worst = 9, worstAt = -1;
  for (let i = 0; i < N; i++) if (octants[i].size < worst) { worst = octants[i].size; worstAt = i; }
  line(worst < budget.beatOctants, 'wingbeat · phase advances',
    `least-beating bird visited ${worst}/8 octants in 2 s (≥ ${budget.beatOctants}) [#${worstAt}]`);
}

// --- repose -----------------------------------------------------------------
// Settled birds, left alone. Two-sided on purpose: the median says they are at
// rest, the tail says they are not frozen. A continuous flutter fails the first,
// a bird with its wings nailed on fails the second.
{
  const g = new Flock({ width: W, height: H, count: 200, seed: 7 });
  g.setHome(MARK, MARK_ASPECT, { w: bw, h: bw / MARK_ASPECT });
  for (let i = 0; i < 60 * 60; i++) g._step(STEP);          // a full minute to settle
  const home = []; for (let i = 0; i < g.n; i++) if (g.st[i] === 0) home.push(i);
  const prevT = new Float32Array(g.n * 4);
  g.geometry(); prevT.set(g._tips);
  const move = [];
  for (let s = 0; s < 12 * 60; s++) {                        // longer than the longest gap
    g._step(STEP); g.geometry();
    for (const i of home) {
      const o = i * 4;
      let d = 0; for (let k = 0; k < 4; k++) d += Math.abs(g._tips[o + k] - prevT[o + k]);
      move.push(d);
    }
    prevT.set(g._tips);
  }
  const p50 = pct(move, 0.5), p99 = pct(move, 0.99);
  const still = move.filter(d => d < 0.15).length / move.length * 100;
  line(p50 > budget.reposeP50 || p99 < budget.reposeP99, 'repose · on the mark',
    `wing-tip travel p50 ${p50.toFixed(2)} px/frame (≤ ${budget.reposeP50}) · p99 ${p99.toFixed(2)} (≥ ${budget.reposeP99}) · ${still.toFixed(0)}% of frames near-still, ${home.length} birds`);
}

// --- pacing -----------------------------------------------------------------
// Capture real rAF deltas from the page, then replay them through the very same
// advance() the Runner uses. One step per frame is smooth; a 0 is a frame that
// never got redrawn, a 2 is the flock lurching twice as far.
{
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
  await page.addInitScript(() => {
    window.__d = []; let last = 0;
    const loop = t => { if (last) window.__d.push(t - last); last = t; requestAnimationFrame(loop); };
    requestAnimationFrame(loop);
  });
  await page.goto(`${BASE}/?seed=7`, { waitUntil: 'load' });
  await page.waitForTimeout(9000);
  const deltas = await page.evaluate(() => window.__d.slice(60));
  await browser.close();

  const g = new Flock({ width: W, height: H, count: 200, seed: 7 });
  g.setHome(MARK, MARK_ASPECT, { w: bw, h: bw / MARK_ASPECT });
  const hist = new Map();
  for (const d of deltas) { const k = g.advance(Math.min(0.1, d / 1000)); hist.set(k, (hist.get(k) || 0) + 1); }
  const one = (hist.get(1) || 0) / deltas.length * 100;
  const shape = [...hist.keys()].sort().map(k => `${k}:${(100 * hist.get(k) / deltas.length).toFixed(0)}%`).join(' ');
  const hz = 1000 / (deltas.reduce((a, b) => a + b, 0) / deltas.length);
  line(one < budget.pacedFrames, 'pacing · steps per frame',
    `${one.toFixed(1)}% took exactly one (≥ ${budget.pacedFrames}%) — ${shape} over ${deltas.length} real frames at ${hz.toFixed(1)} Hz`);
}

// --- the filmstrip ----------------------------------------------------------
// A wingbeat is motion; no screenshot of the site can show one. Each row is a
// single bird over 16 consecutive frames with its heading rotated to point up,
// so what you see is the beat and not the flight path.
{
  // Startle them again first: the sweep at 4 s is long over by now (a startle
  // lasts under a second) and the strip must show a bird at full power.
  {
    const b = f.homeBox;
    for (let k = 0; k <= 30; k++) { f.setPointer(b.x - 40 + (b.w + 80) * k / 30, b.y + b.h / 2 + Math.sin(k / 4) * 60); f._step(STEP); }
    f.setPointer(-1e4, -1e4, false);
    for (let k = 0; k < 12; k++) f._step(STEP);
  }
  const rows = [];
  const best = (test, score) => { let b = -1, v = -Infinity; for (let i = 0; i < N; i++) if (test(i) && score(i) > v) { v = score(i); b = i; } return b; };
  rows.push(['hovering on the mark', best(i => f.st[i] === 0, i => -sp(i))]);
  rows.push(['startled — full power', best(i => f.st[i] === 1, i => f.ef[i])]);
  rows.push(['roaming — held glide', best(i => f.st[i] === 2, i => -f.ef[i])]);
  rows.push(['flaring — wings forward', best(() => true, i => f.br[i])]);
  const live = rows.filter(r => r[1] >= 0);

  const FR = 16, S = 9, CELL = 74, LEFT = 210;
  const frames = live.map(() => []);
  for (let k = 0; k < FR; k++) {
    f.geometry();
    live.forEach(([, i], r) => {
      const a = Math.atan2(f.hy[i], f.hx[i]);
      const ca = Math.cos(-a - Math.PI / 2), sa = Math.sin(-a - Math.PI / 2);
      const rot = (px, py) => [px * ca - py * sa, px * sa + py * ca];
      const o = i * 4;
      frames[r].push({ l: rot(f._tips[o], f._tips[o + 1]), r: rot(f._tips[o + 2], f._tips[o + 3]) });
    });
    f._step(STEP);
  }
  const w = LEFT + CELL * FR, h = 30 + CELL * live.length;
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`;
  svg += `<rect width="100%" height="100%" fill="#faf9f6"/>`;
  svg += `<text x="8" y="18" font-family="monospace" font-size="12" fill="#666">one wingbeat, 16 consecutive frames at 60 Hz, 9x, heading rotated up</text>`;
  live.forEach(([label, i], r) => {
    const y0 = 30 + r * CELL;
    svg += `<text x="8" y="${y0 + CELL / 2}" font-family="monospace" font-size="11" fill="#222">${label}</text>`;
    svg += `<text x="8" y="${y0 + CELL / 2 + 14}" font-family="monospace" font-size="9" fill="#999">drive ${f.ef[i].toFixed(2)} brake ${f.br[i].toFixed(2)} ${sp(i).toFixed(0)} px/s</text>`;
    for (let k = 0; k < FR; k++) {
      const cx = LEFT + k * CELL + CELL / 2, cy = y0 + CELL / 2, q = frames[r][k];
      svg += `<polyline points="${cx + q.l[0] * S},${cy + q.l[1] * S} ${cx},${cy} ${cx + q.r[0] * S},${cy + q.r[1] * S}" fill="none" stroke="#6a5a12" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;
    }
  });
  svg += '</svg>';
  await sharp(Buffer.from(svg)).png().toFile(`${OUT}/wingbeat.png`);
  console.log(`\nwingbeat filmstrip → out/wingbeat.png (${live.length} gaits)`);
}

console.log(fail ? `\n${fail} flight check(s) failed` : '\nflies like a bird');
process.exit(fail ? 1 : 0);
