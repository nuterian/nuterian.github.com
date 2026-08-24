/*
 * flock.js — the flock.
 *
 * A small boids simulation plus the renderer that draws it as ink strokes.
 * It is deliberately pure: no DOM, no globals. The same module runs inside a
 * Worker driving an OffscreenCanvas (see flock.worker.js) or on the main thread
 * when that isn't available (see main.js). Everything talks to it through
 * `Runner.handle(message)`.
 *
 * Rules, in order of how much they matter:
 *   separation  — don't crowd your neighbours
 *   alignment   — fly the way they fly
 *   cohesion    — stay with them
 *   you         — the pointer startles; the content is a wall
 *
 * Every bird is in one of three states:
 *   HOME    — sprung to its own point in the 2013 jm mark, hovering, breathing.
 *   STARTLE — the pointer came close and moving: pick a personal escape
 *             heading (roughly away, ±60° of temperament) and fly it out,
 *             speed-capped like everything else. No radial blast.
 *   ROAM    — circle the open space in a wide loop around the mark. Startled
 *             birds roam before they return — one to two full rounds, random
 *             per bird — and even a settled flock sheds the odd restless bird
 *             into a lap, so the idle state is never everyone at once.
 *
 * The page's text is sent in as rectangles the birds cannot cross; the canvas
 * bleeds past the viewport so a bird can leave the visible page, turn around
 * out of sight, and come back naturally instead of bouncing off an edge.
 *
 * Units: CSS pixels and seconds, in canvas-local coordinates. Fixed 1/60
 * timestep; frames without a step are not redrawn; the hot loops allocate
 * nothing; a whole frame (simulate + geometry + draw + GPU sync) is ~0.04 ms
 * at 200 birds. Modes: 'home' (all of the above) and 'snow' (December —
 * the first commit on this site after the 2013 reset was "Add snow").
 */

import { MARK, MARK_ASPECT } from './mark.js';
export { MARK, MARK_ASPECT };

export const STEP = 1 / 60;            // fixed simulation step
const MAX_STEPS = 4;                   // per frame, before we drop time instead

// Tunables. These are the "feel" — change with care and with a screenshot.
export const DEFAULTS = {
  perception: 48,     // px — how far a boid can see its neighbours
  separation: 14,     // px — personal space (the mark's points are ~14 px apart)
  cruise: 34,         // px/s — speed the flock relaxes to
  maxSpeed: 110,      // px/s — nominal top speed; each bird gets 0.8–1.2×
  maxForce: 190,      // px/s² — steering cap: how sharply anyone may turn
  wSeparation: 1.8,
  wAlignment: 0.8,
  wCohesion: 0.35,
  wWander: 0.4,
  pointerRadius: 150, // px — how close before a moving pointer startles
  pointerCalm: 240,   // px/s² — gentle standing clearing around a parked pointer
  homePull: 3,        // 1/s — spring toward your point in the mark (capped at homeSpeed)
  homeSpeed: 120,     // px/s — how fast you may go home
  homeJostle: 0.25,   // how much flocking still applies at home (0 = rigid dots)
  roamSpeed: 105,     // px/s — cruising speed of a lap around the campus
  restless: 0.004,    // 1/s — chance per second a settled bird leaves for a lap
  overshoot: 150,     // px — how far beyond the canvas a bird may fly before turning
};

