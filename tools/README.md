# tools/

Dev-only. Nothing in here ships. `npm install` once, then:

| command                | what                                                                 |
|------------------------|----------------------------------------------------------------------|
| `node fonts.mjs`       | subset Geist/Geist Mono → `../fonts/` (needs `src-fonts/*.woff2`)    |
| `node images.mjs`      | AVIF/WebP screenshots, favicon, mark point cloud, and the sheet placeholders written into `../index.html`. Wants a running `serve.mjs` — the 2013 sheet is shot from `/2013/`, not dug out of a folder; without one that step is skipped |
| `node still.mjs`       | inline no-JS SVG still → written into `../index.html`                |
| `node og.mjs`          | `../img/og.png` from `?still&seed=2013&hour=9` — byte-reproducible     |
| `node serve.mjs 4174`  | static server with gzip + the headers Pages really sends (`max-age=600`, ETag, 304s). Add `--no-cache` while editing — see the note in the file about what a normal vs a hard reload will and will not pick up |
| `node check.mjs`       | the gate: axe, Lighthouse 100s, < 100 KB, reduced-motion, no-js, behaviours, offline |
| `node engines.mjs`     | the same site in WebKit and Firefox (`npx playwright install webkit firefox` once) |
| `node shots.mjs`       | contact sheet of every state → `out/contact-sheet.png`                |
| `node crowd.mjs`       | are birds collecting in crannies? worst crowd + stuck count, per scroll |
| `node flight.mjs`      | do they fly like birds? turn rate, one size, the beat, frame pacing; filmstrip |
| `node fps.mjs`         | the frame rate the flock actually achieves, worker vs main, per config |
| `node perf.mjs`        | journey benchmark: main-thread frame times and long tasks             |
| `node probe.mjs`       | isolates what costs — canvas area, DPR — one variable at a time       |
| `node tune.mjs '{…}'`  | headless flock tuning: simulate N seconds → PNGs in the scratchpad   |

Anything that takes a picture of the site pins the clocks that would otherwise move under
it: `?seed=` fixes the flock, `?hour=` fixes the hue *and* the light, `?moon=` fixes the
slow clock behind the night's glint (all `js/hue.js`), and Playwright's
`reducedMotion: 'reduce'` stops the CSS animations. `still.mjs` needs no
browser and no pinning: it drives the simulation directly, from the seed, and bakes the
light at the same hour `og.mjs` shoots.

Source fonts: the latin woff2 subsets served by Google Fonts for Geist and Geist Mono
(`src-fonts/`, not committed — see `fonts.mjs` for the URLs).
