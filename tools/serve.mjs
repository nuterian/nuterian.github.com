// Static server that behaves like GitHub Pages: gzip for text, correct types
// for woff2/avif/webp/js modules, and — measured against jugalm.com rather than
// assumed — `max-age=600` with an ETag and Last-Modified on EVERY file, HTML
// included, plus 304s for conditional requests.
// node serve.mjs [port]            → serves ../ (the site root)
// node serve.mjs [port] --no-cache → the same, caching nothing at all
//
// It used to send `public, max-age=31536000, immutable` to everything that was
// not HTML, which is not what Pages does and is not survivable locally.
// `immutable` means never revalidate — not on a reload, not on a hard one — so
// an edited css/ or js/ file simply never arrived, on any number of refreshes,
// while index.html updated around it. That mismatch is silent and reads exactly
// like a code bug; it cost an afternoon once, chased first as a layout bug and
// then as a service-worker bug, because the worker's own revalidating fetch was
// answered from the same poisoned HTTP cache (see sw.js). A dev server whose
// files change every few minutes has no business claiming a year of immutability
// that production never claims. `--no-cache` stays for when even ten minutes is
// too long; check.mjs measures Lighthouse against whatever these headers are.
//
// What this does and does not fix, measured: with a service worker installed and
// css/style.css edited on disk, a NORMAL reload still shows the old file — 600 s
// is still fresh, so the browser does not ask. A HARD reload now shows the new
// one. Under `immutable` it did not: nothing showed the new one, ever, which is
// the difference between an ordinary cache and a trap. Editing continuously
// still wants --no-cache; being briefly confused now costs one shift-reload.
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { createGzip } from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const PORT = +(process.argv[2] || 4174);
const NOCACHE = process.argv.includes('--no-cache');
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.avif': 'image/avif', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.json': 'application/json', '.ico': 'image/x-icon' };
const TEXT = new Set(['.html', '.css', '.js', '.mjs', '.svg', '.txt', '.json']);

createServer((req, res) => {
  let path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (path.endsWith('/')) path += 'index.html';
  let file = normalize(join(ROOT, path));
  if (!file.startsWith(ROOT)) { res.writeHead(403); return res.end(); }
  if (!existsSync(file) || statSync(file).isDirectory()) { file = join(ROOT, '404.html'); res.statusCode = 404; }
  const ext = extname(file);
  // Pages' own validator shape: "<mtime-hex>-<size-hex>". Not a content hash —
  // it does not need to be, it needs to CHANGE when the file does, which is the
  // one thing `immutable` refused to let anything do.
  const st = statSync(file);
  const etag = `"${Math.floor(st.mtimeMs / 1000).toString(16)}-${st.size.toString(16)}"`;
  const headers = {
    'Content-Type': TYPES[ext] || 'application/octet-stream',
    'Cache-Control': NOCACHE ? 'no-store' : 'max-age=600',
    'X-Content-Type-Options': 'nosniff',
  };
  if (!NOCACHE) { headers.ETag = etag; headers['Last-Modified'] = st.mtime.toUTCString(); }
  // A conditional request that still matches costs a header and no body, which
  // is what makes a ten-minute lifetime cheap enough to be the default.
  if (!NOCACHE && req.headers['if-none-match'] === etag) { res.writeHead(304, headers); return res.end(); }
  const gz = TEXT.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gz) headers['Content-Encoding'] = 'gzip';
  res.writeHead(res.statusCode || 200, headers);
  const s = createReadStream(file);
  gz ? s.pipe(createGzip({ level: 9 })).pipe(res) : s.pipe(res);
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
