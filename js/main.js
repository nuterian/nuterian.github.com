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

// Note what is NOT imported here: flock.js. On the path almost everyone takes
// the simulation runs in the worker, and the page downloading a copy it will
// never execute was the single largest item on this page — 22.7 KB, paid twice,
// because the worker fetches it too. The page needs the mark (which lives in
// mark.js, where this now asks for it), and the Runner ONLY if the worker path
// fails, so that one is fetched at the moment it is needed and not before.
import { MARK, MARK_ASPECT, markSize } from './mark.js';
import { hueAt } from './hue.js';
import { setTheme as applyTheme, nextTheme, lightStyle } from './theme.js';
import { count } from './count.js';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const root = document.documentElement;
const params = new URLSearchParams(location.search);
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const STILL = params.has('still') || reduceMotion.matches;
const darkMQ = matchMedia('(prefers-color-scheme: dark)');

// Send a message to wherever the flock lives (§2). Until it lives anywhere,
// messages wait in line: the worker path replaces this within the same tick,
// but the main-thread fallback has to load the simulation first.
const pending = [];
let post = m => pending.push(m);
const flush = () => { for (const m of pending.splice(0)) post(m); };
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
// …and the slower clock: the moon's phase, which the night's glint follows.
const pinnedMoon = params.has('moon') ? +params.get('moon') : undefined;
function clock() {
  const d = new Date();
  if (pinnedHour !== null) d.setHours(pinnedHour | 0, (pinnedHour % 1) * 60, 0, 0);
  return d;
}
let hue = params.has('hue') ? +params.get('hue') : hueAt(clock());
let light; // the hour's light, kept for window.flock.light (set by pushStyle)
function applyHue() { root.style.setProperty('--hue', hue.toFixed(1)); pushStyle(); }
applyHue();
// …and only now may the hue animate. The transition exists for the drift from
// one hour to the next, a few degrees at a time; applied to the FIRST hue it
// animated the whole way from the stylesheet's static default, straight through
// hues the palette does not contain (style.css, .hue-live). Two frames, because
// the class must not land in the same style recalculation as the value.
requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('hue-live')));
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
function setTheme(mode) { // 'system' | 'dark' | 'light' — theme.js applies, this page labels
  applyTheme(mode);
  labelTheme(mode);
  pushStyle();
}
function cycleTheme() { setTheme(nextTheme()); }
themeBtn.addEventListener('click', cycleTheme);
labelTheme(root.dataset.theme || 'system');
darkMQ.addEventListener('change', pushStyle);

/* ---------------------------------------------------------------------------
 * The visible viewport. index.html sets --vh before first paint; this keeps it
 * true as the browser's chrome comes and goes. See .hero in style.css for why
 * neither svh nor dvh can do this job on its own.
 *
 * Pinch-zoom is deliberately ignored: zoomed in, visualViewport.height is the
 * slice of the page you are magnifying, not the window — honouring it would
 * collapse the hero the moment someone zoomed a screenshot in the archive.
 * ------------------------------------------------------------------------- */
if (window.visualViewport) {
  const vv = visualViewport;
  let vhRaf = 0;
  const applyVH = () => { vhRaf = 0; if (vv.scale <= 1.01) root.style.setProperty('--vh', vv.height + 'px'); };
  vv.addEventListener('resize', () => { if (!vhRaf) vhRaf = requestAnimationFrame(applyVH); }, { passive: true });
  applyVH();
}

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
// Measured NOW, not at init. `homeSize()` is a function of the canvas's width,
// and on the main-thread path init happens after an await — so a home message
// composed before then would have carried a mark sized against the placeholder
// 1×1 world. It did: the landscape gate caught a 0.66 px mark.
measureWorld();
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


// lightStyle() runs unconditionally: the page's light must not wait for a
// flock that may not exist yet — only the posting is optional.
function pushStyle(extra) {
  const r = lightStyle(clock(), hue, pinnedMoon);
  light = r.light;
  post?.({ type: 'style', style: { ...r.style, ...extra } });
}

