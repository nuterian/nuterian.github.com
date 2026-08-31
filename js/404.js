/*
 * 404.js — the flock spells out what happened.
 * Small enough to run on the main thread; nothing here scrolls.
 */
import { Runner, textPoints } from './flock.js';
import { hueAt } from './hue.js';
import { setTheme, nextTheme, lightStyle } from './theme.js';
import { count } from './count.js';

const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const hue = hueAt();
root.style.setProperty('--hue', hue.toFixed(1));
// The same clock, the same light as the home page — one copy, in theme.js.
const style = () => ({ type: 'style', style: lightStyle(new Date(), hue).style });

const canvas = document.getElementById('flock');
const runner = new Runner(canvas);
const dpr = Math.min(1.5, devicePixelRatio || 1);
const coarse = matchMedia('(pointer: coarse)').matches;
const post = m => runner.handle(m);
// The world is the canvas's own box (style.css sizes it), not the viewport:
// a full-viewport canvas is a layer the compositor cannot afford per frame.
const world = () => { const r = canvas.getBoundingClientRect(); return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) }; };
// The flock spells whatever you actually typed. It used to assemble "404" — a
// number nobody types — while the address bar held the word the person really
// asked for. textPoints() samples any string, so it may as well sample theirs:
// mistype /forge as /froge and 150 birds come together into your own typo. It
// costs nothing to everyone who never lands here, which is the whole shape of
// this site's rewards. The <h1> still says "Not found" in words, so nothing is
// ever conveyed only by birds.
//
// What it will spell is deliberately narrow. Lowercase a–z, 0–9 and hyphens off
// the LAST path segment, its extension dropped, hyphens read as spaces, and at
// most 14 characters — anything else falls back to 404. Not for safety (this is
// rasterised to an offscreen canvas as a point cloud and never touches the DOM)
// but because the flock can only suggest a shape: a long string samples too
// small to read, and a word nobody chose is not a joke worth telling.
const asked = (() => {
  const seg = decodeURIComponent(location.pathname).split('/').filter(Boolean).pop() || '';
  const word = seg.replace(/\.[a-z0-9]+$/i, '').toLowerCase().replace(/-+/g, ' ').trim();
  return /^[a-z0-9 ]{1,14}$/.test(word) ? word : '404';
})();
// The type shrinks to fit the 600 px sampling canvas, so a long word is sampled
// at a smaller size rather than off the edge of it.
//
// Then the PITCH is chosen to suit the flock, which is the part that was wrong
// here long before the word was: a fixed 6 px pitch sampled "404" into ~340
// points for 150 birds to fill, so two of every five points stood empty and the
// glyphs never closed up. A word makes it worse — more letters, more ink, more
// points, same birds. So the grid is coarsened until the cloud is something this
// many birds can actually hold: the mark on the home page reads at ~1.5 points
// per bird, and that ratio is the target here too. Same rule the phone uses when
// it halves the mark's grid rather than shrinking the mark.
// More letters, more birds. A word is only legible if each glyph gets enough of
// them: "jm" on the home page is 2 glyphs to 140 birds, and "404" here was 3 to
// 150 — about fifty each. Held at 150, a seven-letter word got twenty-one per
// letter and read as a smear. Birds are the cheap axis (DESIGN.md: count is free,
// canvas AREA is what costs, and 600 of them hold 60fps on the same layer), so
// the flock is sized to the word instead of the word to the flock.
const glyphs = asked.replace(/ /g, '').length;
const birds = Math.min(420, Math.max(coarse ? 120 : 150, glyphs * 48));
post({ type: 'init', dpr, ...world(), count: birds, still: reduce });
post(style());
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => post(style()));

const canvas404 = document.createElement('canvas').getContext('2d');
const size = Math.min(150, Math.round(1000 / Math.max(3, asked.length)));
const target = birds * 1.5;
let points, aspect;
for (let pitch = 5; pitch <= 24; pitch++) {
  ({ points, aspect } = textPoints(canvas404, asked, `600 ${size}px system-ui, sans-serif`, pitch));
  if (points.length / 2 <= target) break;
}
function homeSize() {
  const { w, h } = world();
  const bw = Math.min(w * 0.62, h * 0.62 * aspect);
  return { w: bw, h: bw / aspect };
}
post({ type: 'home', points, aspect, size: homeSize() });
addEventListener('resize', () => post({ type: 'home-size', size: homeSize() }), { passive: true });

addEventListener('resize', () => post({ type: 'resize', dpr, ...world() }), { passive: true });
addEventListener('pointermove', e => {
  if (e.pointerType === 'touch') return;
  const r = canvas.getBoundingClientRect();
  post({ type: 'pointer', x: e.clientX - r.left, y: e.clientY - r.top, on: true });
}, { passive: true });
document.addEventListener('mouseleave', () => post({ type: 'pointer', on: false, x: -1e4, y: -1e4 }));
addEventListener('pointerup', e => {
  if (e.pointerType !== 'touch') return;
  const r = canvas.getBoundingClientRect(); // canvas-local, like every other input
  post({ type: 'attract', x: e.clientX - r.left, y: e.clientY - r.top, r: 110, k: 1.6, life: 1.3 });
}, { passive: true });
addEventListener('keydown', e => {
  if ((e.key !== 't' && e.key !== 'T') || e.metaKey || e.ctrlKey || e.altKey) return;
  setTheme(nextTheme());
  post(style());
});
document.addEventListener('visibilitychange', () => post({ type: 'visible', value: !document.hidden }));
// Even a wrong address installs the right site (see sw.js).
if ('serviceWorker' in navigator) addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
count();
console.log('%cflock%c looked for this page too. It isn\'t here.', 'font-weight:600', '');
