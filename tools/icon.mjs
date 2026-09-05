// The home-screen icon: the 2013 brush mark, in the light palette, 180 px.
//
// The favicon is an SVG that flips with the theme; iOS wants an opaque PNG for
// Add to Home Screen and, given none, took a screenshot of the page instead. So
// this is the same mark on the same paper, in the site's own two colours — read
// off js/hue.js rather than typed here, so a palette change reaches it by
// re-running this. 180 px is the 60 pt icon at 3x; iOS scales it for the rest.
// logo.png is white on alpha (that is how the 2013 site drew it over a skyline),
// so its alpha is the mark and the colour is ours to choose.
import sharp from 'sharp';
import { oklch } from '../js/hue.js';
import { fileURLToPath } from 'node:url';

const P = u => fileURLToPath(u);
const bg = oklch(0.982, 0.004, 95), fg = oklch(0.19, 0.01, 95);   // --bg and --fg, light
const SIZE = 180, W = 124;                                       // the mark's width on the icon

const logo = sharp(P(new URL('../2013/img/logo.png', import.meta.url))).ensureAlpha().resize(W);
const { data: alpha, info } = await logo.clone().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
const mark = await sharp({ create: { width: info.width, height: info.height, channels: 3, background: fg } })
  .joinChannel(alpha, { raw: { width: info.width, height: info.height, channels: 1 } }).png().toBuffer();
const out = await sharp({ create: { width: SIZE, height: SIZE, channels: 3, background: bg } })
  .composite([{ input: mark, left: Math.round((SIZE - info.width) / 2), top: Math.round((SIZE - info.height) / 2) }])
  .png({ compressionLevel: 9, palette: true }).toBuffer();
await sharp(out).toFile(P(new URL('../img/touch-icon.png', import.meta.url)));
console.log(`touch-icon.png ${SIZE}×${SIZE}, ${out.length} bytes, mark ${info.width}×${info.height}, ${fg} on ${bg}`);
