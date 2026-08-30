/*
 * main.js — the page.
 *
 * Responsibilities, top to bottom:
 *   1. Hue of the day and theme.
 *   2. Start the flock (Worker + OffscreenCanvas, else main thread, else still).
 *   3. Feed it what you do: pointer, hover, scroll, tilt, taps, idleness.
 *   4. The archive: rows → <dialog>, deep links, keyboard, swipe.
 *   5. Small things: footer arrow, console, window.flock.
 *
 * Everything degrades: no Worker → main thread; no OffscreenCanvas → same;
 * reduced motion → one still frame; no script → the inline SVG still.
 */

import { Runner, MARK, MARK_ASPECT, DEFAULTS } from './flock.js';
import { hueAt, lightAt, flockColor } from './hue.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const STILL = params.has('still') || reduceMotion.matches;
// Which theme is in force. Up here because §1's light needs it too — the same
// sun tints one way on paper and another on a night sky.
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : darkMQ.matches;

let post;          // send a message to wherever the flock lives (set in §2)
let inWorker = false;
let stats = { fps: 0, n: 0 };

// Archive state (used across sections; the archive itself is §4).
const sheet = $('#sheet');
const sheetTitle = $('#sheet-title');
const rows = $$('.row[data-slug]');   // archive rows only — Making's row is a link out
const slugs = rows.map(r => r.dataset.slug);
const homes = new Map(); // slug → where its .sheet lives when closed
let opener = null, current = null; // the row that opened the sheet; the open slug

/* ---------------------------------------------------------------------------
 * 1. Hue of the day, and where the light comes from (see hue.js)
 *
 * One clock, two outputs. `?hour=` pins it for both, so tool shots reproduce;
 * `?hue=` still pins the accent on its own.
 * ------------------------------------------------------------------------- */
const pinnedHour = params.has('hour') ? +params.get('hour') : null;
function clock() {
  const d = new Date();
  if (pinnedHour !== null) d.setHours(pinnedHour | 0, (pinnedHour % 1) * 60, 0, 0);
  return d;
}
let hue = params.has('hue') ? +params.get('hue') : hueAt(clock());
let light = lightAt(clock(), isDark(), hue);
// The page reads the light as custom properties (the wash in style.css), the
// flock off the style message. Same numbers, one source.
function applyLight() {
  light = lightAt(clock(), isDark(), hue);
  root.style.setProperty('--light-x', (50 + Math.cos(light.az) * 62).toFixed(1) + '%');
  root.style.setProperty('--light-y', (50 + Math.sin(light.az) * 44).toFixed(1) + '%');
  root.style.setProperty('--glow', light.glow.toFixed(3));
}
function applyHue() { root.style.setProperty('--hue', hue.toFixed(1)); pushStyle(); }
applyHue();
setInterval(() => {
  if (pinnedHour !== null) return;
  if (!params.has('hue')) hue = hueAt(clock());
  applyHue();
}, 60_000);

/* ---------------------------------------------------------------------------
 * Theme: follows the system; `t` or the footer dot cycles system → dark → light.
 * ------------------------------------------------------------------------- */