function initMessage() {
  const { w, h } = measureWorld();
  return { type: 'init', dpr: dpr(), w, h, count: TARGET, seed, still: STILL, season, params: {} };
}

let snapshotResolve = null; // dev: window.flock.snapshot() — see tools/crowd.mjs
let mainRunner = null; // only when the flock runs on the main thread
// The fallback, and the only place the page ever loads the simulation itself.
// It is async because of that, which is why `post` queues: everything below
// carries on addressing a flock that is still arriving.
async function startMainThread() {
  inWorker = false;
  post = m => pending.push(m);   // a dead worker may have been holding this
  const { Runner } = await import('./flock.js');
  const runner = mainRunner = new Runner(canvas);
  runner.onstats = s => { stats = s; };
  runner.ondraw = live;
  post = m => runner.handle(m);
  post(initMessage());   // always first: everything else addresses the flock it makes
  pushStyle();
  flush();
}

function startWorker() {
  if (params.has('mainthread') || !('transferControlToOffscreen' in canvas) || typeof Worker === 'undefined') return false;
  try {
    const worker = new Worker(new URL('./flock.worker.js', import.meta.url), { type: 'module' });
    const off = canvas.transferControlToOffscreen();
    worker.postMessage({ type: 'canvas', canvas: off }, [off]);
    worker.onmessage = ({ data }) => {
      if (data.type === 'stats') stats = data;
      else if (data.type === 'drew') live();
      else if (data.type === 'snapshot') snapshotResolve?.(data);
    };
    worker.onerror = (e) => { // e.g. module workers unsupported: start over on a fresh canvas
      console.warn('flock: worker failed, falling back to main thread —', e.message);
      worker.terminate();
      const fresh = canvas.cloneNode(); canvas.replaceWith(fresh); canvas = fresh;
      startMainThread().catch(() => {});
    };
    post = m => worker.postMessage(m);
    inWorker = true;
    post(initMessage());   // always first: everything else addresses the flock it makes
    pushStyle();
    flush();
    return true;
  } catch { return false; }
}
// The still stands down only when there are actually birds on the canvas — not
// when a worker has been constructed, which is what this used to wait for. The
// two are hundreds of milliseconds apart (the worker still has to fetch flock.js,
// compile it, init and reach its first frame), and in that gap the composed mark
// had been taken away and nothing had replaced it: measured on a throttled load,
// a formed mark at 700 ms, an EMPTY SKY at 1400, birds at 2200. So the flock
// says when it has drawn (flock.js: Runner.ondraw) and the still leaves then,
// fading rather than cutting, so the mark dissolves into the flock that is
// scattering in behind it. A flock that never draws never fires this, which is
// exactly right: the fallback outlives anything broken above it.
function live() {
  if (root.classList.contains('flock-on')) return;
  root.classList.add('flock-on');
  const still = $('.still');
  if (!still) return;
  // Hidden once faded, never removed: the same node is the letterhead the print
  // stylesheet uses, and a page nobody can print is not an improvement.
  const done = () => still.classList.add('done');
  still.addEventListener('transitionend', done, { once: true });
  setTimeout(done, 1200);                     // …and if the fade never runs at all
}
if (!startWorker()) startMainThread().catch(e => console.warn('flock: could not load the simulation —', e.message));

