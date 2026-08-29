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
 *   you         — the pointer startles; the content nudges, gently
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
 * Where the flock GOES is one question; what a bird does with its body on the
 * way is another, and has its own section (“Flight”, in _step): the heading is
 * state that turns at a limited rate, not a reading off the velocity, and the
 * wingbeat is one always-advancing phase whose depth and rate the gait
 * modulates — so hover, flap, glide and flare are blends of the same three
 * smoothed numbers, never a switch. See DESIGN.md “Flight”.
 *
 * THE MARK LIVES IN WHITESPACE. Its size is fixed, but its place is not:
 * a small placement solver (`_placeHome`) finds the best spot for the mark
 * box in the current viewport — least overlap with content, on-canvas, with
 * hysteresis so near-ties never make it hop — and the home box GLIDES there.
 * The birds just chase their moving home. Scroll to the archive and the
 * whitespace is on the right, so the mark reforms there, same size; scroll
 * back up and it glides home to the hero. Relocation is the only reason a
 * bird crosses content, and while crossing it renders above the text (the
 * canvas sits over the page), so it reads as flying over, never under.
 * A weak smooth field around each content block gives them their aversion —
 * a nudge, deliberately too weak to trap anyone (a field that can win a
 * tug-of-war creates standing equilibria: queues of not-stuck birds).
 *
 * The world is the VIEWPORT (plus a 60 px bleed): the canvas is fixed, and
 * the content rectangles live in document coordinates that the worker
 * offsets by the scroll position (one tiny message per scrolled frame; no
 * layout reads).
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
const TAU = Math.PI * 2, PI = Math.PI, DEG = Math.PI / 180;

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
  fieldRadius: 70,     // px — the content's field fades to nothing at this distance
  fieldForce: 90,      // px/s² — its strength at zero distance: a NUDGE, not a fence.
                        // Strong enough to bias birds away from sitting directly on
                        // top of text, weak enough that it can never outlast another
                        // force (the roam ring, cohesion) for long — a field that
                        // can win a tug-of-war creates a standing equilibrium exactly
                        // where the two forces balance, and since many different
                        // birds pass through that one location, it reads as a
                        // permanent queue even though no single bird is stuck. The
                        // fix for that is not a stronger field, it's a weaker one:
                        // letting birds actually cross is the point (see header).
  // --- Flight: what a bird does with its body, as opposed to where it goes ---
  turnRate: 330,      // °/s — fastest it may swing its heading, when slow
  turnRateFast: 150,  // °/s — …and at top speed: a turn is flown with bank and
                      //       ω = g·tanφ/v, so speed costs you the tight ones
  headingSpeed: 30,   // px/s — below this the velocity direction is mostly noise
                      //        (hovering on the mark is 8 px/s): hold, don't chase
  wing: 5.2,          // px — HALF-SPAN at full spread. One number, every bird, every
                      //      speed. Only the beat itself foreshortens it.
  beatSlow: 1.1,      // Hz — wings HELD: a glide, or a bird settled on the mark.
                      //      Not zero, so the hold still breathes.
  beatFast: 9.0,      // Hz — …and under full power
  restFlap: 0.55,     // s — length of the occasional flap a settled bird gives
  restEvery: 5.3,     // s — mean gap between them, ±2.3 s and personal, so the
                      //     mark never beats in unison
  bank: 0.22,         // 0–1 — span a fully banked bird loses, seen from above
  fieldSwirl: 0.18,    // 0–1 — how much of the push is redirected to curve past corners
                      // (kept LOW: a strong tangential term is a curl field, and a
                      // curl field can trap a bird in a stable orbit around an
                      // isolated obstacle — a swirling ring exactly like a magnetic
                      // field bends a charged particle into a circle. 0.8 did this
                      // visibly around the archive header. Pure radial repulsion
                      // cannot sustain an orbit on its own, so this stays small.)
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
 * A boid is a baseless triangle: head at its position, two arms swept from the
 * heading. Seen from above a wingbeat is two things at once — the arm beating
 * fore/aft about its rest angle, and foreshortening, because the wing is out of
 * plane at the ends of the stroke and fully spread through the middle. A bank
 * foreshortens both arms together. `len`, the half-span at full spread, is one
 * number for every bird at every speed.
 *
 *   phase  the beat, always advancing; the gait changes its depth, not it
 *   drive  0…1  stroke depth: 0 a held glide, 1 full power
 *   brake  0…1  the flare — wings forward and spread, stopping
 *   bank  -1…1  roll into the turn
 * Writes [leftX, leftY, rightX, rightY] into out[o…o+3]; allocates nothing.
 */