const themeBtn = $('#theme-toggle');
// The word is the visible label AND part of the accessible name, so the two
// never disagree (WCAG 2.5.3). The icon is decorative — it repeats the word.
function labelTheme(mode) {
  const word = mode === 'dark' ? 'Dark' : mode === 'light' ? 'Light' : 'Auto';
  $('#theme-label').textContent = word;
  themeBtn.setAttribute('aria-label', `Theme: ${word}. Switch theme.`);
}
function setTheme(mode) { // 'system' | 'dark' | 'light'
  if (mode === 'system') { delete root.dataset.theme; localStorage.removeItem('theme'); }
  else { root.dataset.theme = mode; localStorage.setItem('theme', mode); }
  labelTheme(mode);
  pushStyle();
}
function cycleTheme() {
  const cur = root.dataset.theme || 'system';
  setTheme(cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system');
}
themeBtn.addEventListener('click', cycleTheme);
labelTheme(root.dataset.theme || 'system');
darkMQ.addEventListener('change', pushStyle);

/* ---------------------------------------------------------------------------
 * 2. The flock
 * ------------------------------------------------------------------------- */
let canvas = $('#flock');
// The flock's world is the canvas's own box — CSS decides where it sits
// (see style.css), JS just reads it. Everything is canvas-local from here.
let world = { w: 1, h: 1 };
function measureWorld() {
  const r = canvas.getBoundingClientRect();
  world = { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) };
  return world;
}
// The content walls, in document(+60px bleed) space — sent once per layout; the
// worker subtracts the live scroll offset, so scrolling reads no layout.
function sendObstacles() {
  const wide = vw() >= 700;
  const rects = $$('[data-obstacle]')
    .filter(el => wide || !el.dataset.obstacleWide)
    .map(el => {
      const r = el.getBoundingClientRect();
      return { x: r.left + 60, y: r.top + scrollY + 60, w: r.width, h: r.height };
    });
  post({ type: 'obstacles', rects });
}
// What the canvas costs is the number of device pixels the compositor moves
// each frame — the layer's AREA, not the ratio. A phone's canvas is a quarter
// of a desktop's in CSS px, so the flat 1.5 cap under-rendered exactly where
// the screen is sharpest: a DPR-3 phone drew at 1.5 and was upscaled 2x, and
// the birds went soft. So a small canvas may spend its ratio up until it costs
// what a 1440x900 desktop always has. This is a FLOOR-RAISING rule, not a true
// budget: 1.5 is still the minimum, so no large display renders worse than it
// did (a 5K one is over PIX and stays where it was), and 2 is the maximum,
// past which nothing shows on 1.25px strokes the shader already feathers.
const PIX = 3.6e6;                     // ≈ a 1440x900 desktop at 1.5x — the reference
const dpr = () => {
  if (params.has('fdpr')) return +params.get('fdpr');
  const area = Math.max(1, world.w * world.h);
  return Math.min(devicePixelRatio || 1, 2, Math.max(1.5, Math.sqrt(PIX / area)));
};
const vw = () => innerWidth;
const coarse = matchMedia('(pointer: coarse)').matches;
const TARGET = params.has('n') ? +params.get('n') : (coarse || innerWidth < 700 ? 120 : 140);
const seed = params.has('seed') ? +params.get('seed') : undefined;
const month = new Date().getMonth();
const season = params.get('season') || (month === 11 ? 'snow' : null);


function flockStyle() {
  return { color: flockColor(isDark(), hue), lit: light.tint, glint: light.glint,
    light: [Math.cos(light.az), Math.sin(light.az)] };
}
// applyLight() is a statement, not an argument: `post?.(…)` never evaluates its
// argument before the flock exists, and the page's light must not wait for it.
function pushStyle(extra) { applyLight(); post?.({ type: 'style', style: { ...flockStyle(), ...extra } }); }

function initMessage() {
  const { w, h } = measureWorld();
  return { type: 'init', dpr: dpr(), w, h, count: TARGET, seed, still: STILL, season, params: {} };
}

let snapshotResolve = null; // dev: window.flock.snapshot() — see tools/crowd.mjs
let mainRunner = null; // only when the flock runs on the main thread
function startMainThread() {
  inWorker = false;
  const runner = mainRunner = new Runner(canvas);
  runner.onstats = s => { stats = s; };
  post = m => runner.handle(m);
  post(initMessage());
  pushStyle();
}

function startWorker() {
  if (params.has('mainthread') || !('transferControlToOffscreen' in canvas) || typeof Worker === 'undefined') return false;
  try {
    const worker = new Worker(new URL('./flock.worker.js', import.meta.url), { type: 'module' });
    const off = canvas.transferControlToOffscreen();
    worker.postMessage({ type: 'canvas', canvas: off }, [off]);
    worker.onmessage = ({ data }) => {
      if (data.type === 'stats') stats = data;
      else if (data.type === 'snapshot') snapshotResolve?.(data);
    };
    worker.onerror = (e) => { // e.g. module workers unsupported: start over on a fresh canvas
      console.warn('flock: worker failed, falling back to main thread —', e.message);
      worker.terminate();
      const fresh = canvas.cloneNode(); canvas.replaceWith(fresh); canvas = fresh;
      startMainThread();
    };
    post = m => worker.postMessage(m);
    inWorker = true;
    post(initMessage());
    pushStyle();
    return true;
  } catch { return false; }
}
if (!startWorker()) startMainThread();
// The canvas is live: only now may the no-JS still stand down (see style.css).
// Anything that throws above this line leaves the still on screen, which is
// the whole point — the fallback outlives a broken main.js.
root.classList.add('flock-on');

