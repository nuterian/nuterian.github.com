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
  try { mode === 'system' ? localStorage.removeItem('theme') : localStorage.setItem('theme', mode); } catch {}
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
