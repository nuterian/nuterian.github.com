/*
 * theme.js — the theme and the light, shared by the pages.
 *
 * main.js and 404.js used to carry private copies of this plumbing, and the
 * copies drifted — a missing modifier guard on one page, unconverted tap
 * coordinates on the other. One copy now: which theme is in force, how a
 * chosen mode is applied and remembered, and how the hour's light lands on
 * the page and the flock at once.
 */
import { lightAt, flockColor } from './hue.js';

const root = document.documentElement;

// Which theme is in force — an explicit choice, else the system's.
export const isDark = () =>
  root.dataset.theme ? root.dataset.theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;

// Apply a mode and remember it. Remembering is best-effort: storage can be
// blocked outright (the inline restore in index.html guards its read for the
// same reason), and the switch itself must not die on the memo.
export function setTheme(mode) { // 'system' | 'dark' | 'light'
  if (mode === 'system') delete root.dataset.theme; else root.dataset.theme = mode;
  syncThemeColor(mode);
  try { mode === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', mode); } catch {}
}

// The browser's own chrome — Safari's tab bar, a phone's status bar — takes its
// colour from `theme-color`, and the two tags in the head are keyed to the SYSTEM
// scheme only: after a manual switch the page went dark and the bar around it
// stayed light. The colours stay in the head, each written once; this only says
// which applies — the chosen theme's, on both tags, or each tag's own once the
// system is back in charge. Run once at load too, because the pre-paint script
// may already have restored a choice.
const metas = [...document.querySelectorAll('meta[name="theme-color"]')];
const own = new Map(metas.map(m => [m, m.content]));
function syncThemeColor(mode) {
  const pick = mode === 'system' ? null : metas.find(m => (m.getAttribute('media') || '').includes(mode));
  for (const m of metas) m.content = own.get(pick || m);
}
syncThemeColor(root.dataset.theme || 'system');

// The visible viewport. The inline head script sets --vh before first paint; this
// keeps it true as the browser's chrome comes and goes (see .hero in style.css for
// why neither svh nor dvh can do the job). Pinch-zoom is ignored on purpose:
// zoomed in, visualViewport.height is the slice being magnified, and honouring it
// would collapse the hero the moment someone zoomed a screenshot. It lives here
// because both pages have the same bottom-anchored hero, and the 404 had been
// left on the svh guess the home page was cured of.
export function keepViewportHeight() {
  const vv = window.visualViewport;
  if (!vv) return;
  let raf = 0;
  const apply = () => { raf = 0; if (vv.scale <= 1.01) root.style.setProperty('--vh', vv.height + 'px'); };
  vv.addEventListener('resize', () => { if (!raf) raf = requestAnimationFrame(apply); }, { passive: true });
  apply();
}

export const nextTheme = () => {
  const cur = root.dataset.theme || 'system';
  return cur === 'system' ? 'dark' : cur === 'dark' ? 'light' : 'system';
};

// The hour's light, landed in both places at once: the page reads it as
// custom properties (the wash in style.css), the flock takes the returned
// style message. Same numbers, one source.
export function lightStyle(date, hue, moon) {
  const l = lightAt(date, isDark(), hue, moon);
  root.style.setProperty('--light-x', (50 + Math.cos(l.az) * 62).toFixed(1) + '%');
  root.style.setProperty('--light-y', (50 + Math.sin(l.az) * 44).toFixed(1) + '%');
  root.style.setProperty('--glow', l.glow.toFixed(3));
  return { light: l, style: { color: flockColor(isDark(), hue), lit: l.tint, glint: l.glint, light: [Math.cos(l.az), Math.sin(l.az)] } };
}
