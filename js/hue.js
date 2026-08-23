/*
 * hue.js — one hue, drifting through the day.
 *
 * The accent is a single OKLCH hue. Noon is the 2013 site's yellow (88);
 * dusk warms to amber, night cools to blue, dawn passes through rose.
 * Lightness and chroma are fixed per theme in CSS, so contrast never changes
 * — AA is a property of the design, not of the hour you happened to visit.
 */

const HUE_KEYS = [ // [hour, hue]
  [0, 255], [4, 255], [6.5, 25], [9, 75], [12, 88], [15.5, 80], [18, 55], [20, 30], [22, 255], [24, 255],
];

export function hueAt(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  for (let i = 0; i < HUE_KEYS.length - 1; i++) {
    const [h0, a] = HUE_KEYS[i], [h1, b] = HUE_KEYS[i + 1];
    if (h >= h0 && h <= h1) {
      const t = (h - h0) / (h1 - h0), e = t * t * (3 - 2 * t);
      const d = ((b - a + 540) % 360) - 180; // shortest way round the wheel
      return ((a + d * e) % 360 + 360) % 360;
    }
  }
  return 88;
}

// OKLCH → sRGB hex, so the canvas gets the same colour CSS computes.
export function oklch(L, C, H) {
  const hr = H * Math.PI / 180, a = C * Math.cos(hr), b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
  const l = l_ ** 3, m = m_ ** 3, s = s_ ** 3;
  const lin = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
  ];
  return '#' + lin.map(c => {
    c = Math.max(0, Math.min(1, c));
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055;
    return Math.round(c * 255).toString(16).padStart(2, '0');
  }).join('');
}

// The flock's colour for the current theme and hue (mirrors --flock in CSS).
export function flockColor(dark, hue) { return oklch(dark ? 0.76 : 0.42, 0.10, hue); }