// Deterministic PRNG (mulberry32). A seed makes the flock reproducible, which
// makes the OG image reproducible — and lets the curious share a `?seed=`.
export function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Sample the pixels of some rendered text into a point cloud. Used by the 404
// page; the mark on the home page is pre-sampled (mark.js) so it needs no font.
export function textPoints(ctx2d, text, font, pitch = 6) {
  const c = ctx2d.canvas;
  c.width = 600; c.height = 200;
  ctx2d.font = font;
  ctx2d.textBaseline = 'middle';
  ctx2d.textAlign = 'center';
  ctx2d.fillStyle = '#fff';
  ctx2d.fillText(text, 300, 100);
  const { data } = ctx2d.getImageData(0, 0, 600, 200);
  const raw = [];
  let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
  for (let y = pitch / 2; y < 200; y += pitch) {
    for (let x = pitch / 2; x < 600; x += pitch) {
      if (data[((y | 0) * 600 + (x | 0)) * 4 + 3] > 120) {
        raw.push(x, y);
        if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
    }
  }
  // Normalise to the glyphs' own bounding box, as percentages (like MARK).
  const w = Math.max(1, x1 - x0), h = Math.max(1, y1 - y0);
  const points = [];
  for (let i = 0; i < raw.length; i += 2) points.push(Math.round((raw[i] - x0) / w * 100), Math.round((raw[i + 1] - y0) / h * 100));
  return { points, aspect: w / h };
}


/*
 * A boid is a baseless triangle: head at its position, two wing arms swept
 * back from the heading. The wingbeat is procedural — phase advances with
 * speed (see _step) — and shows up two ways, as seen from above:
 *   sweep: the arms beat fore/aft around their resting angle;
 *   foreshortening: at the stroke's extremes the wing is out of plane, so
 *   the arm draws shorter, and mid-stroke it is fully spread.
 * At rest the beat is a slow flutter; fleeing, it is fast and deep.
 * Returns [leftTipX, leftTipY, rightTipX, rightTipY].
 */
export function wingTips(ux, uy, sp, phase) {
  const len = 4.4 + Math.min(sp * 0.05, 4.6);
  const amp = Math.min(1, 0.55 + sp / 150);   // clearly beating even at rest
  // Skewed waveform: the downstroke is quicker than the upstroke.
  const flap = Math.sin(phase + 0.45 * Math.sin(phase));
  const sweep = 2.3 - flap * 0.42 * amp;                // 108°–156° off the heading
  const wl = len * (1 - 0.22 * amp * flap * flap);      // slight foreshorten at the extremes
  const cs = Math.cos(sweep), sn = Math.sin(sweep);
  return [
    (ux * cs - uy * sn) * wl, (ux * sn + uy * cs) * wl,
    (ux * cs + uy * sn) * wl, (-ux * sn + uy * cs) * wl,
  ];
}

export class Flock {
  constructor(opts = {}) {
    this.p = { ...DEFAULTS, ...opts.params };
    this.w = opts.width || 1;
    this.h = opts.height || 1;
    this.random = rng(opts.seed ?? (Date.now() & 0xffff));
    this.time = 0;
    this.mode = 'home';
    this.pointer = { x: -1e4, y: -1e4, on: false, speed: 0 };
    this.attractors = [];   // {x, y, r, k, until}
    this.obstacles = [];    // {x, y, w, h} — the content; birds cannot cross it
    this.gravity = { x: 0, y: 0 }; // from device tilt
    this.home = null;       // {points, aspect, box:{x,y,w,h}} — where the flock belongs
    this.tempo = 1;         // global speed multiplier (dims when a sheet is open)
    this.setCount(opts.count || 120);
  }

  setCount(n) {
    n = Math.max(8, Math.min(600, n | 0));
    const old = this.n || 0;
    const grow = (arr, fill) => {
      const next = new Float32Array(n);
      if (arr) next.set(arr.subarray(0, Math.min(old, n)));
      for (let i = old; i < n; i++) next[i] = fill(i);
      return next;
    };
    this.x = grow(this.x, () => this.random() * this.w);
    this.y = grow(this.y, () => this.random() * this.h);
    this.vx = grow(this.vx, () => (this.random() - 0.5) * this.p.cruise);
    this.vy = grow(this.vy, () => (this.random() - 0.5) * this.p.cruise);
    this.ph = grow(this.ph, () => this.random() * Math.PI * 2); // personal phase
    this.op = grow(this.op, () => 0.55 + this.random() * 0.45);  // personal opacity
    this.fp = grow(this.fp, () => this.random() * Math.PI * 2);   // wingbeat phase
    this.vmax = grow(this.vmax, () => (0.8 + 0.4 * this.random()) * this.p.maxSpeed); // birds differ
    this.escx = grow(this.escx, () => 0); this.escy = grow(this.escy, () => 0); // startle heading
    this.stT = grow(this.stT, () => 0);   // startle seconds left
    this.lapR = grow(this.lapR, () => 0); // roam radians left before heading home
    this.lastA = grow(this.lastA, () => 0);
    this.odir = grow(this.odir, () => (this.random() < 0.5 ? -1 : 1)); // orbit direction
    this.rjit = grow(this.rjit, () => 1);  // personal ring scale, redrawn each departure
    this.cjx = grow(this.cjx, () => 0);    // personal ring centre offset
    this.cjy = grow(this.cjy, () => 0);
    const st = new Uint8Array(n); if (this.st) st.set(this.st.subarray(0, Math.min(old, n)));
    this.st = st; // 0 home · 1 startled · 2 roaming
    this.fx = new Float32Array(n);
    this.fy = new Float32Array(n);
    this._next = new Int32Array(n);        // spatial-hash chains (reused every step)
    this._tips = new Float32Array(n * 4);  // wingtip scratch for the painters
    this._alp = new Float32Array(n);       // per-bird alpha scratch (0 = culled)
    this._buck = new Uint8Array(n);        // opacity buckets (canvas 2d painter)
    this._inst = new Float32Array(n * 10); // instance scratch (webgl painter)
    this.n = n;
    this._acc = 0;
    if (this.home) this._assign();
  }

  resize(w, h) {
    const sx = w / this.w, sy = h / this.h;
    for (let i = 0; i < this.n; i++) { this.x[i] *= sx; this.y[i] *= sy; }
    this.w = w; this.h = h;
  }

  // --- Inputs from the page -------------------------------------------------

  setPointer(x, y, on = true) {
    if (on) {
      const dx = x - this.pointer.x, dy = y - this.pointer.y;
      this.pointer.speed = this.pointer.on ? Math.hypot(dx, dy) : 0;
    }
    this.pointer.x = x; this.pointer.y = y; this.pointer.on = on;
  }

  // Keyed attractors replace themselves, so a moving hover target is one
  // attractor that moves, not a trail of stale ones.
  attract(x, y, r = 90, k = 1, life = 0.8, id = null) {
    if (id) this.attractors = this.attractors.filter(a => a.id !== id);
    if (k > 0 && life > 0) this.attractors.push({ id, x, y, r, k, until: this.time + life });
  }

  // Give the flock a home: a point cloud (percent coords) placed in `box` (CSS px).
  setHome(points, aspect, box) {
    this.home = { points, aspect, box };
    this._assign();
  }
  // Move the home (scroll parallax, resize) without reassigning points.
  moveHome(box) {
    if (!this.home) return;
    this.home.box = box;
    this._assign(false);
  }
  clearHome() { this.home = null; this.tgt = null; }

  season(name) { // 'snow' | null
    this.mode = name === 'snow' ? 'snow' : 'home';
  }

  // Send bird i off on a lap. Every departure redraws its own ring — scale,
  // centre, direction — so no two birds trace the same path and the flock
  // never resolves into a visible circle.
  _roam(i, laps, keepTurn = false) {
    this.st[i] = 2;
    this.lapR[i] = laps * 6.283;
    this.rjit[i] = 0.72 + this.random() * 0.55;
    this.cjx[i] = (this.random() - 0.5) * 150;
    this.cjy[i] = (this.random() - 0.5) * 110;
    if (!keepTurn) this.odir[i] = this.random() < 0.5 ? -1 : 1;
  }

  // --- Simulation -----------------------------------------------------------

  _assign(reshuffle = true) {
    const h = this.home; if (!h) return;
    const pts = h.points, m = pts.length / 2;
    if (reshuffle || !this.order || this.order.length !== m) {
      // Spread boids across the mark's points; extra boids double up.
      const order = [];
      for (let k = 0; k < m; k++) order.push(k);
      for (let k = m - 1; k > 0; k--) { const j = (this.random() * (k + 1)) | 0; [order[k], order[j]] = [order[j], order[k]]; }
      this.order = order;
    }
    if (!this.tgt || this.tgt.length !== this.n * 2) this.tgt = new Float32Array(this.n * 2);
    for (let i = 0; i < this.n; i++) {
      const k = this.order[i % m];
      this.tgt[i * 2] = h.box.x + (pts[k * 2] / 100) * h.box.w;
      this.tgt[i * 2 + 1] = h.box.y + (pts[k * 2 + 1] / 100) * h.box.h;
    }
  }

  advance(dt) {
    this._acc += Math.min(dt, STEP * MAX_STEPS);
    let steps = 0;
    while (this._acc >= STEP) { this._step(STEP); this._acc -= STEP; steps++; }
    return steps;
  }

  _step(dt) {
    const { n, x, y, vx, vy, fx, fy, p, st } = this;
    this.time += dt;
    const t = this.time;
    const mode = this.mode;
    fx.fill(0); fy.fill(0);

    // Spatial hash: one bucket per perception radius. Scratch arrays are
    // reused across steps — the hot path allocates nothing.
    const cell = p.perception;
    const cols = Math.max(1, Math.ceil(this.w / cell)), rows = Math.max(1, Math.ceil(this.h / cell));
    if (!this._heads || this._heads.length !== cols * rows) this._heads = new Int32Array(cols * rows);
    const heads = this._heads.fill(-1);
    const next = this._next;
    for (let i = 0; i < n; i++) {
      const cx = Math.min(cols - 1, Math.max(0, (x[i] / cell) | 0));
      const cy = Math.min(rows - 1, Math.max(0, (y[i] / cell) | 0));
      const b = cy * cols + cx;
      next[i] = heads[b]; heads[b] = i;
    }

    const per2 = p.perception * p.perception, sep2 = p.separation * p.separation;
    const homing = mode === 'home' && !!this.tgt;
    // The whole mark sways very slowly, so even at rest it is never a still image.
    const swayX = Math.sin(t * 0.31) * 5, swayY = Math.cos(t * 0.23) * 4;
    // The campus loop: a wide ellipse around the mark, lifted above the
    // content at the bottom so a lap never grinds along the text's wall.
    const ccx = this.w / 2, ccy = this.h * 0.40;
    const markR = this.home ? Math.max(this.home.box.w, this.home.box.h) * 0.55 : 180;
    const ringX = Math.max(this.w * 0.36, markR + 90);
    const ringY = Math.max(this.h * 0.26, markR * 0.7 + 70);
    // No personal ring may dip into the content: a ring pulling down against
    // the wall pushing up would pin a bird in place, queuing on the spot.
    let wallY = this.h + 1e4;
    for (const o of this.obstacles) if (o.y < wallY) wallY = o.y;
    const ptr = this.pointer;
    const ptrMoving = ptr.on && ptr.speed > 2.5;

    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, cnt = 0;
      {
        const gx = (xi / cell) | 0, gy = (yi / cell) | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const bx = gx + ox, by = gy + oy;
          if (bx < 0 || by < 0 || bx >= cols || by >= rows) continue;
          for (let j = heads[by * cols + bx]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = x[j] - xi, dy = y[j] - yi, d2 = dx * dx + dy * dy;
            if (d2 > per2 || d2 === 0) continue;
            if (d2 < sep2) { const d = Math.sqrt(d2); sx -= dx / d * (1 - d / p.separation); sy -= dy / d * (1 - d / p.separation); }
            ax += vx[j]; ay += vy[j]; cx += dx; cy += dy; cnt++;
          }
        }
      }
      let Fx = 0, Fy = 0;
      const si = mode === 'snow' ? 0 : st[i];
      // At home the rules apply softly (the mark holds); on the wing, fully.
      const jostle = si === 0 && homing ? p.homeJostle : 1;
      if (cnt) {
        ax /= cnt; ay /= cnt; cx /= cnt; cy /= cnt;
        const al = Math.sqrt(ax * ax + ay * ay) || 1;
        const wA = mode === 'snow' ? 0 : p.wAlignment * jostle, wC = mode === 'snow' ? 0 : p.wCohesion * jostle;
        Fx += (ax / al * p.cruise - vx[i]) * wA + cx * wC;
        Fy += (ay / al * p.cruise - vy[i]) * wA + cy * wC;
      }
      Fx += sx * p.wSeparation * 90; Fy += sy * p.wSeparation * 90;

      // Wander: a slow personal sine so nobody flies perfectly straight.
      const ph = this.ph[i];
      Fx += Math.cos(t * 0.9 + ph) * p.wWander * 40;
      Fy += Math.sin(t * 0.7 + ph * 1.3) * p.wWander * 40;

      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]) || 1e-3;

      if (mode === 'snow') {
        const want = p.cruise * 0.5;
        const k = (want - sp) * 0.8;
        Fx += vx[i] / sp * k; Fy += vy[i] / sp * k;
        Fy += 26; Fx += Math.sin(t * 1.4 + ph) * 18;
      } else if (si === 0) {
        // HOME — spring to your point; hover slowly when you're there.
        if (homing) {
          const tx = this.tgt[i * 2] + swayX, ty = this.tgt[i * 2 + 1] + swayY;
          const dx = tx - xi, dy = ty - yi;
          const homeD = Math.sqrt(dx * dx + dy * dy) || 1e-3;
          const pull = Math.min(homeD * p.homePull, p.homeSpeed);
          Fx += (dx / homeD * pull - vx[i]) * 2.2; Fy += (dy / homeD * pull - vy[i]) * 2.2;
          const want = p.cruise * Math.min(1, 0.18 + homeD / 90);
          const k = (want - sp) * 0.8;
          Fx += vx[i] / sp * k; Fy += vy[i] / sp * k;
          // Restlessness: now and then a settled bird just leaves for a lap,
          // so the idle flock is never the whole flock.
          if (homeD < 26 && this.random() < p.restless * dt) {
            this._roam(i, 0.4 + this.random() * 1.1);
            this.lastA[i] = Math.atan2((yi - ccy) / ringY, (xi - ccx) / ringX);
          }
        }
      } else if (si === 1) {
        // STARTLE — fly your own way out, hard but never faster than you can.
        Fx += (this.escx[i] * this.vmax[i] * 1.35 - vx[i]) * 2.6;
        Fy += (this.escy[i] * this.vmax[i] * 1.35 - vy[i]) * 2.6;
        this.stT[i] -= dt;
        if (this.stT[i] <= 0) {
          // Temperament: homebodies head straight back; the rest calm down
          // into one or two full rounds on a ring of their own.
          if (this.random() < 0.45) st[i] = 0;
          else {
            this._roam(i, 1 + this.random(), true);
            const cross = (xi - ccx) * vy[i] - (yi - ccy) * vx[i];
            this.odir[i] = cross >= 0 ? 1 : -1;       // keep turning the way you already are
            this.lastA[i] = Math.atan2((yi - ccy) / ringY, (xi - ccx) / ringX);
          }
        }
      } else {
        // ROAM — a wide elliptical lap through the open space, then home.
        // Each bird flies its own ring (scale, centre, slow breathing), so
        // roamers make a loose swirl, never a drawn circle.
        const breathe = this.rjit[i] * (1 + 0.09 * Math.sin(t * 0.21 + ph));
        const cX = ccx + this.cjx[i], cY = ccy + this.cjy[i];
        const rX = ringX * breathe;
        const rY = Math.min(ringY * breathe, Math.max(90, wallY - 34 - cY));
        const qx = (xi - cX) / rX, qy = (yi - cY) / rY;
        const qd = Math.sqrt(qx * qx + qy * qy) || 1e-3;
        const roamSp = p.roamSpeed * (0.8 + 0.4 * this.op[i]);
        // Tangent of the ellipse, back in real space.
        let tx = -qy * rX * this.odir[i], ty = qx * rY * this.odir[i];
        const tl = Math.sqrt(tx * tx + ty * ty) || 1e-3; tx /= tl; ty /= tl;
        // Radial correction toward the ring, back in real space.
        let ux = qx / qd * rX, uy = qy / qd * rY;
        const ul = Math.sqrt(ux * ux + uy * uy) || 1e-3; ux /= ul; uy /= ul;
        let rad = (1 - qd) * 110; rad = rad > 60 ? 60 : rad < -60 ? -60 : rad;
        Fx += (tx * roamSp + ux * rad - vx[i]) * 2.0;
        Fy += (ty * roamSp + uy * rad - vy[i]) * 2.0;
        const a = Math.atan2(qy, qx);
        let da = a - this.lastA[i];
        if (da > Math.PI) da -= 6.283; else if (da < -Math.PI) da += 6.283;
        this.lapR[i] -= Math.abs(da); this.lastA[i] = a;
        if (this.lapR[i] <= 0) st[i] = 0; // rounds done — drift home
      }

      // You. A parked pointer keeps a small polite clearing; a moving one
      // startles — each bird breaks in its own direction, no radial blast.
      if (ptr.on) {
        const dx = xi - ptr.x, dy = yi - ptr.y, d2p = dx * dx + dy * dy;
        if (d2p < p.pointerRadius * p.pointerRadius && d2p > 1e-4) {
          const d = Math.sqrt(d2p);
          const soft = 1 - d / p.pointerRadius;
          Fx += dx / d * p.pointerCalm * soft * soft;
          Fy += dy / d * p.pointerCalm * soft * soft;
          if (mode !== 'snow' && st[i] !== 1 && (ptrMoving || d < 80)) {
            st[i] = 1;
            this.stT[i] = 0.4 + this.random() * 0.6;
            const spread = (this.random() - 0.5) * 2.1; // ±60° of temperament
            const ca = Math.cos(spread), sa = Math.sin(spread);
            let ex = (dx * ca - dy * sa) / d, ey = (dx * sa + dy * ca) / d;
            // If that heading dives into the content, mirror the spread.
            const lx2 = xi + ex * 110, ly2 = yi + ey * 110;
            for (const o of this.obstacles) {
              if (lx2 > o.x && lx2 < o.x + o.w && ly2 > o.y && ly2 < o.y + o.h) {
                ex = (dx * ca + dy * sa) / d; ey = (-dx * sa + dy * ca) / d;
                break;
              }
            }
            this.escx[i] = ex; this.escy[i] = ey;
          }
        }
      }
      // Things that gather (mobile taps).
      for (const a of this.attractors) {
        const dx = a.x - xi, dy = a.y - yi, d = Math.hypot(dx, dy) || 1;
        if (d < a.r * 4) {
          const s = Math.min(1, d / a.r);
          Fx += dx / d * 140 * a.k * s + (-dy / d) * 30 * a.k * (1 - s);
          Fy += dy / d * 140 * a.k * s + (dx / d) * 30 * a.k * (1 - s);
        }
      }
      // The content is a wall. Push out along the nearest face, and kill the
      // velocity component that points into it, so birds skim, never cross.
      for (const o of this.obstacles) {
        const m = 18;
        if (xi > o.x - m && xi < o.x + o.w + m && yi > o.y - m && yi < o.y + o.h + m) {
          const lx = xi - (o.x - m), rx2 = (o.x + o.w + m) - xi, ty = yi - (o.y - m), by = (o.y + o.h + m) - yi;
          const mn = Math.min(lx, rx2, ty, by);
          if (mn === lx) { Fx -= 800; if (vx[i] > 0) vx[i] *= 0.15; }
          else if (mn === rx2) { Fx += 800; if (vx[i] < 0) vx[i] *= 0.15; }
          else if (mn === ty) { Fy -= 800; if (vy[i] > 0) vy[i] *= 0.15; }
          else { Fy += 800; if (vy[i] < 0) vy[i] *= 0.15; }
        }
      }
      // Edges: nothing at all while inside — the canvas bleeds past the
      // viewport, so a bird flies out of sight, turns around off-stage, and
      // returns naturally. The pull starts only beyond the canvas.
      if (xi < 0) Fx += -xi * 4; else if (xi > this.w) Fx -= (xi - this.w) * 4;
      if (yi < 0) Fy += -yi * 4; else if (yi > this.h) Fy -= (yi - this.h) * 4;

      // Weather.
      Fx += this.gravity.x; Fy += this.gravity.y;

      // Clamp steering: nobody turns harder than maxForce allows.
      const fm = Math.sqrt(Fx * Fx + Fy * Fy);
      const cap = p.maxForce * 4;
      if (fm > cap) { Fx *= cap / fm; Fy *= cap / fm; }
      fx[i] = Fx; fy[i] = Fy;
    }

    // Integrate. Every bird has its own top speed; a startled bird may
    // briefly reach 1.35× it, a roaming one 1.15× — nobody teleports.
    const tempo = this.tempo;
    const over = p.overshoot;
    for (let i = 0; i < n; i++) {
      vx[i] += fx[i] * dt; vy[i] += fy[i] * dt;
      let sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      const cap = this.vmax[i] * (st[i] === 1 ? 1.35 : st[i] === 2 ? 1.15 : 1);
      if (sp > cap) { vx[i] *= cap / sp; vy[i] *= cap / sp; sp = cap; }
      x[i] += vx[i] * dt * tempo; y[i] += vy[i] * dt * tempo;
      // Snow wraps; everything else may drift a little past the canvas.
      if (mode === 'snow' && y[i] > this.h + 8) { y[i] = -8; x[i] = this.random() * this.w; }
      if (x[i] < -over) x[i] = -over; else if (x[i] > this.w + over) x[i] = this.w + over;
      if (y[i] < -over) y[i] = -over; else if (y[i] > this.h + over && mode !== 'snow') y[i] = this.h + over;
    }

    // Housekeeping.
    this.pointer.speed *= 0.85;
    if (this.attractors.length) this.attractors = this.attractors.filter(a => a.until > t);
  }

  // --- Rendering ------------------------------------------------------------


  // One geometry pass per frame into reused scratch; the painters (WebGL or
  // Canvas 2D, below) only read it. Alpha 0 means culled.
  geometry() {
    const { n, x, y, vx, vy, op, fp } = this;
    const tips = this._tips, alp = this._alp;
    const near = this.pointer.on ? this.pointer : null;
    for (let i = 0; i < n; i++) {
      if (y[i] < -28 || y[i] > this.h + 28 || x[i] < -28 || x[i] > this.w + 28) { alp[i] = 0; continue; } // off-stage
      let o = op[i];
      if (near) {
        const dx = x[i] - near.x, dy = y[i] - near.y, d2 = dx * dx + dy * dy;
        if (d2 < 220 * 220) o = Math.min(1, o + (1 - Math.sqrt(d2) / 220) * 0.4);
      }
      alp[i] = 0.35 + o * 0.6;
      const sp = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
      let ux = sp > 0.01 ? vx[i] / sp : Math.cos(this.ph[i]);
      let uy = sp > 0.01 ? vy[i] / sp : Math.sin(this.ph[i]);
      const [lx, ly, rx, ry] = wingTips(ux, uy, sp, fp[i]);
      tips[i * 4] = lx; tips[i * 4 + 1] = ly; tips[i * 4 + 2] = rx; tips[i * 4 + 3] = ry;
    }
  }
}

