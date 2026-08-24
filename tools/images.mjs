// Generates the archive imagery and the jm-mark point cloud from the 2013 assets.
//   ../img/archive/<slug>-<n>.{avif,webp}  full-length screenshots, 960w (source resolution)
//   ../img/mark.svg                        favicon: the 2013 brush mark, theme-aware
//   ./mark-points.json                     208 points sampled from the mark, pasted into js/mark.js
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const P = (u) => fileURLToPath(u);

const OLD = new URL('../2013/img/', import.meta.url);
const OUT = new URL('../img/archive/', import.meta.url);
await mkdir(OUT, { recursive: true });

const projects = {
  golem: ['golem.png'],
  kidscerts: ['kc.png'],
  'meditation-music': ['mm1.png', 'mm2.png'],
  'aprende-tv': ['cap.png'],
  unlistr: ['un1.png', 'un2.png'],
  'classroom-tv': ['ctv1.png', 'ctv2.png'],
};

let total = 0;
for (const [slug, files] of Object.entries(projects)) {
  for (const [i, f] of files.entries()) {
    const src = sharp(P(new URL(f, OLD)));
    const a = await src.clone().avif({ quality: 55, effort: 6 }).toFile(P(new URL(`${slug}-${i + 1}.avif`, OUT)));
    const w = await src.clone().webp({ quality: 78 }).toFile(P(new URL(`${slug}-${i + 1}.webp`, OUT)));
    total += a.size;
    console.log(`${slug}-${i + 1}: avif ${a.size}  webp ${w.size}`);
  }
}
console.log('total avif bytes', total);

// --- The mark -------------------------------------------------------------
// Sample the brush mark's alpha into a point cloud the flock can assemble into.
const logo = sharp(P(new URL('logo.png', OLD))).ensureAlpha();
const { data, info } = await logo.raw().toBuffer({ resolveWithObject: true });
const pts = [];
const step = 7; // grid pitch in source pixels; 208 points for 218x140
for (let y = step / 2; y < info.height; y += step) {
  for (let x = step / 2; x < info.width; x += step) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const a = data[(yi * info.width + xi) * 4 + 3];
    if (a > 110) pts.push([+(x / info.width).toFixed(3), +(y / info.height).toFixed(3)]);
  }
}
await writeFile(new URL('./mark-points.json', import.meta.url), JSON.stringify({ aspect: info.width / info.height, points: pts }));
console.log('mark points', pts.length);

// Favicon: the mark as an SVG that embeds the PNG and flips colour with the theme.
const png64 = (await sharp(P(new URL('logo.png', OLD))).resize(128).png().toBuffer()).toString('base64');
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><style>image{filter:invert(1)}@media(prefers-color-scheme:dark){image{filter:none}}</style><image href="data:image/png;base64,${png64}" x="0" y="23" width="128"/></svg>`;
await mkdir(new URL('../img/', import.meta.url), { recursive: true });
await writeFile(new URL('../img/mark.svg', import.meta.url), svg);
console.log('mark.svg', svg.length);
