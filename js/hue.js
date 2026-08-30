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

// lightAt — the clock's second output: where the light comes from (DESIGN.md,
// "Light"). Azimuth is a SCREEN direction (x right, y down), so -90° is
// straight up; elevation is 0 on the horizon and 1 overhead; power is how
// bright the source is at all — a sun, a moon, or the dim minutes between.
const LIGHT_KEYS = [ // [hour, azimuth°, elevation, power]
  [0,     -90, 0.55, 0.45],
  [4.5,   -48, 0.16, 0.45],
  [5.4,   -46, 0.00, 0.18],   // the moon sets
  [5.6,  -134, 0.00, 0.50],   // the sun rises where it rose
  [7,    -124, 0.30, 1.00],
  [9,    -110, 0.62, 1.00],
  [12,    -90, 0.95, 1.00],
  [15.5,  -70, 0.62, 1.00],
  [18,    -52, 0.28, 1.00],
  [19.4,  -45, 0.00, 0.50],   // the sun sets
  [19.6, -135, 0.00, 0.18],   // and the moon has the sky again
  [21,   -122, 0.22, 0.45],
  [24,    -90, 0.55, 0.45],
];

const MOON = 260;   // the dark theme's own background hue — see --bg

export function lightAt(date = new Date(), dark = false, hue = hueAt(date)) {
  const h = date.getHours() + date.getMinutes() / 60;
  let i = 0;
  while (i < LIGHT_KEYS.length - 2 && h > LIGHT_KEYS[i + 1][0]) i++;
  const [h0, a0, e0, p0] = LIGHT_KEYS[i], [h1, a1, e1, p1] = LIGHT_KEYS[i + 1];
  const t = Math.min(1, Math.max(0, (h - h0) / (h1 - h0))), s = t * t * (3 - 2 * t);
  const elev = e0 + (e1 - e0) * s, power = p0 + (p1 - p0) * s;
  return {
    az: (a0 + (a1 - a0) * s) * Math.PI / 180,
    elev,
    glint: power * (0.15 + 0.85 * (1 - elev) ** 1.5),  // raking glints, noon flattens
    // The wash is ambient, not raking. BOTH terms COMPRESS rather than
    // multiply — a dim source, or a low one, still lights a page you have
    // adapted to. Elevation used to multiply raw, and its floor fell on the
    // same hours power dips, so the two troughs stacked and dusk went unlit
    // (DESIGN.md, "Light"). Each is 1 at noon, so daylight is untouched.
    glow: (0.55 + 0.45 * power) * (0.72 + 0.28 * elev),
    // Lit colour. The THEME says which light you are under: a light page is
    // daylit, and takes the hour's own hue — rose at dawn, gold at noon. A dark
    // page is a night page, and its light is the moon, which is one colour at
    // every hour: the dark background's own 260, cool and nearly drained of
    // chroma. The clock still says where that light is and how hard it rakes.
    tint: dark ? oklch(0.80 + 0.11 * power, 0.03 + 0.02 * power, MOON)
               : oklch(0.42 + 0.22 * power, 0.04 + 0.09 * power, hue),
  };
}
