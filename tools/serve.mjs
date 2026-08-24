// Static server that behaves like GitHub Pages: gzip for text, long cache for
// hashed-by-content-ish assets, correct types for woff2/avif/webp/js modules.
// node serve.mjs [port]   → serves ../ (the site root)
// node serve.mjs [port] --no-cache → the same, but caching nothing. Use it
// while EDITING. The production-shaped headers below mark every non-HTML asset
// `immutable`, which tells the browser never to revalidate — so an edited js/
// or css/ file keeps coming from disk cache, even across a hard refresh, while
// index.html (max-age=600) updates. That mismatch is silent and reads exactly
// like a code bug: a stale main.js throwing against fresh markup still leaves
// the `js` class set (index.html adds it inline, before any module runs), which
// hides the no-JS still — so the page renders with no flock at all. Leave the
// default alone; tools/check.mjs measures Lighthouse against these real headers.
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
  const headers = { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': NOCACHE ? 'no-store' : ext === '.html' ? 'max-age=600' : 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff' };
  const gz = TEXT.has(ext) && /\bgzip\b/.test(req.headers['accept-encoding'] || '');
  if (gz) headers['Content-Encoding'] = 'gzip';
  res.writeHead(res.statusCode || 200, headers);
  const s = createReadStream(file);
  gz ? s.pipe(createGzip({ level: 9 })).pipe(res) : s.pipe(res);
}).listen(PORT, () => console.log(`serving ${ROOT} on http://localhost:${PORT}`));