/*
 * GLPainter — the preferred way to draw the flock: instanced quads on the GPU.
 * One static unit quad, one small dynamic buffer (two wing segments per bird,
 * five floats each), one draw call per frame. The vertex shader stretches the
 * quad along its segment; MSAA does the smoothing. This is about the least
 * work a GPU can be asked to do, which is the point: the CPU's only rendering
 * job is writing ~8 KB of segment data.
 */
export class GLPainter {
  static try(canvas) {
    try {
      // No MSAA: the fragment shader feathers the quad edges itself, which is
      // cheaper than a multisampled framebuffer on weak GPUs.
      const opts = { alpha: true, antialias: false, powerPreference: 'low-power', premultipliedAlpha: true };
      const gl = canvas.getContext('webgl2', opts) || canvas.getContext('webgl', opts);
      if (!gl) return null;
      const ext = gl.vertexAttribDivisor ? null : gl.getExtension('ANGLE_instanced_arrays');
      if (!gl.vertexAttribDivisor && !ext) return null;
      const p = new GLPainter(canvas, gl, ext);
      return p.ok ? p : null;
    } catch { return null; }
  }

  constructor(canvas, gl, ext) {
    this.canvas = canvas; this.gl = gl;
    this.name = gl.vertexAttribDivisor ? 'webgl2' : 'webgl';
    this.divisor = (loc, d) => (ext ? ext.vertexAttribDivisorANGLE(loc, d) : gl.vertexAttribDivisor(loc, d));
    this.drawInst = (mode, first, count, n) => (ext ? ext.drawArraysInstancedANGLE(mode, first, count, n) : gl.drawArraysInstanced(mode, first, count, n));
    canvas.addEventListener?.('webglcontextlost', e => e.preventDefault());
    canvas.addEventListener?.('webglcontextrestored', () => this._setup());
    this._setup();
  }