export function wingPose(ux, uy, phase, drive, brake, bank, len, bankDepth, out, o) {
  // Skewed waveform: the downstroke is quicker than the recovery upstroke.
  const beat = Math.sin(phase + 0.45 * Math.sin(phase));
  const amp = 0.16 + 0.84 * drive;
  // Where the arms rest: back in a glide, squarer under power, thrown forward in
  // a flare — 109°–155° off the heading under power, the silhouette this site has
  // always had. One number moving, so the bird reshapes rather than changes costume.
  const sweep = 2.52 - 0.22 * drive - 0.62 * brake - beat * 0.40 * amp;
  const span = len * (1 - 0.34 * amp * beat * beat) * (1 - bankDepth * bank * bank);
  const cs = Math.cos(sweep) * span, sn = Math.sin(sweep) * span;
  out[o] = ux * cs - uy * sn;      out[o + 1] = ux * sn + uy * cs;
  out[o + 2] = ux * cs + uy * sn;  out[o + 3] = -ux * sn + uy * cs;
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
    this.obstacles = [];    // {x, y, w, h} in document(+bleed) space — the content walls
    this.scroll = 0;        // document scroll offset; world y = doc y − scroll
    this.gravity = { x: 0, y: 0 }; // from device tilt
    this.home = null;       // {points, aspect, size:{w,h}} — the mark itself
    this.homeBox = null;    // {x,y,w,h} view space — where it currently sits (animated)
    this._homeGoal = null;  // where the placement solver currently wants it
    this._dv = { x: 0, y: 0 }; // desired-velocity scratch, reused per bird
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
    this.fp = grow(this.fp, () => this.random() * TAU);   // wingbeat phase — ALWAYS advancing
    // Attitude (see the flight block in _step). The heading is state; hx/hy is
    // its unit vector, written once per step so the renderer does no trig.
    this.hd = grow(this.hd, (i) => this.ph[i]);   // start facing your phase angle
    this.hx = grow(this.hx, () => 0); this.hy = grow(this.hy, () => 0);
    this.hdw = grow(this.hdw, () => (this.random() - 0.5) * 0.5); // rad/s of looking around
    this.ef = grow(this.ef, () => 0.3); // stroke depth ─┐ smoothed, so every gait
    this.br = grow(this.br, () => 0);   // the flare     ├ change is a blend and
    this.bk = grow(this.bk, () => 0);   // bank, signed ─┘ never a switch
    this.vmax = grow(this.vmax, () => (0.8 + 0.4 * this.random()) * this.p.maxSpeed); // birds differ
    this.escx = grow(this.escx, () => 0); this.escy = grow(this.escy, () => 0); // startle heading
    this.stT = grow(this.stT, () => 0);   // startle seconds left
    this.lapR = grow(this.lapR, () => 0); // roam radians left before heading home
    this.lastA = grow(this.lastA, () => 0);
    this.odir = grow(this.odir, () => (this.random() < 0.5 ? -1 : 1)); // orbit direction
    this.rjit = grow(this.rjit, () => 1);  // personal ring scale, redrawn each departure
    this.cjx = grow(this.cjx, () => 0);    // personal ring centre offset
    this.cjy = grow(this.cjy, () => 0);
    this.slow = grow(this.slow, () => 0);  // seconds spent near-stationary (any cause) — generic unstick
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

  // Give the flock a home: a point cloud (percent coords) at a fixed size.
  // WHERE it sits is the placement solver's job, not the caller's.
  setHome(points, aspect, size) {
    this.home = { points, aspect, size };
    this._assign();
  }
  setHomeSize(size) {
    if (!this.home) return;
    this.home.size = size;
    this._assign(false);
  }
  clearHome() { this.home = null; this.homeBox = null; this._homeGoal = null; this.tgt = null; }

  // Find the best place for the mark box in the current viewport: least
  // overlap with content (view space), fully on-canvas, gently preferring
  // the viewport's visual centre. Coarse grid, then a few refinement rings.
  // Hysteresis keeps the current spot unless a new one is clearly better,
  // so near-ties never make the mark hop. ~60 candidates × a handful of
  // rects — microseconds, run at most ~7×/s while scrolling.
  _placeHome() {
    const S = this.home?.size; if (!S) return;
    const M = 34;                       // breathing room around the mark
    const w = this.w, h = this.h, scroll = this.scroll;
    const bw = S.w + 2 * M, bh = S.h + 2 * M;
    const score = (cx, cy) => {
      const x0 = cx - bw / 2, y0 = cy - bh / 2;
      let pen = 0;
      // stay on the canvas (an off-canvas mark is an invisible mark)
      const ex = Math.max(0, -x0) + Math.max(0, x0 + bw - w);
      const ey = Math.max(0, -y0) + Math.max(0, y0 + bh - h);
      pen += (ex * bh + ey * bw) * 3;
      for (const o of this.obstacles) {
        const oy0 = o.y - scroll, oy1 = o.y + o.h - scroll;
        const ix = Math.min(x0 + bw, o.x + o.w) - Math.max(x0, o.x);
        const iy = Math.min(y0 + bh, oy1) - Math.max(y0, oy0);
        if (ix > 0 && iy > 0) pen += ix * iy;
      }
      const dx = cx - w / 2, dy = cy - h * 0.46;
      pen += Math.sqrt(dx * dx + dy * dy) * 14;
      return pen;
    };
    const xs0 = bw / 2, xs1 = Math.max(xs0, w - bw / 2);
    const ys0 = bh / 2, ys1 = Math.max(ys0, h - bh / 2);
    let bcx = w / 2, bcy = h / 2, bestPen = Infinity;
    const NX = 7, NY = 6;
    for (let iy = 0; iy <= NY; iy++) for (let ix = 0; ix <= NX; ix++) {
      const cx = xs0 + (xs1 - xs0) * ix / NX, cy = ys0 + (ys1 - ys0) * iy / NY;
      const pn = score(cx, cy);
      if (pn < bestPen) { bestPen = pn; bcx = cx; bcy = cy; }
    }
    let stepX = (xs1 - xs0) / NX / 2, stepY = (ys1 - ys0) / NY / 2;
    for (let r = 0; r < 3; r++) {
      for (let k = 0; k < 8; k++) {
        const a = k * 0.7854;
        const cx = bcx + Math.cos(a) * stepX, cy = bcy + Math.sin(a) * stepY;
        const pn = score(cx, cy);
        if (pn < bestPen) { bestPen = pn; bcx = cx; bcy = cy; }
      }
      stepX /= 2; stepY /= 2;
    }
    if (this._homeGoal) {
      const cur = score(this._homeGoal.x + S.w / 2, this._homeGoal.y + S.h / 2);
      if (cur <= bestPen * 1.15 + 2500) { bcx = this._homeGoal.x + S.w / 2; bcy = this._homeGoal.y + S.h / 2; }
    }
    this._homeGoal = { x: bcx - S.w / 2, y: bcy - S.h / 2, w: S.w, h: S.h };
    if (!this.homeBox) this.homeBox = { ...this._homeGoal };
  }

  season(name) { // 'snow' | null
    this.mode = name === 'snow' ? 'snow' : 'home';
  }

  // The content's field: a single smooth push away from every content
  // block, felt at up to `fieldRadius` px and rising continuously toward
  // the middle — never a boolean "blocked", so nothing can pin a bird in
  // equilibrium against it. A slice of the push is rotated 90° (fieldSwirl)
  // so a bird gliding past a corner curves around it, like a field line,
  // instead of stalling nose-on. Deliberately not felt by the mark itself —
  // see setHome — so the mark's own shape is never distorted by its own
  // neighbourhood.
  _fieldForce(px, py, out) {
    const p = this.p, R = p.fieldRadius;
    let fx = 0, fy = 0;
    for (const o of this.obstacles) {
      const cx = px < o.x ? o.x : px > o.x + o.w ? o.x + o.w : px;
      const cy = py < o.y ? o.y : py > o.y + o.h ? o.y + o.h : py;
      let dx = px - cx, dy = py - cy;
      let d = Math.sqrt(dx * dx + dy * dy);
      if (d >= R) continue;
      let ux, uy, s;
      if (d < 1e-3) {
        // Inside: full-strength push straight out the NEAREST face — the
        // shortest way back to open air, matching the surface value of the
        // outside formula (s = 1) exactly, so crossing the boundary is
        // continuous. Never push from the block's centre: in a long, thin
        // block (a rule, the footer) that direction runs ALONG the block,
        // herding every bird that grazes in into a single file down its
        // length — and a centre distance fed into 1 − d/R goes far negative,
        // which s² silently turns into a force explosion. Both at once drew
        // a standing line of birds on every long content edge.
        const el = px - o.x, er = o.x + o.w - px, et = py - o.y, eb = o.y + o.h - py;
        const m = Math.min(el, er, et, eb);
        ux = m === el ? -1 : m === er ? 1 : 0;
        uy = m === et ? -1 : m === eb ? 1 : (ux === 0 ? 1 : 0);
        s = 1;
      } else {
        ux = dx / d; uy = dy / d;
        s = 1 - d / R;                   // 0 at the fuzzy edge, 1 at the surface
      }
      const mag = s * s * p.fieldForce;   // smoothstep-ish: continuous, no kink
      fx += ux * mag * (1 - p.fieldSwirl) + (-uy) * mag * p.fieldSwirl;
      fy += uy * mag * (1 - p.fieldSwirl) + (ux) * mag * p.fieldSwirl;
    }
    out.x = fx; out.y = fy;
  }

  // Send bird i off on a lap.  // Send bird i off on a lap. Every departure redraws its own ring — scale,
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

  // this.tgt holds each bird's point in the mark relative to the box's
  // top-left corner — not an absolute position. The box itself glides
  // around the viewport (see _placeHome), and every bird's actual target
  // is homeBox.xy + tgt, recomputed cheaply in _step without ever calling
  // this again just because the box moved.
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
      this.tgt[i * 2] = (pts[k * 2] / 100) * h.size.w;
      this.tgt[i * 2 + 1] = (pts[k * 2 + 1] / 100) * h.size.h;
    }
  }

  // Vsync snapping: a delta already within 12% of a whole number of steps IS
  // that many steps. Without it, rAF's sub-millisecond noise beats against the
  // 60 Hz sim — measured on 479 real deltas, only 49.5% of frames took one step,
  // 25.3% took two and 25.3% took none (and no step means no redraw). That beat
  // was the judder. Faster and genuinely slow frames still use the accumulator.
  advance(dt) {
    const k = Math.round(dt / STEP);
    if (k >= 1 && k <= MAX_STEPS && Math.abs(dt - k * STEP) < STEP * 0.12) {
      this._acc = 0;
      for (let i = 0; i < k; i++) this._step(STEP);
      return k;
    }
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

    const per2 = p.perception * p.perception;
    const scroll = this.scroll;
    const homing = mode === 'home' && !!this.tgt;

    // The mark lives in whitespace: find where it belongs right now (cheap —
    // see _placeHome) and glide the box toward it. No evacuation logic is
    // needed any more — the mark is simply always somewhere on-canvas, so
    // birds never have to flee it off scroll; they just track a box that
    // occasionally moves.
    if (this.home) {
      this._placeHome();
      const g = this._homeGoal, b = this.homeBox;
      const gdx = g.x - b.x, gdy = g.y - b.y, gd = Math.sqrt(gdx * gdx + gdy * gdy);
      if (gd > 0.3) {
        const gs = Math.min(gd * 2.4, 260); // eases in, capped — a deliberate glide, not a snap
        b.x += gdx / gd * gs * dt; b.y += gdy / gd * gs * dt;
      }
    }
    // The whole mark sways very slowly, so even at rest it is never a still image.
    const swayX = Math.sin(t * 0.31) * 5, swayY = Math.cos(t * 0.23) * 4;
    // The campus loop: a wide ellipse around wherever the mark currently is.
    const hb = this.homeBox;
    const ccx = hb ? hb.x + hb.w / 2 : this.w / 2, ccy = hb ? hb.y + hb.h / 2 : this.h * 0.45;
    const markR = hb ? Math.max(hb.w, hb.h) * 0.55 : 180;
    const ringX = Math.max(this.w * 0.36, markR + 90);
    const ringY = Math.max(this.h * 0.28, markR * 0.7 + 70);
    const ptr = this.pointer;
    const ptrMoving = ptr.on && ptr.speed > 2.5;

    for (let i = 0; i < n; i++) {
      const xi = x[i], yi = y[i];
      let Fx = 0, Fy = 0;
      const si = mode === 'snow' ? 0 : st[i];

      let sx = 0, sy = 0, ax = 0, ay = 0, cx = 0, cy = 0, cnt = 0;
      {
        // Separation looks a fifth of a second AHEAD: two birds on crossing
        // paths veer around each other instead of phasing through. Faster
        // birds also keep proportionally more clearance.
        const spi = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        const sepR = p.separation + spi * 0.14;
        const sep2i = sepR * sepR;
        const L = 0.2;
        const fxi = xi + vx[i] * L, fyi = yi + vy[i] * L;
        const gx = (xi / cell) | 0, gy = (yi / cell) | 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
          const bx = gx + ox, by = gy + oy;
          if (bx < 0 || by < 0 || bx >= cols || by >= rows) continue;
          for (let j = heads[by * cols + bx]; j !== -1; j = next[j]) {
            if (j === i) continue;
            const dx = x[j] - xi, dy = y[j] - yi, d2 = dx * dx + dy * dy;
            if (d2 > per2 || d2 === 0) continue;
            const pdx = (x[j] + vx[j] * L) - fxi, pdy = (y[j] + vy[j] * L) - fyi;
            const pd2 = pdx * pdx + pdy * pdy;
            if (pd2 < sep2i && pd2 > 1e-4) { const d = Math.sqrt(pd2); const wgt = 1 - d / sepR; sx -= pdx / d * wgt; sy -= pdy / d * wgt; }
            ax += vx[j]; ay += vy[j]; cx += dx; cy += dy; cnt++;
          }
        }
      }
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
      } else if (si === 0) { // HOME
        // HOME — spring to your point; hover slowly when you're there.
        if (homing) {
          const tx = hb.x + this.tgt[i * 2] + swayX, ty = hb.y + this.tgt[i * 2 + 1] + swayY;
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
        Fx += (this.escx[i] * this.vmax[i] * 1.35 - vx[i]) * 2.2;
        Fy += (this.escy[i] * this.vmax[i] * 1.35 - vy[i]) * 2.2;
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
        const rX = ringX * breathe, rY = ringY * breathe;
        const qx = (xi - cX) / rX, qy = (yi - cY) / rY;
        const qd = Math.sqrt(qx * qx + qy * qy) || 1e-3;
        const roamSp = p.roamSpeed * (0.8 + 0.4 * this.op[i]);
        // Tangent of the ellipse, back in real space.
        let tx = -qy * rX * this.odir[i], ty = qx * rY * this.odir[i];
        const tl = Math.sqrt(tx * tx + ty * ty) || 1e-3; tx /= tl; ty /= tl;
        // Radial correction toward the ring, back in real space.
        let ux = qx / qd * rX, uy = qy / qd * rY;
        const ul = Math.sqrt(ux * ux + uy * uy) || 1e-3; ux /= ul; uy /= ul;
        let rad = (1 - qd) * 110; rad = rad > 110 ? 110 : rad < -110 ? -110 : rad;
        Fx += (tx * roamSp + ux * rad - vx[i]) * 1.0;
        Fy += (ty * roamSp + uy * rad - vy[i]) * 1.0;
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
            this.escx[i] = (dx * ca - dy * sa) / d; this.escy[i] = (dx * sa + dy * ca) / d;
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
      // The content: one smooth, fuzzy push — see the header note on why
      // this replaced hard walls. Not felt at all in HOME (the mark holds
      // its own shape regardless of what's beneath it), only softly while
      // roaming or startled, so it reads as ambient guidance, never a cage.
      if (mode !== 'snow' && si !== 0 && this.obstacles.length) {
        const fv = this._dv;
        this._fieldForce(xi, yi + scroll, fv);
        Fx += fv.x; Fy += fv.y;
      }

      // Generic unstick: whatever the cause, a bird that stays near-still
      // for two seconds while off the mark breaks out on a random heading.
      // With no hard walls this rarely fires — it's a safety net, not a
      // load-bearing mechanic.
      {
        const sp2 = Math.sqrt(vx[i] * vx[i] + vy[i] * vy[i]);
        if (sp2 < 6 && si !== 0) {
          this.slow[i] += dt;
          if (this.slow[i] > 2) {
            this.slow[i] = 0; st[i] = 1; this.stT[i] = 0.5;
            const a2 = this.random() * 6.283;
            this.escx[i] = Math.cos(a2); this.escy[i] = Math.sin(a2);
          }
        } else this.slow[i] = 0;
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
    const { hd, hx, hy, hdw, fp, ef, br, bk } = this;
    const wSlow = p.turnRate * DEG, wSpan = (p.turnRateFast - p.turnRate) * DEG;
    const beatSpan = p.beatFast - p.beatSlow;
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

      /* --- Flight (DESIGN.md “Flight”) --------------------------------------
       * Attitude: the heading is STATE turning toward the velocity, rate-limited,
       * tighter the faster you go (ω = g·tanφ/v). Reading it off the velocity
       * instead — a bird hovering at 8 px/s — peaked at 10 744 °/s of spin.
       */
      const vm = this.vmax[i];
      let conf = sp / p.headingSpeed; if (conf > 1) conf = 1; conf *= conf;
      let fastn = sp / (vm * 0.8); if (fastn > 1) fastn = 1;
      const limMax = (wSlow + wSpan * fastn) * dt;
      let d = 0;
      if (sp > 1e-3) {
        d = Math.atan2(vy[i], vx[i]) - hd[i];
        if (d > PI) d -= TAU; else if (d < -PI) d += TAU;
        const lim = limMax * conf;
        if (d > lim) d = lim; else if (d < -lim) d = -lim;
      }
      // Oscillating, not drifting: a constant rate would turn every hovering
      // bird on the spot forever, which is a rotisserie, not a roost.
      hd[i] += d + hdw[i] * Math.sin(t * 0.37 + this.ph[i] * 2.3) * (1 - conf) * dt;
      if (hd[i] > PI) hd[i] -= TAU; else if (hd[i] < -PI) hd[i] += TAU;
      const ux = hx[i] = Math.cos(hd[i]), uy = hy[i] = Math.sin(hd[i]);

      /* GAIT. Three smoothed scalars, deliberately not a state machine: a
       * transition between gaits is then a blend by construction, with nothing
       * to sequence and nothing to snap. The wingbeat PHASE never resets and
       * never stops — only its depth and its rate change — so a bird powering
       * out of a glide picks the stroke up wherever the wing happened to be.
       *   drive  stroke depth: baseline for what it is DOING, plus what it is
       *          asking of the air now, less the stretches where it is fast and
       *          asking for nothing — which is what makes a roamer flap the
       *          turns and glide the straights, unsequenced. (Thrust alone fails:
       *          with no drag, a bird at escape speed demands nothing and came
       *          out gliding.)
       *   brake  thrust pointing BACKWARDS — the flare: wings forward and spread.
       *   bank   how much of its allowed turn it is actually using.
       */
      let push = (fx[i] * ux + fy[i] * uy) / p.maxForce;
      let thrust = push > 0 ? push : 0; if (thrust > 1) thrust = 1;
      let brake = push < 0 ? -push : 0; if (brake > 1) brake = 1;
      const si = mode === 'snow' ? 0 : st[i];   // snow has no states; it just falls
      let base;
      if (si === 1) base = 1.35;
      else if (si === 2) base = 0.42;
      else {
        // Settled: wings HELD, with a short flap now and then. This used to be a
        // flat 0.30 of stroke depth at 7.2 Hz — a beat every 8 frames, on every
        // bird, forever, which is not a roost but a shimmer. Each bird now has its
        // own gap and its own offset, so the mark never beats in unison, and the
        // smoothing on ef turns each burst into a swell rather than a switch.
        const per = p.restEvery + (this.op[i] - 0.775) * 10;   // 3.1…7.6 s, personal
        const u = t / per + this.ph[i] * 0.159;                // ph/TAU: a phase offset
        base = (u - Math.floor(u)) * per < p.restFlap ? 0.72 : 0.04;
      }
      let drive = base + 0.55 * thrust + 0.30 * brake - 0.42 * fastn * (1 - thrust);
      if (drive > 1) drive = 1; else if (drive < 0) drive = 0;
      ef[i] += (drive - ef[i]) * 0.10;      // ≈0.16 s to settle: gait changes over
      br[i] += (brake - br[i]) * 0.08;      // a few beats, never instantly
      bk[i] += (d / limMax - bk[i]) * 0.12;
      fp[i] += (p.beatSlow + beatSpan * ef[i]) * TAU * dt * tempo;
      if (fp[i] > TAU) fp[i] -= TAU;
    }

    // Housekeeping.
    this.pointer.speed *= 0.85;
    if (this.attractors.length) this.attractors = this.attractors.filter(a => a.until > t);
  }

  // --- Rendering ------------------------------------------------------------


  // One geometry pass per frame into reused scratch; the painters (WebGL or
  // Canvas 2D, below) only read it. Alpha 0 means culled.
  geometry() {
    const { n, x, y, hx, hy, op, fp, ef, br, bk, p } = this;
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
      // The heading and the gait were settled in _step; this pass is pose only.
      wingPose(hx[i], hy[i], fp[i], ef[i], br[i], bk[i], p.wing, p.bank, tips, i * 4);
    }
  }
}

