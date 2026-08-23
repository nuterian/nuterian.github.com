// Subsets the Geist variable fonts to the glyphs this site can actually render.
// Input:  tools/src-fonts/*.woff2 (latin subsets as served by Google Fonts)
// Output: ../fonts/*.woff2
import subsetFont from 'subset-font';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const EXTRA = '–—‘’“”…·•→←↑↓×©°';            // typographic punctuation the copy uses
const TEXT = ASCII + EXTRA;

await mkdir(new URL('../fonts/', import.meta.url), { recursive: true });
for (const [src, out] of [
  ['Geist-latin.woff2', 'geist.woff2'],
  ['GeistMono-latin.woff2', 'geist-mono.woff2'],
]) {
  const buf = await readFile(new URL(`./src-fonts/${src}`, import.meta.url));
  const sub = await subsetFont(buf, TEXT, { targetFormat: 'woff2' });
  await writeFile(new URL(`../fonts/${out}`, import.meta.url), sub);
  console.log(`${out}: ${buf.length} → ${sub.length} bytes`);
}