  _setup() {
    const gl = this.gl;
    const sh = (type, src) => { const h = gl.createShader(type); gl.shaderSource(h, src); gl.compileShader(h); return h; };
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, `
      attribute vec2 q;        // corner of the unit quad: t along [0,1], s across [-1,1]
      attribute vec4 seg;      // wing segment, CSS px: ax ay bx by
      attribute float alp;
      uniform vec2 res;
      uniform mediump float hw;             // mediump to match the fragment stage exactly
      varying float v; varying float dpx;   // signed distance from the centreline, px
      void main() {
        vec2 d = seg.zw - seg.xy;
        float len = max(length(d), 1e-4);
        vec2 u = d / len, n = vec2(-u.y, u.x);
        float hwE = hw + 0.75;              // expand for the feather
        vec2 p = seg.xy + u * (q.x * (len + 2.0 * hwE) - hwE) + n * (q.y * hwE);
        vec2 c = p / res * 2.0 - 1.0;
        gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
        v = alp; dpx = q.y * hwE;
      }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec4 col; uniform float hw;
      varying float v; varying float dpx;
      void main() {
        float edge = clamp((hw + 0.375 - abs(dpx)) / 0.75, 0.0, 1.0); // ~1px feather
        float a = col.a * v * edge;
        gl_FragColor = vec4(col.rgb * a, a);
      }`));
    gl.linkProgram(prog);
    this.ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
    if (!this.ok) return; // GLPainter.try() will fall back to Canvas 2D
    gl.useProgram(prog);
    this.uRes = gl.getUniformLocation(prog, 'res');
    this.uHw = gl.getUniformLocation(prog, 'hw');
    this.uCol = gl.getUniformLocation(prog, 'col');
    const aQ = gl.getAttribLocation(prog, 'q');
    const aSeg = gl.getAttribLocation(prog, 'seg');
    const aAlp = gl.getAttribLocation(prog, 'alp');
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, -1, 1, -1, 0, 1, 1, 1]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(aQ); gl.vertexAttribPointer(aQ, 2, gl.FLOAT, false, 0, 0);
    this.instBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    gl.enableVertexAttribArray(aSeg); gl.vertexAttribPointer(aSeg, 4, gl.FLOAT, false, 20, 0); this.divisor(aSeg, 1);
    gl.enableVertexAttribArray(aAlp); gl.vertexAttribPointer(aAlp, 1, gl.FLOAT, false, 20, 16); this.divisor(aAlp, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied
    this.instCap = 0;
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.gl.viewport(0, 0, this.canvas.width, this.canvas.height);
  }

  draw(f, { rgb = [0.5, 0.5, 0.5], alpha = 1, width = 1.25, w, h }) {
    const gl = this.gl;
    if (gl.isContextLost()) return;
    const { n, x, y } = f, tips = f._tips, alp = f._alp, inst = f._inst;
    let m = 0;
    for (let i = 0; i < n; i++) {
      const a = alp[i];
      if (a === 0) continue;
      const xi = x[i], yi = y[i], o = i * 4, k = m * 10;
      inst[k] = xi + tips[o]; inst[k + 1] = yi + tips[o + 1]; inst[k + 2] = xi; inst[k + 3] = yi; inst[k + 4] = a;
      inst[k + 5] = xi; inst[k + 6] = yi; inst[k + 7] = xi + tips[o + 2]; inst[k + 8] = yi + tips[o + 3]; inst[k + 9] = a;
      m++;
    }
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (!m) return;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instBuf);
    if (inst.length > this.instCap) { gl.bufferData(gl.ARRAY_BUFFER, inst.byteLength, gl.DYNAMIC_DRAW); this.instCap = inst.length; }
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, inst.subarray(0, m * 10));
    gl.uniform2f(this.uRes, w, h);
    gl.uniform1f(this.uHw, width / 2);
    gl.uniform4f(this.uCol, rgb[0], rgb[1], rgb[2], alpha);
    this.drawInst(gl.TRIANGLE_STRIP, 0, 4, m * 2);
  }
}

