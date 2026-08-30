// Subsets the Geist variable fonts to the glyphs — and the weights — this site
// can actually render. The CSS asks for 400, 450 and 500 and nothing else, so
// the wght axis ships clipped to 400–500 instead of the full 100–900; the ends
// nobody wears were a third of the font payload. Keep WGHT in sync with the
// `font-weight` range in both @font-face blocks in css/style.css.
// Input:  tools/src-fonts/*.woff2 (latin subsets as served by Google Fonts)
// Output: ../fonts/*.woff2
import subsetFont from 'subset-font';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const EXTRA = '–—‘’“”…·•→←↑↓×©°';            // typographic punctuation the copy uses
const TEXT = ASCII + EXTRA;
const WGHT = { min: 400, max: 500 };            // the only weights css/style.css asks for

await mkdir(new URL('../fonts/', import.meta.url), { recursive: true });
for (const [src, out] of [
  ['Geist-latin.woff2', 'geist.woff2'],
  ['GeistMono-latin.woff2', 'geist-mono.woff2'],
]) {
  const buf = await readFile(new URL(`./src-fonts/${src}`, import.meta.url));
  const sub = await subsetFont(buf, TEXT, { targetFormat: 'woff2', variationAxes: { wght: WGHT } });
  await writeFile(new URL(`../fonts/${out}`, import.meta.url), sub);
  console.log(`${out}: ${buf.length} → ${sub.length} bytes`);
}
