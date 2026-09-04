// Subsets the Geist variable fonts to the glyphs, the weights AND the features
// this site can actually render.
//
// Input:  tools/src-fonts/*-variable.woff2 — the `[wght]` variable webfonts from
//         Vercel's own release (github.com/vercel/geist-font, v1.7.2), NOT the
//         latin subsets Google Fonts serves. Those were the input once, and two
//         things were quietly missing from them: Google's `latin` range carries
//         U+2191/2193 (↑↓) but not U+2190/2192/2197 (← → ↗), so every arrow on
//         the page fell back to Menlo while the ↓ beside it was Geist; and the
//         stylistic sets the stylesheet asks for were not in the files at all.
// Output: ../fonts/*.woff2
//
// Three cuts, each measured:
//   glyphs   — ASCII plus the punctuation the copy uses. Nothing else is typeset.
//   weights  — the CSS asks for 400, 450 and 500 and nothing else, so the wght
//              axis ships clipped to 400–500 instead of the native 100–900; the
//              ends nobody wears were a third of the payload. Keep WGHT in sync
//              with the `font-weight` range in both @font-face blocks in
//              css/style.css — a weight outside it now clamps to the nearest end.
//   features — only the layout features the stylesheet names. This is the cut
//              the previous subsetter could not make: it kept every feature in
//              the font, and layout closure then keeps every alternate glyph any
//              of them could reach — nine stylistic sets, fractions, the lot.
//              From Vercel's files that was 62 extra glyphs in the sans and 125
//              in the mono (the mono's GSUB alone went 322 → 10 488 bytes), for
//              features no rule on this site ever sets.
// So harfbuzz is driven directly here rather than through subset-font, which
// exposes glyphs and axes but not the feature list.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import fontverter from 'fontverter';

const ASCII = Array.from({ length: 0x7e - 0x20 + 1 }, (_, i) => String.fromCharCode(0x20 + i)).join('');
const EXTRA = '–—‘’“”…·•→←↑↓↗×©°';           // typographic punctuation the copy uses — ↗ is the Making rows'
const TEXT = ASCII + EXTRA;
const WGHT = { min: 400, max: 500 };            // the only weights css/style.css asks for
// The one feature css/style.css names (tnum) and the ones a Latin font is
// expected to apply on its own (kerning, marks, contextual forms). Anything
// else — the stylistic sets, frac, sups, case… — is left out along with the
// glyphs only it could reach. To adopt a set (ss02 is Geist's single-storey a),
// add it here AND set it in the stylesheet; one without the other is a no-op,
// which is exactly the state the site was in for its first two weeks.
const FEATURES = ['ccmp', 'locl', 'kern', 'mark', 'mkmk', 'calt', 'liga', 'rlig', 'rclt', 'tnum'];

const require = createRequire(import.meta.url);
const { instance: { exports: hb } } = await WebAssembly.instantiate(await readFile(require.resolve('harfbuzzjs/hb-subset.wasm')));
const heap = () => new Uint8Array(hb.memory.buffer);   // re-read after every malloc: the heap can move
const TAG = s => s.split('').reduce((a, c) => (a << 8) + c.charCodeAt(0), 0);

async function subset(woff2) {
  const ttf = await fontverter.convert(woff2, 'truetype');
  const input = hb.hb_subset_input_create_or_fail();
  if (!input) throw new Error('hb_subset_input_create_or_fail');
  const feats = hb.hb_subset_input_set(input, 6);            // HB_SUBSET_SETS_LAYOUT_FEATURE_TAG
  hb.hb_set_clear(feats);
  for (const f of FEATURES) hb.hb_set_add(feats, TAG(f));
  const unicodes = hb.hb_subset_input_unicode_set(input);
  for (const c of TEXT) hb.hb_set_add(unicodes, c.codePointAt(0));
  const ptr = hb.malloc(ttf.byteLength);
  heap().set(new Uint8Array(ttf), ptr);
  const blob = hb.hb_blob_create(ptr, ttf.byteLength, 2, 0, 0);   // HB_MEMORY_MODE_WRITABLE
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  if (!hb.hb_subset_input_set_axis_range(input, face, TAG('wght'), WGHT.min, WGHT.max, NaN)) throw new Error('no wght axis');
  const sub = hb.hb_subset_or_fail(face, input);
  hb.hb_subset_input_destroy(input);
  if (!sub) throw new Error('hb_subset_or_fail');
  const result = hb.hb_face_reference_blob(sub);
  const off = hb.hb_blob_get_data(result, 0), len = hb.hb_blob_get_length(result);
  const out = Buffer.from(heap().subarray(off, off + len));
  hb.hb_blob_destroy(result); hb.hb_face_destroy(sub); hb.hb_face_destroy(face); hb.free(ptr);
  return fontverter.convert(out, 'woff2', 'truetype');
}

await mkdir(new URL('../fonts/', import.meta.url), { recursive: true });
for (const [src, out] of [
  ['Geist-variable.woff2', 'geist.woff2'],
  ['GeistMono-variable.woff2', 'geist-mono.woff2'],
]) {
  const buf = await readFile(new URL(`./src-fonts/${src}`, import.meta.url));
  const sub = await subset(buf);
  await writeFile(new URL(`../fonts/${out}`, import.meta.url), sub);
  console.log(`${out}: ${buf.length} → ${sub.length} bytes`);
}