// Keep the canvas the size of the viewport.
let resizeRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    const { w, h } = measureWorld();
    post({ type: 'resize', dpr: dpr(), w, h });
    post({ type: 'home-size', size: homeSize() });
    post({ type: 'scroll', y: scrollOffset() });
    sendObstacles();
  });
}, { passive: true });
document.addEventListener('visibilitychange', () => post({ type: 'visible', value: !document.hidden }));
// The birds' sky is fixed and the page scrolls through it — one tiny message
// per scrolled frame, and the worker does the subtraction so we read no layout
// here. Except on a phone, where style.css anchors the canvas to the document
// and the sky scrolls away with the hero: the world does not move there, so the
// offset is a constant 0 and the per-frame message is not sent at all.
const heroBound = matchMedia('(max-width: 699px)');   // must match style.css
const scrollOffset = () => (heroBound.matches ? 0 : scrollY);
let scrollRaf = 0;
addEventListener('scroll', () => {
  if (heroBound.matches) return;
  if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; post({ type: 'scroll', y: scrollOffset() }); });
}, { passive: true });
post({ type: 'scroll', y: scrollOffset() });
// Crossing the breakpoint swaps which of the two the canvas is doing.
heroBound.addEventListener('change', () => post({ type: 'scroll', y: scrollOffset() }));

/* ---------------------------------------------------------------------------
 * 3. What you do
 * ------------------------------------------------------------------------- */
// Point at something being made and the mark condenses and comes over, then
// drifts back. It moves the MARK, not the birds — in HOME every bird is
// committed to its point, so an attractor beside them does nothing (DESIGN.md,
// "Two tenses"). Small, because at full size it cannot fit beside a 60rem
// column and overlap rightly outranks the lure.
let overMaking = false;
const finePointer = matchMedia('(pointer: fine)');
const LURE_SCALE = 0.42;
function lure(row) {
  if (!row) { post({ type: 'lure', at: null }); post({ type: 'home-size', size: homeSize() }); return; }
  const r = row.getBoundingClientRect(), c = canvas.getBoundingClientRect();
  const full = homeSize();
  post({ type: 'home-size', size: { w: full.w * LURE_SCALE, h: full.h * LURE_SCALE } });
  post({ type: 'lure', at: { x: r.left + r.width / 2 - c.left, y: r.top + r.height / 2 - c.top } });
}
if (!STILL) $$('#making .row').forEach(row => {
  row.addEventListener('mouseenter', () => { if (finePointer.matches) { overMaking = true; lure(row); } });
  row.addEventListener('mouseleave', () => { overMaking = false; lure(null); });
});

// Pointer: mouse/pen repel, in document coordinates, at most once per frame.
let pointerRaf = 0, px = 0, py = 0;
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  px = e.clientX; py = e.clientY;
  if (!pointerRaf) pointerRaf = requestAnimationFrame(() => {
    pointerRaf = 0;
    const r = canvas.getBoundingClientRect();   // pointer in canvas-local px
    // Repel off over a Making row: birds it just called over should not then be
    // scattered by the very cursor that called them.
    post({ type: 'pointer', x: px - r.left, y: py - r.top, on: !overMaking });
  });
}, { passive: true });
addEventListener('pointerleave', () => post({ type: 'pointer', on: false, x: -1e4, y: -1e4 }));
document.addEventListener('mouseleave', () => post({ type: 'pointer', on: false, x: -1e4, y: -1e4 }));

// Taps gather the flock for a moment. The first tap also asks (once) for tilt.
let tapStart = null;
addEventListener('pointerdown', e => { if (e.pointerType === 'touch') tapStart = { x: e.clientX, y: e.clientY, t: performance.now() }; }, { passive: true });
addEventListener('pointerup', e => {
  if (e.pointerType !== 'touch' || !tapStart) return;
  const moved = Math.hypot(e.clientX - tapStart.x, e.clientY - tapStart.y);
  if (moved < 12 && performance.now() - tapStart.t < 400) {
    const r = canvas.getBoundingClientRect();
    post({ type: 'attract', id: 'tap', x: e.clientX - r.left, y: e.clientY - r.top, r: 110, k: 1.6, life: 1.3 });
    requestTilt();
  }
  tapStart = null;
}, { passive: true });

