// Renders the Open Graph image from the site itself: a seeded still of the flock.
import { chromium } from 'playwright';
import sharp from 'sharp';
const base = process.argv[2] || 'http://localhost:4174';
const browser = await chromium.launch();
const page = await (await browser.newContext({ viewport: { width: 1200, height: 630 }, colorScheme: 'light', deviceScaleFactor: 1 })).newPage();
await page.goto(`${base}/?still&seed=2013&hue=88`); await page.waitForTimeout(800);
const png = await page.screenshot();
await browser.close();
const out = new URL('../img/og.png', import.meta.url).pathname;
const info = await sharp(png).png({ palette: true, quality: 90, compressionLevel: 9 }).toFile(out);
console.log(`og.png ${info.width}×${info.height} ${info.size} bytes`);
