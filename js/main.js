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
import { hueAt, flockColor } from './hue.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const STILL = params.has('still') || reduceMotion.matches;

let post;          // send a message to wherever the flock lives (set in §2)
let inWorker = false;
let stats = { fps: 0, n: 0 };

// Archive state (used across sections; the archive itself is §4).
const sheet = $('#sheet');
const sheetTitle = $('#sheet-title');
const rows = $$('.row');
const slugs = rows.map(r => r.dataset.slug);
const homes = new Map(); // slug → where its .sheet lives when closed
let opener = null, current = null; // the row that opened the sheet; the open slug

/* ---------------------------------------------------------------------------
 * 1. Hue of the day (see hue.js)
 * ------------------------------------------------------------------------- */
let hue = params.has('hue') ? +params.get('hue') : hueAt();
function applyHue() { root.style.setProperty('--hue', hue.toFixed(1)); pushStyle(); }
applyHue();
setInterval(() => { if (!params.has('hue')) { hue = hueAt(); applyHue(); } }, 60_000);

/* ---------------------------------------------------------------------------
 * Theme: follows the system; `t` or the footer dot cycles system → dark → light.
 * ------------------------------------------------------------------------- */
const darkMQ = matchMedia('(prefers-color-scheme: dark)');
const isDark = () => root.dataset.theme ? root.dataset.theme === 'dark' : darkMQ.matches;
const themeBtn = $('#theme-toggle');
function setTheme(mode) { // 'system' | 'dark' | 'light'
  if (mode === 'system') { delete root.dataset.theme; localStorage.removeItem('theme'); }
  else { root.dataset.theme = mode; localStorage.setItem('theme', mode); }
  themeBtn.setAttribute('aria-label', `Theme: ${mode}. Switch theme.`);
  pushStyle();
}
function cycleTheme() {
  const cur = root.dataset.theme || 'system';
  setTheme(cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system');
}
themeBtn.addEventListener('click', cycleTheme);
themeBtn.setAttribute('aria-label', `Theme: ${root.dataset.theme || 'system'}. Switch theme.`);
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
// 1.5x is plenty for 1.25 px strokes the shader already feathers, and it is
// 1.8x less to composite than 2x. Nobody has ever spotted the difference.
const dpr = () => (params.has('fdpr') ? +params.get('fdpr') : Math.min(1.5, devicePixelRatio || 1));
const vw = () => innerWidth;
const coarse = matchMedia('(pointer: coarse)').matches;
const TARGET = params.has('n') ? +params.get('n') : (coarse || innerWidth < 700 ? 60 : 140);
const seed = params.has('seed') ? +params.get('seed') : undefined;
const month = new Date().getMonth();
const season = params.get('season') || (month === 11 ? 'snow' : null);


function flockStyle() { return { color: flockColor(isDark(), hue) }; }
function pushStyle(extra) { post?.({ type: 'style', style: { ...flockStyle(), ...extra } }); }

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
    sendObstacles();
  });
}, { passive: true });
document.addEventListener('visibilitychange', () => post({ type: 'visible', value: !document.hidden }));
// The birds' sky is fixed; the page scrolls through it. One tiny message per
// scrolled frame — the worker does the subtraction, we read no layout here.
let scrollRaf = 0;
addEventListener('scroll', () => {
  if (!scrollRaf) scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; post({ type: 'scroll', y: scrollY }); });
}, { passive: true });
post({ type: 'scroll', y: scrollY });

/* ---------------------------------------------------------------------------
 * 3. What you do
 * ------------------------------------------------------------------------- */
// Pointer: mouse/pen repel, in document coordinates, at most once per frame.
let pointerRaf = 0, px = 0, py = 0;
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  px = e.clientX; py = e.clientY;
  if (!pointerRaf) pointerRaf = requestAnimationFrame(() => {
    pointerRaf = 0;
    const r = canvas.getBoundingClientRect();   // pointer in canvas-local px
    post({ type: 'pointer', x: px - r.left, y: py - r.top, on: true });
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
function homeSize() {
  const { w, h } = world;
  const bw = Math.min(w * 0.42, 620);
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
    if (!sheet.open) sheet.showModal();
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
  openSheet(slugs[i], { push: false });
}
rows.forEach(r => r.addEventListener('click', e => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button) return;
  e.preventDefault(); opener = r; openSheet(r.dataset.slug);
}));
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
  `%cflock%c ${TARGET} · rules: separation, alignment, cohesion, you · ${inWorker ? 'worker + OffscreenCanvas' : 'main thread'}${STILL ? ' · still' : ''} (renderer: flock.where)\n%cwindow.flock — { count, fps, params, home, season(), hue, seed } · ?n= ?seed= ?still ?hue= ?season=snow · press t`,
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
  snapshot() { return new Promise(r => { snapshotResolve = r; post({ type: 'snapshot' }); }); },
  get where() { return `${inWorker ? 'worker' : 'main'} · ${stats.renderer || 'starting'}`; },
  get _runner() { return mainRunner; }, // main-thread only; handy in DevTools
};