// Tilt: the flock leans the way the phone leans.
let tiltOn = false;
function requestTilt() {
  if (tiltOn || typeof DeviceOrientationEvent === 'undefined') return;
  const go = () => { tiltOn = true; addEventListener('deviceorientation', onTilt, { passive: true }); };
  if (typeof DeviceOrientationEvent.requestPermission === 'function') {
    DeviceOrientationEvent.requestPermission().then(s => { if (s === 'granted') go(); }).catch(() => {});
  } else go();
}
function onTilt(e) {
  if (e.gamma == null) return;
  const gx = Math.sin(e.gamma * Math.PI / 180) * 70;
  const gy = Math.max(-1, Math.min(1, ((e.beta ?? 45) - 45) / 45)) * 40;
  post({ type: 'gravity', x: gx, y: gy });
}

// Home: the 2013 jm mark. Only its SIZE is decided here — where it sits is
// the worker's own job (a placement solver finds whatever whitespace is on
// screen and glides the mark there; see flock.js). So there is nothing to
// recompute on scroll from this side at all — one message at startup, and
// one again if the viewport resizes and the ideal size changes.
// The mark is sized in BIRD-WIDTHS, not in screen fractions. A bird is one
// fixed size everywhere (flight.mjs holds it there), so a mark that takes a
// constant 42% of the canvas is ~119 birds across a desktop and only ~41
// across a phone — at which point the strokes cannot separate and the jm
// collapses into a blob however many birds you throw at it. Phones therefore
// give the mark a much larger share of a much smaller canvas.
function homeSize() {
  const { w } = world;
  const bw = Math.min(w * (vw() < 700 ? 0.66 : 0.42), 620);
  return { w: bw, h: bw / MARK_ASPECT };
}
function sendHome() { post({ type: 'home', points: MARK, aspect: MARK_ASPECT, size: homeSize() }); }
sendHome();
sendObstacles();

/* ---------------------------------------------------------------------------
 * 4. The archive
 * ------------------------------------------------------------------------- */

function openSheet(slug, { push = true } = {}) {
  const node = document.getElementById(slug);
  if (!node || !node.classList.contains('sheet')) return;
  const go = () => {
    if (current && current !== slug) putBack(current);
    homes.set(slug, node.parentNode);
    sheet.append(node);
    sheetTitle.textContent = $(`.row[data-slug="${slug}"] .name`).textContent;
    sheet.setAttribute('aria-label', sheetTitle.textContent);
    if (!sheet.open) {
      sheet.showModal();
      // showModal() focuses the first focusable thing it finds, which is the ←
      // button — so a sheet opened by tapping a row arrived with a ring drawn
      // round a control nobody asked for. Focus the dialog itself instead
      // (ARIA's own modal pattern): the sheet's name is announced, the trap and
      // ESC are unaffected, and the first Tab still lands on ←.
      sheet.focus({ preventScroll: true });
      // A deep link (/#unlistr) opens the sheet while the page is still
      // loading, and the load that follows hands focus back to <body> — with a
      // modal open, which leaves a screen reader standing outside it. Re-assert
      // once, after the page has settled.
      if (document.readyState !== 'complete') addEventListener('load', () => { if (sheet.open) sheet.focus({ preventScroll: true }); }, { once: true });
    }
    root.classList.add('sheet-open');
    sheet.scrollTop = 0;
    current = slug;
  };
  if (push) history.pushState({ slug }, '', `#${slug}`);
  go();
  // The flock dims and slows while you read.
  post({ type: 'tempo', value: 0.35 }); pushStyle({ alpha: 0.8 });
  $('#sheet-prev').disabled = slugs.indexOf(slug) === 0;
  $('#sheet-next').disabled = slugs.indexOf(slug) === slugs.length - 1;
}
function putBack(slug) {
  const node = document.getElementById(slug), home = homes.get(slug);
  if (node && home && node.parentNode !== home) home.append(node);
}
function closeSheet({ back = true } = {}) {
  if (!current) return;
  const slug = current; current = null;
  if (sheet.open) sheet.close();
  putBack(slug);
  root.classList.remove('sheet-open');
  post({ type: 'tempo', value: 1 }); pushStyle({ alpha: 1 });
  if (back && history.state?.slug) history.back();
  else if (back) history.replaceState(null, '', '#archive');
  opener?.focus({ preventScroll: true });
}
sheet.addEventListener('close', () => closeSheet()); // ESC (and any other native close)
sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); }); // backdrop
$('#sheet-close').addEventListener('click', () => closeSheet());
$('#sheet-prev').addEventListener('click', () => step(-1));
$('#sheet-next').addEventListener('click', () => step(1));
function step(d) {
  const i = slugs.indexOf(current) + d;
  if (i < 0 || i >= slugs.length) return;
  history.replaceState({ slug: slugs[i] }, '', `#${slugs[i]}`);
  // Prev/next crossfades the figures (see style.css). Opening stays instant.
  const go = () => openSheet(slugs[i], { push: false });
  if (document.startViewTransition && !reduceMotion.matches) document.startViewTransition(go);
  else go();
}
rows.forEach(r => r.addEventListener('click', e => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault(); opener = r; openSheet(r.dataset.slug);
}));
// Point at a row and its first screenshot starts loading, so the sheet opens
// warm. Intent, not prediction: it costs nothing until you aim at something.
// Once per target, and never when the connection has asked us to be frugal.
const warmed = new Set();
function warm(href) {
  if (warmed.has(href) || navigator.connection?.saveData === true) return;
  warmed.add(href);
  const l = document.createElement('link');
  l.rel = 'prefetch'; l.href = href;
  document.head.append(l);
}
$$('.row').forEach(r => {
  const slug = r.dataset.slug;
  const on = () => warm(slug ? `img/archive/${slug}-1.avif` : r.getAttribute('href'));
  r.addEventListener('mouseenter', on, { once: true });
  r.addEventListener('focusin', on, { once: true });
});
// Swipe between projects on touch.
let swipe = null;
sheet.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') swipe = { x: e.clientX, y: e.clientY }; }, { passive: true });
sheet.addEventListener('pointerup', e => {
  if (!swipe) return;
  const dx = e.clientX - swipe.x, dy = e.clientY - swipe.y; swipe = null;
  if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) step(dx < 0 ? 1 : -1);
}, { passive: true });
addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  if (sheet.open && e.key === 'ArrowRight') step(1);
  else if (sheet.open && e.key === 'ArrowLeft') step(-1);
  else if (!sheet.open && (e.key === 't' || e.key === 'T') && !e.metaKey && !e.ctrlKey && !e.altKey) cycleTheme();
});
// Deep links and back/forward.
addEventListener('popstate', () => route(false));
function route(push) {
  const slug = location.hash.slice(1);
  if (slugs.includes(slug)) { if (current !== slug) openSheet(slug, { push }); }
  else if (sheet.open) closeSheet({ back: false });
}
route(false);

