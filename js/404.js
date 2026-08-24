/*
 * 404.js — the flock spells out what happened.
 * Small enough to run on the main thread; nothing here scrolls.
 */
import { Runner, textPoints } from './flock.js';
import { hueAt, flockColor } from './hue.js';

const root = document.documentElement;
const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
const dark = () => root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
const hue = hueAt();
root.style.setProperty('--hue', hue.toFixed(1));

const canvas = document.getElementById('flock');
const runner = new Runner(canvas);
const dpr = Math.min(1.5, devicePixelRatio || 1);
const coarse = matchMedia('(pointer: coarse)').matches;
const post = m => runner.handle(m);
// The world is the canvas's own box (style.css sizes it), not the viewport:
// a full-viewport canvas is a layer the compositor cannot afford per frame.
const world = () => { const r = canvas.getBoundingClientRect(); return { w: Math.max(1, Math.round(r.width)), h: Math.max(1, Math.round(r.height)) }; };
post({ type: 'init', dpr, ...world(), count: coarse ? 90 : 220, still: reduce });
post({ type: 'style', style: { color: flockColor(dark(), hue) } });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => post({ type: 'style', style: { color: flockColor(dark(), hue) } }));

// Sample "404" into points: that's home here. Only the SIZE is decided —
// where it sits is the worker's own placement solver (no obstacles on this
// page, so it just settles near the viewport centre, same as before).
const { points, aspect } = textPoints(document.createElement('canvas').getContext('2d'), '404', '600 150px system-ui, sans-serif', 6);
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
addEventListener('pointerup', e => { if (e.pointerType === 'touch') post({ type: 'attract', x: e.clientX, y: e.clientY, r: 110, k: 1.6, life: 1.3 }); }, { passive: true });
addEventListener('keydown', e => { if (e.key === 't') { const cur = root.dataset.theme || 'system'; const next = cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system'; if (next === 'system') { delete root.dataset.theme; localStorage.removeItem('theme'); } else { root.dataset.theme = next; localStorage.setItem('theme', next); } post({ type: 'style', style: { color: flockColor(dark(), hue) } }); } });
document.addEventListener('visibilitychange', () => post({ type: 'visible', value: !document.hidden }));
console.log('%cflock%c looked for this page too. It isn\'t here.', 'font-weight:600', '');