/*
 * Canvas2DPainter — the fallback when WebGL isn't available. Same geometry,
 * batched into six opacity buckets so globalAlpha changes rarely.
 */
export class Canvas2DPainter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: true, desynchronized: true });
    this.name = 'canvas2d';
    this.dpr = 1;
  }

  resize(w, h, dpr) {
    this.canvas.width = Math.round(w * dpr); this.canvas.height = Math.round(h * dpr);
    this.dpr = dpr;
  }

  draw(f, { color = '#888', alpha = 1, width = 1.25, w, h }) {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = width; ctx.strokeStyle = color;
    const { n, x, y } = f, tips = f._tips, alp = f._alp, buck = f._buck;
    const buckets = 6;
    for (let i = 0; i < n; i++) buck[i] = alp[i] === 0 ? 255 : Math.min(buckets - 1, (alp[i] * buckets) | 0);
    for (let b = 0; b < buckets; b++) {
      ctx.globalAlpha = alpha * ((b + 0.5) / buckets);
      ctx.beginPath();
      let any = false;
      for (let i = 0; i < n; i++) {
        if (buck[i] !== b) continue;
        any = true;
        ctx.moveTo(x[i] + tips[i * 4], y[i] + tips[i * 4 + 1]);
        ctx.lineTo(x[i], y[i]);
        ctx.lineTo(x[i] + tips[i * 4 + 2], y[i] + tips[i * 4 + 3]);
      }
      if (any) ctx.stroke();
    }
    ctx.restore();
  }
}

