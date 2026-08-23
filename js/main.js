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
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const STILL = params.has('still') || reduceMotion.matches;

let post;          // send a message to wherever the flock lives (set in §2)
let inWorker = false;
let stats = { fps: 0, n: 0 };

// Archive state (used across sections; the archive itself is §4).
const sheet = $('#sheet');
const sheetTitle = $('#sheet-title');
const preview = $('#preview'), previewImg = $('img', preview);
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
const dpr = () => Math.min(2, devicePixelRatio || 1);
const vw = () => innerWidth, vh = () => innerHeight;
const coarse = matchMedia('(pointer: coarse)').matches;
const TARGET = params.has('n') ? +params.get('n') : (coarse || innerWidth < 700 ? 70 : 200);
const seed = params.has('seed') ? +params.get('seed') : undefined;
const month = new Date().getMonth();
const season = params.get('season') || (month === 11 ? 'snow' : null);


function flockStyle() { return { color: flockColor(isDark(), hue) }; }
function pushStyle(extra) { post?.({ type: 'style', style: { ...flockStyle(), ...extra } }); }

function initMessage() {
  return { type: 'init', dpr: dpr(), w: vw(), h: vh(), count: TARGET, seed, still: STILL, season, params: {} };
}

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
    worker.onmessage = ({ data }) => { if (data.type === 'stats') stats = data; };
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

// Keep the canvas the size of the viewport.
let resizeRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => { post({ type: 'resize', dpr: dpr(), w: vw(), h: vh() }); sendObstacles(); });
}, { passive: true });
document.addEventListener('visibilitychange', () => post({ type: 'visible', value: !document.hidden }));

/* ---------------------------------------------------------------------------
 * 3. What you do
 * ------------------------------------------------------------------------- */
// The flock respects the text: rectangles it steers around, in viewport space.
const obstacles = $$('[data-obstacle]');
function sendObstacles() {
  if (current) { // a sheet is open: it is the only obstacle
    const r = sheet.getBoundingClientRect();
    return post({ type: 'obstacles', rects: [{ x: r.left, y: r.top, w: r.width, h: r.height + 100 }] });
  }
  const wide = vw() >= 700;
  const rects = obstacles.filter(el => wide || !el.dataset.obstacleWide)
    .map(el => el.getBoundingClientRect()).filter(r => r.bottom > 0 && r.top < vh())
    .map(r => ({ x: r.left, y: r.top, w: r.width, h: r.height }));
  post({ type: 'obstacles', rects });
}
sendObstacles();

// Pointer: mouse/pen repel. Touch is handled as taps below (dragging scrolls).
let idleTimer = 0, formedIdle = false, shatterTimer = 0;
function touched() { // any input resets idleness; if the mark had formed, it notices you and lets go
  if (formedIdle) { clearTimeout(shatterTimer); shatterTimer = setTimeout(() => { post({ type: 'release' }); formedIdle = false; }, 260); }
  clearTimeout(idleTimer);
  if (!STILL && !sheet.open) idleTimer = setTimeout(idleForm, 20_000);
}
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  post({ type: 'pointer', x: e.clientX, y: e.clientY, on: true });
  if (preview.classList.contains('on')) movePreview(e.clientX, e.clientY);
  touched();
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
    post({ type: 'attract', id: 'tap', x: e.clientX, y: e.clientY, r: 110, k: 1.6, life: 1.3 });
    requestTilt();
    touched();
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

// Scroll: wind. Content goes up, the flock is blown up with it, then settles.
let lastY = scrollY;
addEventListener('scroll', () => {
  const dy = scrollY - lastY; lastY = scrollY;
  post({ type: 'wind', x: 0, y: -Math.max(-60, Math.min(60, dy)) * 4 });
  sendObstacles();
  touched();
}, { passive: true });

// Hover: whatever you point at, the flock leans toward; links get their
// underline traced by a few boids breaking off.
if (finePointer.matches) {
  let hoverId = 0;
  document.addEventListener('pointerover', e => {
    const a = e.target.closest('a, button');
    if (!a || a.closest('dialog')) return;
    const r = a.getBoundingClientRect();
    post({ type: 'attract', id: 'hover', x: r.left + r.width / 2, y: r.top + r.height / 2, r: Math.max(60, r.width / 2), k: 0.9, life: 30 });
    if (a.matches('a:not(.row)')) { // trace the underline itself, not the (taller) tap target
      const range = document.createRange(); range.selectNodeContents(a);
      const t = range.getBoundingClientRect();
      post({ type: 'trace', x0: t.left, y0: t.bottom + 1, x1: t.right, y1: t.bottom + 1, count: 4, dur: 0.8 });
    }
    hoverId++;
  });
  document.addEventListener('pointerout', e => {
    const a = e.target.closest('a, button');
    if (!a || a.closest('dialog')) return;
    if (e.relatedTarget && a.contains(e.relatedTarget)) return;
    post({ type: 'attract', id: 'hover', x: 0, y: 0, r: 1, k: 0, life: 0 });
  });
}

// The mark. On load the flock assembles into the 2013 jm, holds, and lets go.
function markBox() {
  const w = vw(), h = vh();
  const text = $('.hero-text').getBoundingClientRect();
  let bw = Math.min(w * 0.42, 560), cx = w * 0.66, cy = h * 0.40;
  if (w < 700) { bw = w * 0.66; cx = w * 0.5; cy = Math.min(h * 0.33, text.top / 2); }
  const bh = bw / MARK_ASPECT;
  return { x: cx - bw / 2, y: cy - bh / 2, w: bw, h: bh };
}
function formMark(hold) { post({ type: 'form', points: MARK, aspect: MARK_ASPECT, box: markBox(), hold }); }
function idleForm() { if (sheet.open || STILL) return; formedIdle = true; formMark(0); }

