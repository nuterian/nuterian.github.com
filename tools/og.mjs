// Renders the Open Graph image from the site itself: a seeded still of the flock.
import { chromium } from 'playwright';
import sharp from 'sharp';
const base = process.argv[2] || 'http://localhost:4174';
const browser = await chromium.launch();
// reducedMotion so the shot is REPRODUCIBLE: `?still` freezes the flock, but the
// archive arrow's bob is a CSS animation and would land wherever it happened to
// be. The site's own reduced-motion rule stops it; nothing else here moves.
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, colorScheme: 'light', deviceScaleFactor: 1, reducedMotion: 'reduce' })).newPage();
await page.goto(`${base}/?still&seed=2013&hue=88`); await page.waitForTimeout(800);
const png = await page.screenshot();
await browser.close();
const out = new URL('../img/og.png', import.meta.url).pathname;
const info = await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(out);
console.log(`og.png ${info.width}×${info.height} ${info.size} bytes`);