/*
 * Runner: owns a canvas (Offscreen or not), a Flock, and the frame loop.
 */
export class Runner {
  constructor(canvas, { raf = globalThis.requestAnimationFrame.bind(globalThis) } = {}) {
    this.canvas = canvas;
    this.painter = GLPainter.try(canvas) || new Canvas2DPainter(canvas);
    this.raf = raf;
    this.flock = null;
    this.style = { color: '#888', rgb: [0.5, 0.5, 0.5], alpha: 1, width: 1.25 };
    this.dpr = 1; this.w = 1; this.h = 1; this.dirty = true;
    this.frames = 0; this.accum = 0; this.last = 0;
    this.still = false; this.running = false; this.onstats = null;
  }

  _style(st) {
    Object.assign(this.style, st);
    if (st.color) { // '#rrggbb' → linear-ish floats for the GL path
      const c = parseInt(st.color.slice(1), 16);
      this.style.rgb = [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
    }
  }

  handle(m) {
    const f = this.flock;
    switch (m.type) {
      case 'init': {
        this.dpr = m.dpr; this.w = m.w; this.h = m.h; this.still = !!m.still;
        this.painter.resize(m.w, m.h, m.dpr);
        this.flock = new Flock({ width: m.w, height: m.h, count: m.count, seed: m.seed, params: m.params });
        if (m.season) this.flock.season(m.season);
        if (m.still) this.settle();
        else this.start();
        break;
      }
      case 'resize':
        this.dpr = m.dpr; this.w = m.w; this.h = m.h;
        this.painter.resize(m.w, m.h, m.dpr);
        f?.resize(m.w, m.h); this.dirty = true; if (this.still) this.draw();
        break;
      case 'style': this._style(m.style); this.dirty = true; if (this.still) this.draw(); break;
      case 'pointer': f?.setPointer(m.x, m.y, m.on); break;
      case 'attract': f?.attract(m.x, m.y, m.r, m.k, m.life, m.id); break;
      case 'gravity': if (f) { f.gravity.x = m.x; f.gravity.y = m.y; } break;
      case 'obstacles': if (f) { f.obstacles = m.rects; if (this.still) this.settle(120); } break;
      case 'home': f?.setHome(m.points, m.aspect, m.box); if (this.still) this.settle(); break;
      case 'home-box': f?.moveHome(m.box); if (this.still) this.settle(240); break;
      case 'home-off': f?.clearHome(); break;
      case 'tempo': if (f) f.tempo = m.value; break;
      case 'count': f?.setCount(m.value); break;
      case 'params': if (f) Object.assign(f.p, m.params); break;
      case 'season': f?.season(m.season); break;
      case 'visible': m.value ? this.start() : this.stop(); break;
      case 'step': if (this.still && f) { f.advance(m.dt || STEP); this.draw(); } break;
    }
  }

  // Still mode: no animation, just a composed frame. Runs the simulation
  // ahead so the frame looks lived-in rather than freshly scattered.
  settle(steps = 600) { for (let i = 0; i < steps; i++) this.flock._step(STEP); this.draw(); }

  start() { if (this.running || this.still) return; this.running = true; this.last = 0; this.raf(this.tick); }
  stop() { this.running = false; }

  tick = (now) => {
    if (!this.running) return;
    const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : STEP;
    this.last = now;
    // The simulation ticks at 60 Hz; a 120 Hz display would otherwise redraw
    // identical frames between steps. Only draw when something moved.
    if (this.flock.advance(dt) || this.dirty) { this.draw(); this.dirty = false; }
    // Report frame rate once a second; the flock's size is never changed
    // behind your back (a frame costs ~0.04 ms — there is nothing to adapt).
    this.accum += dt; this.frames++;
    if (this.frames === 60) {
      this.onstats?.({ fps: this.frames / this.accum, n: this.flock.n, renderer: this.painter.name });
      this.frames = 0; this.accum = 0;
    }
    this.raf(this.tick);
  };

  draw() {
    this.flock.geometry();
    this.painter.draw(this.flock, { ...this.style, w: this.w, h: this.h });
  }
}
