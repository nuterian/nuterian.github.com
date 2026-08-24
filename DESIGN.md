# nuterian.github.io — design notes

The spec the code is checked against. If the site and this file disagree, one of them is wrong.

## What it is

A calling card whose craft is the message. Name, one dry line, two links, an archive of
six freelance sites from 2012–2014, a footer. Almost no words; the flock does the talking.

## The flock

A boids simulation (Reynolds, 1986) drawn as small birds on a canvas that covers **only
the birds, not the viewport** — see *What actually costs* below.
It runs in a **Web Worker on an OffscreenCanvas** and renders through **WebGL instanced
quads — one static unit quad, one ~8 KB dynamic buffer, one draw call per frame**, with
edge anti-aliasing done in the fragment shader (no MSAA) and Canvas 2D as an automatic
fallback. The main thread only sends small messages (pointer, where home is).

- **Rules, in order of weight:** separation, alignment, cohesion, and *you* — a moving
  pointer startles; content merely nudges (see below).
- **Three states per bird.** HOME: softly sprung to its own point in the 2013 brush *jm*
  (a 208-point cloud sampled from the old logo — `js/mark.js`); near home, cruise drops
  to a few px/s so the mark is legible but never still, and the whole mark sways ±5 px on
  a slow sine. STARTLE: a moving pointer nearby makes each bird break on its *own* heading
  (away ± up to 60° of temperament) — no radial shockwave, and never faster than that bird
  can fly. ROAM: after a startle, or now and then out of sheer restlessness, a bird takes
  a wide elliptical lap around wherever the mark currently sits, one to two full rounds
  (random per bird, its own ring — scale, centre, direction all redrawn on departure, so
  no two birds ever trace the same loop), before drifting home. A disrupted flock takes
  real time to reassemble, staggered bird by bird, and a settled flock always has a few
  birds out on a lap — the idle state is never 100 % of the flock at once.
- **The mark lives in whitespace, not at a fixed spot.** Its size never changes, but where
  it sits does: a placement solver (`_placeHome`, run once a step — it's a coarse 7×6 grid
  plus a few refinement rings against the content rectangles, microseconds) scores
  candidate positions by overlap with content and distance from the viewport's centre, with
  hysteresis so a near-tie never makes it hop. The box then *glides* to the winning spot
  (eased, capped at 260 px/s — a deliberate relocation, never a snap), and every bird
  simply chases its point in a home that occasionally moves. Scroll to the archive, where
  the rows occupy the left, and the mark reforms in the open space on the right, same
  size; scroll back and it glides home to the hero. This replaced an earlier "evacuate
  when the mark scrolls off-screen, roam blindly, regroup" system outright — simpler, and
  it means there is always *something* to look at, at every scroll position, not just near
  the top.
- **The content is not a wall — it's a weak field.** Three earlier attempts (hard collision,
  a line-of-sight "pilot brain" routing around it, then a strong smooth field) all kept
  finding force equilibria — pinned single-file queues, jammed corners, even a standing
  ring when the push had a rotational component strong enough to trap a bird in orbit
  around an obstacle, like a charged particle in a magnetic field. The fix each time was
  making the push weaker, not smarter: a field that can win a tug-of-war against anything
  else creates a *standing* equilibrium exactly where the two forces balance, and since
  many different birds pass through that one location, it reads as a permanent queue even
  though no single bird is stuck there. The final field (`_fieldForce`) is a nudge — zero
  at a 70 px fuzzy radius, small even at zero distance, mostly radial with a slight swirl —
  strong enough to bias birds off the text on average, too weak to ever hold one in place.
  Only felt while STARTLE/ROAM, never HOME, so the mark's own shape is never distorted by
  what's beneath it. Since it can't reliably prevent crossings, it doesn't try to: the
  canvas renders *above* the page content (z-index), so a bird drifting over text reads as
  flying over the page, not a glitch underneath it — which the relocating mark makes rare
  in practice anyway, since it seeks the whitespace on its own.
- **Birds see each other.** Separation is computed on positions a fifth of a second
  ahead, with clearance that grows with speed — two birds on crossing paths veer around
  each other rather than phasing through, and alignment folds neighbours' motion into
  every turn.
- **Edges are off-stage, not walls.** The canvas bleeds 90 px past every viewport edge
  and nothing pulls a bird back until it leaves the canvas entirely — so birds exit the
  visible page, turn around out of sight, and re-enter naturally. No visible rebounds.