// How a wing catches the light (DESIGN.md, "Light"): its screen normal is the
// segment turned 90°, so it flashes across the beam and goes dark edge-on.
// Both constants are injected into the GLSL below — one copy of each number.
export const GLINT = 0.5, SHADE_K = 3;
export function shade(dx, dy, lx, ly, glint) {
  const len = Math.hypot(dx, dy) || 1e-4;
  return glint * GLINT * Math.abs((dx * ly - dy * lx) / len) ** SHADE_K;
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
      // No MSAA (the fragment shader feathers its own edges), no depth, no
      // stencil: flat strokes want a bare colour buffer, and every buffer not
      // allocated is bandwidth the compositor never spends. desynchronized
      // lets the browser skip a compositor copy where it can.
      // failIfMajorPerformanceCaveat is the important one: it refuses a
      // SOFTWARE GL context (SwiftShader — blocklisted GPUs, many VMs). On
      // those machines "WebGL" is the slow path — measured headless: 23
      // draws/s against a 60 Hz rAF, while the Canvas 2D fallback keeps up —
      // so failing over to 2D is not a degradation, it is the fix.
      const opts = { alpha: true, antialias: false, depth: false, stencil: false,
        desynchronized: true, failIfMajorPerformanceCaveat: true,
        powerPreference: 'low-power', premultipliedAlpha: true };
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
      uniform vec2 ldir;                    // unit vector at the light
      uniform float glint;                  // the hour's raking strength
      varying float v; varying float dpx, lit;  // dpx: distance from centreline, px
      void main() {
        vec2 d = seg.zw - seg.xy;
        float len = max(length(d), 1e-4);
        vec2 u = d / len, n = vec2(-u.y, u.x);
        float hwE = hw + 0.75;              // expand for the feather
        vec2 p = seg.xy + u * (q.x * (len + 2.0 * hwE) - hwE) + n * (q.y * hwE);
        vec2 c = p / res * 2.0 - 1.0;
        gl_Position = vec4(c.x, -c.y, 0.0, 1.0);
        lit = glint * pow(abs(dot(n, ldir)), ${SHADE_K}.0);   // n IS the normal
        v = alp; dpx = q.y * hwE;
      }`));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform vec4 col; uniform float hw; uniform vec3 litCol;
      varying float v; varying float dpx, lit;
      void main() {
        float edge = clamp((hw + 0.375 - abs(dpx)) / 0.75, 0.0, 1.0); // ~1px feather
        float a = col.a * v * edge;
        gl_FragColor = vec4(mix(col.rgb, litCol, lit) * a, a);
      }`));
    gl.linkProgram(prog);
    this.ok = gl.getProgramParameter(prog, gl.LINK_STATUS);
    if (!this.ok) return; // GLPainter.try() will fall back to Canvas 2D
    gl.useProgram(prog);
    this.uRes = gl.getUniformLocation(prog, 'res');
    this.uHw = gl.getUniformLocation(prog, 'hw');
    this.uCol = gl.getUniformLocation(prog, 'col');
    this.uLdir = gl.getUniformLocation(prog, 'ldir');
    this.uGlint = gl.getUniformLocation(prog, 'glint');
    this.uLitCol = gl.getUniformLocation(prog, 'litCol');
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

  draw(f, { rgb = [0.5, 0.5, 0.5], alpha = 1, width = 1.25, w, h,
            light = [0, -1], litRgb = rgb, glint = 0 }) {
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
    gl.uniform2f(this.uLdir, light[0], light[1]);  // glint pre-scaled by GLINT
    gl.uniform1f(this.uGlint, glint * GLINT);
    gl.uniform3f(this.uLitCol, litRgb[0], litRgb[1], litRgb[2]);
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

  draw(f, { color = '#888', alpha = 1, width = 1.25, w, h,
            light = [0, -1], glint = 0 }) {
    const ctx = this.ctx, dpr = this.dpr;
    ctx.clearRect(0, 0, w * dpr, h * dpr);
    ctx.save();
    ctx.scale(dpr, dpr);
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.lineWidth = width; ctx.strokeStyle = color;
    const { n, x, y } = f, tips = f._tips, alp = f._alp, buck = f._buck;
    const buckets = 6, lx = light[0], ly = light[1];
    // Same shading, but per BIRD: both wings share one sub-path here, so the
    // brighter of the two picks the bucket — catching the light is a step up.
    for (let i = 0; i < n; i++) {
      if (alp[i] === 0) { buck[i] = 255; continue; }
      const o = i * 4;
      const s = glint === 0 ? 0 : Math.max(shade(tips[o], tips[o + 1], lx, ly, glint),
                                           shade(tips[o + 2], tips[o + 3], lx, ly, glint));
      buck[i] = Math.min(buckets - 1, (alp[i] * (1 + s) * buckets) | 0);
    }
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

const rgbOf = (hex) => {
  const c = parseInt(hex.slice(1), 16);
  return [(c >> 16 & 255) / 255, (c >> 8 & 255) / 255, (c & 255) / 255];
};

/*
 * Runner: owns a canvas (Offscreen or not), a Flock, and the frame loop.
 */
export class Runner {
  constructor(canvas, { raf = globalThis.requestAnimationFrame.bind(globalThis) } = {}) {
    this.canvas = canvas;
    this.painter = GLPainter.try(canvas) || new Canvas2DPainter(canvas);
    this.raf = raf;
    this.flock = null;
    // light: unit screen vector at the sun (or moon); lit: what a lit wing turns.
    this.style = { color: '#888', rgb: [0.5, 0.5, 0.5], alpha: 1, width: 1.25,
      light: [0, -1], lit: '#888', litRgb: [0.5, 0.5, 0.5], glint: 0 };
    this.dpr = 1; this.w = 1; this.h = 1; this.dirty = true;
    this.frames = 0; this.accum = 0; this.last = 0;
    this.still = false; this.running = false; this.onstats = null;
  }

  _style(st) {
    Object.assign(this.style, st);
    // '#rrggbb' → floats for the GL path: the stroke's colour, and the lit one.
    if (st.color) this.style.rgb = rgbOf(st.color);
    if (st.lit) this.style.litRgb = rgbOf(st.lit);
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
      case 'scroll': if (f) f.scroll = m.y; break;
      case 'snapshot': this.onsnapshot?.({ x: [...f.x], y: [...f.y], vx: [...f.vx], vy: [...f.vy], st: [...f.st], scroll: f.scroll, obstacles: f.obstacles, homeBox: f.homeBox ? { ...f.homeBox } : null, w: f.w, h: f.h }); break;
      case 'home': f?.setHome(m.points, m.aspect, m.size); if (this.still) this.settle(); break;
      case 'home-size': f?.setHomeSize(m.size); if (this.still) this.settle(180); break;
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
