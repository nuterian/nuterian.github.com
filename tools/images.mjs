// Generates the archive imagery and the jm-mark point cloud from the 2013 assets.
//   ../img/archive/<slug>-<n>.{avif,webp}  full-length screenshots, 960w (source resolution)
//   ../img/mark.svg                        favicon: the 2013 brush mark, theme-aware
//   ./mark-points.json                     208 points sampled from the mark, pasted into js/mark.js
//
// Six of the seven sheets come from PNGs that have sat in this repo since 2013.
// The seventh IS the 2013 site, which is not a PNG but a page that still runs at
// /2013/ — so it is shot from the running site, at the same 960 px the rest were
// drawn at. That step needs the local server (`node serve.mjs 4174`); without
// one it is skipped and the committed files stand.
import sharp from 'sharp';
import { chromium } from 'playwright';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const P = (u) => fileURLToPath(u);
const BASE = process.argv[2] || 'http://localhost:4174';

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

// --- The seventh sheet: the site itself, 2013 ------------------------------
// Shot rather than dug up. Note there is no PNG beside these two: the other six
// keep their 2013-era originals because those ARE the artefact, and this one
// has no original to keep — so index.html points its <img src> at the webp.
try {
  const browser = await chromium.launch();
  const page = await (await browser.newContext({ viewport: { width: 960, height: 900 }, deviceScaleFactor: 1 })).newPage();
  await page.goto(`${BASE}/2013/`, { waitUntil: 'networkidle', timeout: 8000 });
  await page.evaluate(async () => {   // let anything scroll-triggered fire, then go back up
    for (let y = 0; y < document.body.scrollHeight; y += 400) { scrollTo(0, y); await new Promise(r => setTimeout(r, 60)); }
    scrollTo(0, 0);
  });
  await page.waitForTimeout(1200);
  const shot = sharp(await page.screenshot({ fullPage: true }));
  await browser.close();
  const a = await shot.clone().avif({ quality: 55, effort: 6 }).toFile(P(new URL('jugalm-2013-1.avif', OUT)));
  const w = await shot.clone().webp({ quality: 78 }).toFile(P(new URL('jugalm-2013-1.webp', OUT)));
  console.log(`jugalm-2013-1: avif ${a.size}  webp ${w.size}  (${a.width}×${a.height})`);
} catch (e) {
  console.log(`jugalm-2013-1: skipped — no server at ${BASE} (${e.message.split('\n')[0]})`);
}

// --- Placeholders ----------------------------------------------------------
// A sheet's screenshot is lazy and can be a megabyte of 2013; until it lands,
// the figure is a blank slab of the right shape. Give each one the picture's
// own three bands — top, middle, bottom, each the average of a twelfth of the
// image — as a linear-gradient behind it, and the sheet opens roughly composed:
// Aprende's dark header, Golem's red, Meditation Music's peach. It is written
// INTO index.html rather than printed for pasting, because a colour typed by
// hand is a colour that goes stale the next time a screenshot is retaken.
{
  const INDEX = new URL('../index.html', import.meta.url);
  const band = async (img, m, frac) => {
    const top = Math.max(0, Math.min(m.height - 1, Math.round(frac * m.height - m.height * 0.06)));
    const h = Math.max(1, Math.min(m.height - top, Math.round(m.height * 0.12)));
    const { data } = await img.clone().extract({ left: 0, top, width: m.width, height: h })
      .resize(1, 1, { fit: 'fill' }).raw().toBuffer({ resolveWithObject: true });
    return '#' + [...data.slice(0, 3)].map(c => c.toString(16).padStart(2, '0')).join('');
  };
  let html = await readFile(INDEX, 'utf8');
  const wanted = [...html.matchAll(/<source type="image\/avif" srcset="img\/archive\/([\w-]+)\.avif">/g)].map(m => m[1]);
  const grad = new Map();
  for (const name of wanted) {
    const img = sharp(P(new URL(`${name}.webp`, OUT)));
    const m = await img.metadata();
    const [a, b, c] = [await band(img, m, 0.06), await band(img, m, 0.5), await band(img, m, 0.94)];
    grad.set(name, a === b && b === c ? a : `linear-gradient(${a},${b} 50%,${c})`);
  }
  let n = 0;
  html = html.replace(
    /(<source type="image\/avif" srcset="img\/archive\/([\w-]+)\.avif">[\s\S]{0,400}?<img\b)((?:\s+style="background:[^"]*")?)/g,
    (all, head, name, _old) => { n++; return `${head} style="background:${grad.get(name)}"`; });
  await writeFile(INDEX, html);
  console.log(`placeholders: ${n} of ${wanted.length} written into index.html`);
}

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