- **The birds live in the viewport, and the compositor scrolls the page past them.** The
  canvas is `position: fixed`; content rectangles and the mark's placement live in
  document coordinates that the worker offsets by the scroll position — one tiny message
  per scrolled frame, no layout reads on the hot path.
- **Speed is honest.** Every bird has its own top speed (0.8–1.2 × 110 px/s); a startled
  bird may briefly reach 1.35× its own limit, a roaming one 1.15× — nothing ever
  teleports, on hover, scroll or a mark relocating. Steering (turn rate) is capped by
  `maxForce`, so all motion is progressive.
- **Count:** 200 on desktop, 70 on phones — fixed. Never adapted behind your back.
- **Timestep:** fixed 1/60 s with an accumulator, so 30, 60 and 120 Hz screens see the same
  behaviour; frames where no step ran are not redrawn (a 120 Hz display renders 60, not
  120). Neighbour search is a uniform grid keyed by perception radius; the hot loops
  (step and render) allocate nothing — all scratch is preallocated. The canvas backing
  store renders at DPR ≤ 1.5, invisible on 1.25 px shader-feathered strokes and cheaper
  to composite than 2×.
- **Birds, not strokes:** each boid is a baseless triangle — head at its position, two wing
  arms swept back from the heading — with a fully procedural wingbeat: the phase advances
  with speed (~0.9 Hz at rest, ~4 Hz fleeing), the arms beat fore/aft around their
  resting sweep, and each arm foreshortens at the stroke's extremes as the wing leaves the
  plane. Wing length grows a little with speed. Stroke width 1.25 px, matching the type's
  stems; each boid has a personal opacity.
- **Open a sheet:** the page recedes, and the flock slows to 0.35× and dims while you read.
- **Phones:** tap = a 1.3 s attractor at the tap point. The first tap asks (once, lazily)
  for device orientation; tilt becomes gravity. Dragging is never captured — it scrolls.
- **December:** alignment and cohesion drop to zero and the flock falls as snow. The first
  commit to this repo after the 2013 reset was "Add snow".
- **Reduced motion:** one composed still (the simulation is run ahead 600 steps, then
  drawn once). **No script:** an inline SVG still generated by `tools/still.mjs`.
- **Hidden handles:** `window.flock` (count, fps, params, home, season(), tempo(), hue,
  seed, where, snapshot()), `?n=` `?seed=` `?still` `?hue=` `?season=snow` `?mainthread`.
  One console line.

## What actually costs

Measured, after several wrong guesses. A whole frame — simulate 200 birds, build geometry,
draw, `gl.finish()` — costs **0.041 ms**, ~0.25 % of a frame budget; Canvas 2D was 0.045 ms.
Compute is never the cost. The costs that were real, in the order we found them:

1. **Latency, not throughput**: an early build faked scroll offsets inside a page-anchored
   canvas, trailing the compositor by a frame or two — that read as sluggish. Fixed by
   making the birds live in the viewport and offsetting *content* by scroll instead (one
   tiny message per frame): scrolling now costs the flock nothing.
2. **View Transitions + backdrop blurs** on the archive sheet: ~50 ms frames on open.
   Removed — visually near-identical.
3. **Layer size in software compositing**: on machines without GPU compositing (and in
   headless), a big transparent canvas is re-uploaded per frame and throttles the worker's
   whole frame loop. On real GPUs a viewport-sized layer at DPR ≤ 1.5 composites at 60 fps
   (measured headed: 60 fps steady, mid-scatter included). So: DPR capped at 1.5 (invisible
   for 1.25 px shader-feathered strokes), and the canvas draws only when a sim step ran.
4. **Adaptive density was the disease, not the cure**: it read a depressed frame rate and
   thinned the mark. Gone — the count you ask for is the count you get.

Instruments in `tools/`: `fps.mjs` (achieved flock frame rate — the number that matters;
main-thread rAF deltas are vsync-pinned and cannot see any of this), `bench.html`
(per-operation microbench with GPU sync), `perf.mjs` (journey long-task benchmark).

## Colour

One hue, in OKLCH, that drifts through the day (`js/hue.js`): noon is the 2013 site's
yellow (88°), dusk amber, night blue, dawn rose. Lightness and chroma are fixed per theme,
so contrast is constant at every hour:

