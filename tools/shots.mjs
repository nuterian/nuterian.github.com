// Visual review: a contact sheet of the site's states → out/contact-sheet.png
// node shots.mjs [baseURL]
import { chromium, devices } from 'playwright';
import sharp from 'sharp';
import { mkdirSync } from 'node:fs';
const BASE = process.argv[2] || 'http://localhost:4174';
const OUT = new URL('./out/', import.meta.url).pathname; mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch();
const shots = [];
async function desktop(scheme) {
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: scheme })).newPage();
  await page.goto(`${BASE}/?seed=7`); await page.waitForTimeout(1500); shots.push([`${scheme} · 1.5 s: the mark`, await page.screenshot()]);
  await page.waitForTimeout(2000); await page.mouse.move(760, 420); await page.waitForTimeout(2500); shots.push([`${scheme} · 6 s: drifting, pointer in the middle`, await page.screenshot()]);
  await page.mouse.wheel(0, 900); await page.waitForTimeout(1500);
  const row = await page.locator('.row[data-slug="kidscerts"]').boundingBox();
  await page.mouse.move(row.x + 200, row.y + row.height / 2, { steps: 12 }); await page.waitForTimeout(1400); shots.push([`${scheme} · archive, hovering KidsCerts`, await page.screenshot()]);
  await page.mouse.click(row.x + 200, row.y + row.height / 2); await page.waitForTimeout(3500); shots.push([`${scheme} · sheet open, birds on the wire`, await page.screenshot()]);
  await page.keyboard.press('Escape'); await page.mouse.wheel(0, 2000); await page.waitForTimeout(2500); shots.push([`${scheme} · footer`, await page.screenshot()]);
  await page.context().close();
}
await desktop('light'); await desktop('dark');
{
  const page = await (await browser.newContext({ ...devices['iPhone 13'], colorScheme: 'light' })).newPage();
  await page.goto(`${BASE}/?seed=7`); await page.waitForTimeout(1400); shots.push(['phone · 1.4 s', await page.screenshot()]);
  await page.touchscreen.tap(200, 300); await page.waitForTimeout(700); shots.push(['phone · tap gathers', await page.screenshot()]);
  await page.evaluate(() => scrollTo(0, 900)); await page.waitForTimeout(1000); shots.push(['phone · archive', await page.screenshot()]);
  await page.locator('.row[data-slug="golem"]').tap(); await page.waitForTimeout(1200); shots.push(['phone · sheet', await page.screenshot()]);
  await page.context().close();
  const p2 = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
  await p2.goto(`${BASE}/404.html`); await p2.waitForTimeout(2400); shots.push(['404 · dark', await p2.screenshot()]);
  const p3 = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false })).newPage();
  await p3.goto(`${BASE}/`); await p3.waitForTimeout(300); shots.push(['no script · inline still', await p3.screenshot()]);
  await browser.close();
}
// Compose: desktop shots at 480 wide, phones at 160 wide, labels underneath.
const tiles = [];
for (const [label, png] of shots) {
  const meta = await sharp(png).metadata();
  const w = meta.width > 1000 ? 480 : 180, h = Math.round(meta.height * w / meta.width);
  const img = await sharp(png).resize(w).toBuffer();
  const svg = Buffer.from(`<svg width="${w}" height="22"><text x="0" y="15" font-family="Helvetica" font-size="12" fill="#333">${label}</text></svg>`);
  tiles.push({ w, h: h + 26, buf: await sharp({ create: { width: w, height: h + 26, channels: 3, background: '#e8e8e8' } }).composite([{ input: img, top: 0, left: 0 }, { input: svg, top: h + 2, left: 0 }]).png().toBuffer() });
}
const cols = 3, gap = 16; let x = 0, y = 0, rowH = 0, maxW = 0; const comps = [];
tiles.forEach((t, i) => { if (i && i % cols === 0) { y += rowH + gap; x = 0; rowH = 0; } comps.push({ input: t.buf, left: x, top: y }); x += t.w + gap; rowH = Math.max(rowH, t.h); maxW = Math.max(maxW, x); });
await sharp({ create: { width: maxW, height: y + rowH, channels: 3, background: '#e8e8e8' } }).composite(comps).png().toFile(`${OUT}/contact-sheet.png`);
console.log(`${OUT}contact-sheet.png (${shots.length} states)`);