// Keep the canvas the size of the viewport.
let resizeRaf = 0;
addEventListener('resize', () => {
  cancelAnimationFrame(resizeRaf);
  resizeRaf = requestAnimationFrame(() => {
    perchOff();   // the seat is in canvas coordinates; the canvas just moved
    const { w, h } = measureWorld();
    post({ type: 'resize', dpr: dpr(), w, h });
    post({ type: 'home-size', size: homeSize() });
    post({ type: 'scroll', y: scrollOffset() });
    sendObstacles();
  });
}, { passive: true });
// Come back to a flock that carried on without you. The loop stops while the tab
// is hidden — it must, it is someone else's battery — so what returns is the
// frame you left, frozen mid-air. Instead the time away is measured and handed
// over, and the simulation lives through it in one go before the first frame is
// drawn. It reads as "it was still going", which is the point; nobody would call
// it a feature.
let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = performance.now(); post({ type: 'visible', value: false }); return; }
  const away = hiddenAt ? (performance.now() - hiddenAt) / 1000 : 0;
  hiddenAt = 0;
  if (away > 1) post({ type: 'catchup', seconds: away });
  post({ type: 'visible', value: true });
});
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
// Crossing the breakpoint swaps which of the two the canvas is doing —
// and which point grid the mark wears (sendHome, §3).
heroBound.addEventListener('change', () => { post({ type: 'scroll', y: scrollOffset() }); sendHome(); });

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
    perchLater();
  });
}, { passive: true });
addEventListener('pointerleave', () => { perchOff(); post({ type: 'pointer', on: false, x: -1e4, y: -1e4 }); });
document.addEventListener('mouseleave', () => { perchOff(); post({ type: 'pointer', on: false, x: -1e4, y: -1e4 }); });

/* Stop moving for long enough and you stop being a predator: one bird comes and
 * settles beside the cursor until you move (flock.js, PERCH). The gesture is for
 * someone doing nothing, so nothing here polls — it is one timer that every
 * movement throws away. Not on touch, not under reduced motion, not mid-sheet.
 * `?perch=` is the wait in seconds, for the impatient. */
const PERCH_AFTER = (params.has('perch') ? +params.get('perch') : 45) * 1000;
let perchTimer = 0, perched = false;
function perchOff() {
  clearTimeout(perchTimer); perchTimer = 0;
  if (perched) { perched = false; post({ type: 'perch', at: null }); }
}
function perchNow() {
  const r = canvas.getBoundingClientRect();
  perched = true;
  post({ type: 'perch', at: { x: px - r.left, y: py - r.top } });
}
function perchLater() {
  perchOff();
  if (STILL || !finePointer.matches || season === 'snow') return;
  perchTimer = setTimeout(() => { if (!sheet.open && !overMaking) perchNow(); }, PERCH_AFTER);
}

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
function homeSize() { const { w, h } = world; return markSize(w, h, vw() < 700); }
// Even at 66% the phone mark is a ~10 px point pitch against a 10.4 px
// wingspan, and adjacent birds weld into one blob — at any share or wingspan
// (both were tried; the ratio is what fails). So a phone keeps the size and
// halves the GRID instead: a checkerboard of the sampled points recovers the
// 7 px lattice from mark.js's percentages, pitch grows 1.4×, and 120 birds
// now fill every point that remains instead of two-thirds of 208.
const MARK_THIN = (() => {
  const out = [];
  for (let i = 0; i < MARK.length; i += 2) {
    const c = Math.round((MARK[i] - 1.6) / 3.211), r = Math.round((MARK[i + 1] - 2.5) / 5);
    if (((c + r) & 1) === 0) out.push(MARK[i], MARK[i + 1]);
  }
  return new Uint8Array(out);
})();
function sendHome() { post({ type: 'home', points: heroBound.matches ? MARK_THIN : MARK, aspect: MARK_ASPECT, size: homeSize() }); }
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
    // An opened sheet is its own view: which of the six people actually look
    // at is the only thing worth knowing about this page (see count.js).
    count(`/#${slug}`);
  };
  if (push) history.pushState({ slug }, '', `#${slug}`);
  go();
  // The flock dims and slows while you read.
  perchOff();
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
// j/k walk the rows of both lists. Focus is the whole mechanism: it already
// draws the ring, takes the nudge, scrolls itself into view and opens on Enter.
// Inside a sheet the pair does what the arrows do — the same gesture, one level in.
const walkable = $$('.row');
function walk(d) {
  const i = walkable.indexOf(document.activeElement);
  const next = i < 0 ? (d > 0 ? 0 : walkable.length - 1)
                     : Math.min(walkable.length - 1, Math.max(0, i + d));
  walkable[next]?.focus();
}
addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select') || e.metaKey || e.ctrlKey || e.altKey) return;
  const d = e.key === 'j' ? 1 : e.key === 'k' ? -1 : 0;
  if (sheet.open && (e.key === 'ArrowRight' || d > 0)) step(1);
  else if (sheet.open && (e.key === 'ArrowLeft' || d < 0)) step(-1);
  else if (d) walk(d);
  else if (!sheet.open && (e.key === 't' || e.key === 'T')) cycleTheme();
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