/* ---------------------------------------------------------------------------
 * 5. Small things
 * ------------------------------------------------------------------------- */
// The footer arrow fades in the first time it scrolls into view. (It used to
// be traced by a boid, but the footer is outside the flock's world now that
// the birds live only in the hero — a fair trade for compositor scrolling.)
const arrow = $('.site-footer .arrow');
if (arrow && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(([en]) => {
    if (!en.isIntersecting) return;
    io.disconnect();
    arrow.classList.add('drawn');
  }, { threshold: 1 });
  io.observe(arrow);
} else arrow?.classList.add('drawn');

// Console: one line, and a handle to poke at.
console.log(
  `%cflock%c ${TARGET} · rules: separation, alignment, cohesion, you · ${inWorker ? 'worker + OffscreenCanvas' : 'main thread'}${STILL ? ' · still' : ''} (renderer: flock.where)\n%cwindow.flock — { count, fps, params, home, season(), hue, seed } · ?n= ?seed= ?still ?hue= ?hour= ?season=snow · press t`,
  'font-weight:600', '', 'color:gray');
window.flock = {
  get count() { return stats.n; },
  set count(v) { post({ type: 'count', value: +v }); },
  get fps() { return Math.round(stats.fps); },
  get params() { return { ...DEFAULTS }; },
  set params(p) { post({ type: 'params', params: p }); },
  get home() { return homeSize(); },
  set home(on) { on ? sendHome() : post({ type: 'home-off' }); },
  season: s => post({ type: 'season', season: s }),
  tempo: v => post({ type: 'tempo', value: v }),
  get seed() { return seed; },
  get hue() { return hue; },
  set hue(v) { hue = +v; applyHue(); },
  get light() { return { ...light, az: light.az * 180 / Math.PI }; },
  snapshot() { return new Promise(r => { snapshotResolve = r; post({ type: 'snapshot' }); }); },
  get where() { return `${inWorker ? 'worker' : 'main'} · ${stats.renderer || 'starting'}`; },
  get _runner() { return mainRunner; }, // main-thread only; handy in DevTools
};
