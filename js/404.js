/*
 * 404.js — the flock spells out what happened, then gives up on it.
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
const dpr = Math.min(2, devicePixelRatio || 1);
const coarse = matchMedia('(pointer: coarse)').matches;
const post = m => runner.handle(m);
post({ type: 'init', dpr, w: innerWidth, h: innerHeight, count: coarse ? 90 : 220, still: reduce });
post({ type: 'style', style: { color: flockColor(dark(), hue) } });
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => post({ type: 'style', style: { color: flockColor(dark(), hue) } }));

// Sample "404" into points and have the flock take that shape for a while.
const { points, aspect } = textPoints(document.createElement('canvas').getContext('2d'), '404', '600 150px system-ui, sans-serif', 6);
function box() {
  const w = innerWidth, h = innerHeight;
  const bw = Math.min(w * 0.5, 480), bh = bw / aspect;
  return { x: w / 2 - bw / 2, y: h * 0.36 - bh / 2, w: bw, h: bh };
}
if (!reduce) setTimeout(() => post({ type: 'form', points, aspect, box: box(), hold: 2.4 }), 500);

addEventListener('resize', () => post({ type: 'resize', dpr, w: innerWidth, h: innerHeight }), { passive: true });
addEventListener('pointermove', e => { if (e.pointerType !== 'touch') post({ type: 'pointer', x: e.clientX, y: e.clientY, on: true }); }, { passive: true });
document.addEventListener('mouseleave', () => post({ type: 'pointer', on: false, x: -1e4, y: -1e4 }));
addEventListener('pointerup', e => { if (e.pointerType === 'touch') post({ type: 'attract', x: e.clientX, y: e.clientY, r: 110, k: 1.6, life: 1.3 }); }, { passive: true });
addEventListener('keydown', e => { if (e.key === 't') { const cur = root.dataset.theme || 'system'; const next = cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system'; if (next === 'system') { delete root.dataset.theme; localStorage.removeItem('theme'); } else { root.dataset.theme = next; localStorage.setItem('theme', next); } post({ type: 'style', style: { color: flockColor(dark(), hue) } }); } });
document.addEventListener('visibilitychange', () => post({ type: 'visible', value: !document.hidden }));
console.log('%cflock%c looked for this page too. It isn\'t here.', 'font-weight:600', '');