// The service worker: repeat visits paint from disk, and the whole site —
// flock included — works with no network at all (see sw.js). Registered
// after load so it never competes with the first paint. A page that is
// actually offline says so where the curious will look.
// A sheet opened by a deep link on a FIRST visit is the one thing the worker
// never sees. It registers on `load` and only starts controlling the page after
// that, so the <img> has already been fetched around it and is not in its cache
// — offline, that screenshot lasts exactly as long as the browser's own HTTP
// copy, which on GitHub Pages is ten minutes, not forever. So once the worker is
// actually in control, whatever is already on screen is asked for one more time.
// `force-cache` means the browser answers from disk for nothing, and the worker,
// now in the middle, keeps it. Later sheets need none of this: by then the page
// is controlled and their images pass through it on the way in.
async function handOver() {
  await navigator.serviceWorker.ready;
  if (!navigator.serviceWorker.controller)
    await new Promise(r => navigator.serviceWorker.addEventListener('controllerchange', r, { once: true }));
  const img = $('#sheet img');
  if (img?.currentSrc) fetch(img.currentSrc, { cache: 'force-cache' }).catch(() => {});
}
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').then(handOver).catch(() => {}));
  if (navigator.serviceWorker.controller && !navigator.onLine)
    console.log('%cflock%c offline — everything you see was already here.', 'font-weight:600', '');
}

count();

// Console: one line, and a handle to poke at.
console.log(
  `%cflock%c ${TARGET} · rules: separation, alignment, cohesion, you · ${inWorker ? 'worker + OffscreenCanvas' : 'main thread'}${STILL ? ' · still' : ''} (renderer: flock.where)\n%cwindow.flock — { count, fps, params, home, season(), perch(), hue, seed } · ?n= ?seed= ?still ?hue= ?hour= ?moon= ?perch= ?season=snow · press t, or j/k`,
  'font-weight:600', '', 'color:gray');
window.flock = {
  get count() { return stats.n; },
  set count(v) { post({ type: 'count', value: +v }); },
  get fps() { return Math.round(stats.fps); },
  // The params the flock is actually running, not a copy of the defaults it
  // started from — they arrive on the same channel as the frame rate.
  get params() { return stats.p && { ...stats.p }; },
  set params(p) { post({ type: 'params', params: p }); },
  get home() { return homeSize(); },
  set home(on) { on ? sendHome() : post({ type: 'home-off' }); },
  season: s => post({ type: 'season', season: s }),
  perch: () => { perchOff(); perchNow(); },   // without the 45 s of sitting still
  tempo: v => post({ type: 'tempo', value: v }),
  get seed() { return seed; },
  get hue() { return hue; },
  set hue(v) { hue = +v; applyHue(); },
  get light() { return { ...light, az: light.az * 180 / Math.PI }; },
  snapshot() { return new Promise(r => { snapshotResolve = r; post({ type: 'snapshot' }); }); },
  get where() { return `${inWorker ? 'worker' : 'main'} · ${stats.renderer || 'starting'}`; },
  get _runner() { return mainRunner; }, // main-thread only; handy in DevTools
};