| token    | light                       | dark                        |
|----------|-----------------------------|-----------------------------|
| bg       | oklch(98.2% .004 95)        | oklch(14% .006 260)         |
| fg       | oklch(19% .01 95)           | oklch(93% .006 95)          |
| accent   | oklch(46% .12 hue) — 5.9:1  | oklch(80% .12 hue) — 9.8:1  |
| flock    | oklch(42% .10 hue)          | oklch(76% .10 hue)          |

Theme follows the system. `t` or the footer `·` cycles system → dark → light
(persisted; applied before first paint by an inline script, so no flash).

## Type

Geist and Geist Mono, self-hosted, subset to ASCII + typographic punctuation
(`tools/fonts.mjs`, 35 KB for both, full variable weight). A metric-compatible fallback face
(`size-adjust`, `ascent-override`) keeps CLS at 0 while they load. Mono only for metadata:
years, captions, links, footer. `tnum` for numbers; `hanging-punctuation`;
`text-wrap: balance` on the name, `pretty` on the line; the *J* is optically outdented.

## Layout

One tall page. Hero is a full viewport (`100dvh`, safe-area aware), text bottom-left, the
flock owns the rest; the hero text recedes on scroll (scroll-driven animation). Archive
below: numbered rows (name · medium in mono), 56 px tall, hairline rules. Footer:
“Handcrafted by Jugal, 2013 → 2026 · previous version”. The arrow fades in the first
time it scrolls into view.

## Archive sheets

Each project's full-length 960 px screenshot (AVIF → WebP → the original PNG from
`/2013/img`) lives in a `<section class="sheet">` inside its row's `<li>`.

- **No script:** `:target` turns the sheet into a full-screen overlay; a close link goes
  back to `#archive`.
- **With script:** the same node is moved into a `<dialog>` and `showModal()`'d — focus
  trap, ESC, `inert` for free. URL gets `#slug` (deep-linkable); back/forward close and
  reopen; ← → and swipe step between projects; focus returns to the opening row. The
  open animation is a plain CSS transform — no View Transitions, no backdrop blur: the
  perf benchmark showed both costing ~50 ms frames on open, for almost nothing visible.
- A vertical ruler on wide screens reads “960 px — the width of the web in 2013”.

## Accessibility

WCAG 2.2 AA throughout, verified by axe on light/dark × desktop/phone × home/sheet/404.
Canvas is `aria-hidden`; nothing is conveyed only by the flock. Skip link. Visible accent
focus rings. ≥ 44 px targets. Every screenshot has a real description.

## Engineering constraints

- No build step for the site. No framework, no analytics, no third-party requests
  (the network tab is this repo). `view-source` is commented and unminified.
- Everything is behind feature detection: no Worker/OffscreenCanvas → main thread;
  no View Transitions → plain; no `<dialog>` → `:target`; no script → still.
- **Gates** (`tools/check.mjs`, run in CI): axe 0 violations; Lighthouse 100/100/100/100 on
  desktop and mobile; first load < 100 KB gzip (currently ~86 KB); no console errors;
  reduced motion is actually still; no-JS still and `:target` work.
- **More instruments, not part of the gate**: `tools/fps.mjs` — the flock's achieved frame
  rate across worker/main-thread and canvas configurations (the metric that matters — see
  *What actually costs*); `tools/bench.html` — per-operation microbench with GPU sync;
  `tools/perf.mjs` — a journey benchmark for long tasks; `tools/crowd.mjs` — samples bird
  state, position and velocity mid-simulation (`window.flock.snapshot()`) and flags any
  bird that is simultaneously slow, content-adjacent and clustered — the actual signature
  of a jam, as opposed to normal flocking density or a single-frame speed dip while
  turning.

## Files

```
index.html  404.html  humans.txt  robots.txt  .nojekyll
css/style.css
js/main.js        the page
js/flock.js       the simulation + renderer + frame loop (pure)
js/flock.worker.js
js/hue.js         hue of the day, OKLCH → sRGB
js/mark.js        the 2013 mark as points
js/404.js
fonts/            subset Geist
img/archive/      AVIF/WebP screenshots and previews
img/mark.svg      favicon, theme-aware
img/og.png        generated from the site itself (?still&seed=2013)
2013/             the previous site, untouched
tools/            dev only: fonts, images, still, og, serve, check
```