if (!STILL) {
  const seen = localStorage.getItem('seen');
  // Let the page paint and the fonts land, then assemble.
  const delay = seen ? 250 : 600;
  setTimeout(() => { formMark(seen ? 0.5 : 1.1); }, delay);
  try { localStorage.setItem('seen', '1'); } catch {}
  idleTimer = setTimeout(idleForm, 20_000);
}

/* ---------------------------------------------------------------------------
 * 4. The archive
 * ------------------------------------------------------------------------- */

const vt = (fn) => (document.startViewTransition && !reduceMotion.matches) ? document.startViewTransition(fn) : (fn(), null);

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
    // A few birds settle on the sheet's top edge, like a wire.
    // Measure once the entrance animation has settled, not mid-flight.
    Promise.all(sheet.getAnimations().map(a => a.finished)).catch(() => {}).then(() => {
      if (current !== slug) return;
      const r = sheet.getBoundingClientRect();
      if (r.top > 12) post({ type: 'perch', segment: { x0: r.left + 16, y0: r.top - 3, x1: r.right - 16, y1: r.top - 3 } });
      sendObstacles();
    });
  };
  if (push) history.pushState({ slug }, '', `#${slug}`);
  vt(go);
  // The flock dims and slows while you read, and keeps to the margins.
  post({ type: 'tempo', value: 0.35 }); pushStyle({ alpha: 0.8 });
  post({ type: 'attract', id: 'hover', x: 0, y: 0, r: 1, k: 0, life: 0 });
  post({ type: 'attract', id: 'preview', x: 0, y: 0, r: 1, k: 0, life: 0 });
  preview.classList.remove('on');
  clearTimeout(idleTimer);
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
  vt(() => { if (sheet.open) sheet.close(); putBack(slug); root.classList.remove('sheet-open'); });
  post({ type: 'tempo', value: 1 }); pushStyle({ alpha: 1 }); post({ type: 'perch', segment: null });
  requestAnimationFrame(sendObstacles);
  if (back && history.state?.slug) history.back();
  else if (back) history.replaceState(null, '', '#archive');
  opener?.focus({ preventScroll: true });
  touched();
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
  touched();
});
// Deep links and back/forward.
addEventListener('popstate', () => route(false));
function route(push) {
  const slug = location.hash.slice(1);
  if (slugs.includes(slug)) { if (current !== slug) openSheet(slug, { push }); }
  else if (sheet.open) closeSheet({ back: false });
}
route(false);

// Hover previews: a small greyscale glimpse near the pointer.
const archiveEl = $('.archive');
function movePreview(x, y) {
  if (vw() < 1100) return;
  const a = archiveEl.getBoundingClientRect();
  const px = Math.min(a.right + 40, vw() - 320 - 24);
  const py = Math.max(120, Math.min(y, vh() - 120));
  preview.style.setProperty('--px', `${px}px`); preview.style.setProperty('--py', `${py}px`);
  post({ type: 'attract', id: 'preview', x: px + 160, y: py, r: 190, k: 0.7, life: 0.6 });
}
if (finePointer.matches) {
  rows.forEach(r => {
    r.addEventListener('pointerenter', e => {
      const s = r.dataset.slug;
      previewImg.src = `img/archive/${s}-preview.webp`;
      movePreview(e.clientX, e.clientY);
      preview.classList.add('on');
    });
    r.addEventListener('pointerleave', () => preview.classList.remove('on'));
  });
}

/* ---------------------------------------------------------------------------
 * 5. Small things
 * ------------------------------------------------------------------------- */
// The footer arrow is drawn by a boid the first time it scrolls into view.
const arrow = $('.site-footer .arrow');
if (arrow && 'IntersectionObserver' in window) {
  const io = new IntersectionObserver(([en]) => {
    if (!en.isIntersecting) return;
    io.disconnect();
    const r = arrow.getBoundingClientRect();
    if (!STILL) post({ type: 'trace', x0: r.left - 40, y0: r.top + r.height * 0.55, x1: r.right + 8, y1: r.top + r.height * 0.55, count: 1, dur: 0.9 });
    setTimeout(() => arrow.classList.add('drawn'), STILL ? 0 : 650);
  }, { threshold: 1 });
  io.observe(arrow);
}

// Console: one line, and a handle to poke at.
console.log(
  `%cflock%c ${TARGET} · rules: separation, alignment, cohesion, you · ${inWorker ? 'worker + OffscreenCanvas' : 'main thread'}${STILL ? ' · still' : ''}\n%cwindow.flock — { count, params, form(), release(), season(), seed } · ?n= ?seed= ?still ?hue= ?season=snow · press t`,
  'font-weight:600', '', 'color:gray');
window.flock = {
  get count() { return stats.n; },
  set count(v) { post({ type: 'count', value: +v }); },
  get fps() { return Math.round(stats.fps); },
  get params() { return { ...DEFAULTS }; },
  set params(p) { post({ type: 'params', params: p }); },
  form: () => formMark(0),
  release: () => post({ type: 'release' }),
  season: s => post({ type: 'season', season: s }),
  tempo: v => post({ type: 'tempo', value: v }),
  get seed() { return seed; },
  get hue() { return hue; },
  set hue(v) { hue = +v; applyHue(); },
  get where() { return inWorker ? 'worker' : 'main'; },
  get _runner() { return mainRunner; }, // main-thread only; handy in DevTools
};
