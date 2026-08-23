# tools/

Dev-only. Nothing in here ships. `npm install` once, then:

| command                | what                                                                 |
|------------------------|----------------------------------------------------------------------|
| `node fonts.mjs`       | subset Geist/Geist Mono → `../fonts/` (needs `src-fonts/*.woff2`)    |
| `node images.mjs`      | AVIF/WebP screenshots + previews, favicon, mark point cloud           |
| `node still.mjs`       | inline no-JS SVG still → written into `../index.html`                |
| `node og.mjs`          | `../img/og.png` from `?still&seed=2013`                               |
| `node serve.mjs 4174`  | static server with gzip + cache headers (what GitHub Pages does)     |
| `node check.mjs`       | the gate: axe, Lighthouse 100s, < 100 KB, reduced-motion, no-js       |
| `node tune.mjs '{…}'`  | headless flock tuning: simulate N seconds → PNGs in the scratchpad   |

Source fonts: the latin woff2 subsets served by Google Fonts for Geist and Geist Mono
(`src-fonts/`, not committed — see `fonts.mjs` for the URLs).
