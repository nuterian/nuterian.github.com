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
- **The mark lives in whitespace, not at a fixed spot.** Where it sits, and — when the
  viewport is too cramped to hold it — how big it is:
  a placement solver (`_placeHome`, run once a step — it's a coarse 7×6 grid
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
- **The mark condenses when the viewport has no rail for it.** The 60 rem column leaves no
  room beside a 588 px mark below about 1500 px of viewport, and scrolled to the archive the
  mark stood on the rows: measured, 13 % of it on row text at 1280×800, 3 % at 1440×900, 0 %
  at 1680 and up. So the size is the solver's decision too. `_chooseFit` asks what the *best*
  placement would still cost at each of `FIT_STEPS` (1, 0.8, 0.64) and steps down when more
  than 4 % of the mark would be standing on content, back up only when the next size up would
  be under 0.8 %. Two thresholds rather than one, and a dwell after either move: a mark that
  shrank at exactly the coverage it re-grew at would breathe every time you crossed the line.
  It is measured on the mark's own box, not the padded box the solver scores, because the box
  the birds fill is the one that can be seen to overlap. After: 0 % on content at 1280, 1366,
  1440, 1536 and 1680. The hero is untouched at every width — up there the mark has the whole
  right of the page and the fit never leaves 1. **This is placement only.** Nothing in
  `_chooseFit` touches how a bird flies, which is why `flight.mjs` and `crowd.mjs` don't move.
  A lure pins the fit back to 1 while it is set, so the two compose by taking the smaller of
  the pair rather than multiplying: lured while cramped is 0.42, not 0.42². `homeFit` rides
  along in `window.flock.snapshot()`.
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
  A fourth bug hid in the same function, distinct from the three equilibria above: when a
  bird's position landed exactly *inside* an obstacle rectangle (the boundary-distance math
  is undefined there), `_fieldForce` pushed it away from the block's **centre** instead of
  the nearest edge. For a long thin block — the archive's row list, a `<hr>`-thin rule —
  the centre direction runs *along* the block's length for most points inside it, so every
  bird that grazed in got herded the same way down the block, and `1 − d/R` on a
  centre-to-corner distance could go deeply negative, spiking `s²·fieldForce` far past the
  intended nudge. That's what produced the standing lines on long flat edges (confirmed by
  sampling `window.flock.snapshot()` every ~1.5 s across a startled flock: per-edge
  occupancy climbed from ~1 to 30+ birds over 20 s and kept growing, unlike a healthy
  transient pass-through). The fix pushes from the **nearest face** at full strength
  (`s = 1`, matching the outside formula's value exactly at the boundary — no kink), so
  crossing an edge is continuous and a bird that lands inside gets shoved out the short way,
  never down the block's length. `tools/crowd.mjs`'s last check (startle the flock, watch
  every edge's 45 px band for 15 s) catches exactly this: it fails on the old centre-push
  (band max 30+, climbing) and passes on the fix (band max ~10, flat). Some birds still
  glide along a long edge for 6–9 s at speed — that's the roam ring legitimately tangent to
  that edge at this viewport size, not a trap (drift of hundreds of px, not near-zero
  velocity); telling the two apart requires tracking speed and net drift over multiple
  samples, not just how many birds are near a wall in one screenshot.
- **Birds see each other.** Separation is computed on positions a fifth of a second
  ahead, with clearance that grows with speed — two birds on crossing paths veer around
  each other rather than phasing through, and alignment folds neighbours' motion into
  every turn.
- **Edges are off-stage, not walls.** The canvas bleeds 60 px past every viewport edge
  and nothing pulls a bird back until it leaves the canvas entirely — so birds exit the
  visible page, turn around out of sight, and re-enter naturally. No visible rebounds.
- **On a phone the flock belongs to the hero, not to the viewport.** The archive is
  full-width on a narrow screen — no margin, no whitespace — so a mark that followed you
  down the page had nowhere to go but on top of the rows you were reading, and the
  placement solver put it there: its overlap penalty is near-constant when the obstacle
  covers everything, so the centre preference won. Under 700 px the canvas is therefore
  `position: absolute`, anchored to the document, and simply scrolls away with the hero.
  `main.js` stops subtracting the scroll offset to match — the world no longer moves, so
  the per-frame scroll message is not sent at all there. `overflow-x: clip` had to move to
  `html` and `body` become `position: relative` for this: an absolute canvas 120 px wider
  than the screen otherwise widens the document and makes a phone shrink-to-fit the whole
  page (measured: a 390 px viewport reporting 450).
- **The birds live in the viewport, and the compositor scrolls the page past them.** The
  canvas is `position: fixed`; content rectangles and the mark's placement live in
  document coordinates that the worker offsets by the scroll position — one tiny message
  per scrolled frame, no layout reads on the hot path.
- **Speed is honest.** Every bird has its own top speed (0.8–1.2 × 110 px/s); a startled
  bird may briefly reach 1.35× its own limit, a roaming one 1.15× — nothing ever
  teleports, on hover, scroll or a mark relocating. Steering (turn rate) is capped by
  `maxForce`, so all motion is progressive.
- **Count:** 140 on desktop, 120 on phones (150/120 on the 404) — fixed. Never adapted
  behind your back. 140 is the floor at which the mark still reads (120 goes patchy);
  the mark has 208 points, so not every point gets a bird, and that is fine — a flock
  suggests the shape, it does not stipple it.
- **The mark is sized in bird-widths, not screen fractions.** A bird is one fixed size
  everywhere, so a mark holding a constant 42 % of the canvas is ~119 birds across on a
  desktop and only ~41 across on a phone — at which width the strokes cannot separate and
  the *jm* collapses into a blob however many birds you add. Phones therefore give the mark
  a much larger share (66 %) of a much smaller canvas, sized to still clear the viewport on
  a 320 px screen. Raising the phone count alone only turns a sparse blob into a dense one.
- **Bird count is free; canvas area is not.** Measured on a throttled phone (iPhone 13
  emulation at 4× and 6× CPU): 60, 90, 120, 140 and 200 birds all hold 60 draws/s with zero
  frames over 20 ms. The phone count sat at 60 for no benefit that could be measured — the
  cost of this page has always been the compositor's canvas layer, not the simulation.
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
  drawn once). **No script:** an inline SVG still generated by `tools/still.mjs`. The
  still is hidden by `flock-on`, which main.js sets only *after* the runner starts —
  not by the inline `js` probe. Gating it on `js` meant any failure in main.js (a stale
  cached copy, a bad import) hid the fallback while the canvas never started: an empty
  sky with no birds from either path. Now a broken main.js degrades to the still.
- **Hidden handles:** `window.flock` (count, fps, params, home, season(), tempo(), hue,
  seed, where, snapshot()), `?n=` `?seed=` `?still` `?hue=` `?season=snow` `?mainthread`.
  One console line.

## Flight

Where the flock *goes* — separation, alignment, cohesion, the mark, the ring — is one
question. What a bird does with its **body** on the way is another, and for a long time
nobody asked it: the heading was read straight off the velocity vector and the wingbeat
phase was set once at birth and never touched again. So nothing ever flapped, and a bird
hovering on the mark at 8 px/s — whose velocity direction swings through the whole circle
on force noise alone — span at up to **10 744 °/s**. Thirty rotations a second reads as a
twitching tick mark, not a bird.

- **Attitude is state.** The heading turns *toward* the velocity at a limited rate, and the
  limit tightens with speed, because a turn is flown with bank and ω = g·tanφ/v: you cannot
  carve a tight one at a sprint. Below `headingSpeed` the velocity direction is barely
  believed at all, so a settled bird holds its heading and only looks slowly around, each at
  its own rate — which also stops the mark setting into a hatch of identically-aligned
  strokes. Measured peak is now **278 °/s**, and nothing exceeds 400.
- **One size.** The half-span at full spread is one number for every bird at every speed.
  It used to scale with velocity, so a sprinting bird was 2.3× the length of a resting one
  and the flock appeared to inflate and deflate as it moved. What changes now is the *pose*,
  not the scale: seen from above, a wing is foreshortened at the top and bottom of its
  stroke and fully spread through the middle, so every bird passes through the same full
  span every beat.
- **One phase, four gaits.** There is no state machine and nothing to sequence. The beat
  phase always advances; the gait changes only its **depth** and its **rate**, through three
  exponentially-smoothed scalars — `drive` (how hard it is working), `brake` (thrust
  pointing backwards: the flare, wings forward and spread) and `bank`. Every transition is
  therefore a blend by construction, and a bird powering out of a glide picks the stroke up
  wherever the wing happened to be. The four gaits you can see in
  `tools/out/wingbeat.png` — wings held on the mark, a deep full-power beat fleeing the
  pointer, a held glide out on a lap, and the flare coming home — are all the same six
  lines of arithmetic at different values.
- **A roost is not a shimmer.** The first version gave a settled bird a permanent floor of
  stroke depth and, worse, beat *faster* the slower it flew, on the theory that holding
  station is work. That came out at 7.2 Hz — a full wingbeat every 8.3 frames, on 183 birds
  at once, with the tips travelling 1.29 px a frame on a bird whose whole half-span is
  5.2 px. Uniformly, forever: only 2.5 % of frames had the wings anywhere near still. It
  read as a flicker, which is exactly what it was. A settled bird now **holds** its wings
  and gives a short flap every few seconds, on its own personal clock (period from its
  opacity, offset from its phase, so no two birds beat together and nothing needs a random
  number). Median tip travel is 0.13 px a frame and 57 % of frames are near-still, while
  the tail still reaches 3.1 px — held, but not stuffed. `flight.mjs` gates it from both
  sides, because a bird with its wings nailed on would pass a one-sided check.
- **Flap-flap-glide falls out.** `drive` subtracts the stretches where a bird is fast and
  asking nothing of the air, so a roamer flaps through the turns of its ring and glides the
  straights without anything telling it to. Thrust alone was not enough to drive this: the
  simulation has no drag, so a bird already at escape speed demands no force at all, and
  startled birds came out *gliding* — exactly backwards. Hence a baseline per state, with
  the smoothing turning what would be a switch into a ramp.

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
5. **The renderer must refuse a software GL context.** `failIfMajorPerformanceCaveat`
   is set on the WebGL request: on machines where "WebGL" means SwiftShader (blocklisted
   GPUs, most VMs, headless), the GL path managed 23 draws/s against a 60 Hz rAF while
   the Canvas 2D fallback keeps pace — on those machines 2D is not the degradation, it
   is the fix. Real GPUs are unaffected. The context also declines the buffers it never
   uses (`depth: false, stencil: false`) and asks for `desynchronized`, and the canvas
   bleed shrank 90 → 60 px — the bleed is off-screen paint the compositor pays for at
   full price, ~12 % of the layer at 1440×900.
6. **The fixed timestep beating against vsync.** The simulation ticks at exactly 60 Hz and
   so does the display — but rAF timestamps carry sub-millisecond noise, and a plain
   accumulator turns that noise into an alternating beat. Replaying 479 real rAF deltas
   captured from a 60 Hz screen through `advance()`: only **49.5 %** of frames took one
   step. 25.3 % took two — the flock lurching twice as far — and 25.3 % took **none**, and
   a frame with no step is a frame the Runner never redraws at all. Half the frames wrong,
   in alternation, is precisely what reads as judder, and no amount of headroom fixes it:
   a whole frame costs 0.047 ms, 0.28 % of the budget. The fix is four lines — a delta
   already within 12 % of a whole number of steps simply *is* that many steps, with 120 Hz
   and genuinely slow frames still falling through to the accumulator. Now 100 % of frames
   take exactly one. `tools/flight.mjs` keeps it that way.
7. **A hover that animated `padding-left`**: the archive row nudged its content right by
   animating padding, which re-solved the row's four-column grid on every frame of the
   450 ms — the last layout work in a page that otherwise never reflows after load.
   Measured with Chrome's own `LayoutCount`: 43 layouts per hover in-and-out, against 2
   for the transform that replaced it, pixel-for-pixel the same movement.

Instruments in `tools/`: `fps.mjs` (achieved flock frame rate — the number that matters;
main-thread rAF deltas are vsync-pinned and cannot see any of this), `bench.html`
(per-operation microbench with GPU sync), `perf.mjs` (journey long-task benchmark),
`flight.mjs` (turn rate, one size, the beat actually advancing, one step per frame — plus
`out/wingbeat.png`, a filmstrip, because a wingbeat is motion and no screenshot shows one).

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

Each token is written **once**, in `:root`, as `light-dark(light, dark)` — the table above
is literally the stylesheet. There is no second dark block to keep in sync: a duplicated
palette is a palette that drifts, and this one had been duplicated twice (a
`prefers-color-scheme` copy and a `[data-theme='dark']` copy of the same eight values).
Because `light-dark()` reads the element's used `color-scheme`, the manual override is now
just `:root[data-theme='dark'] { color-scheme: dark }` and its light twin — one declaration
that moves the whole palette *and* the UA's own surfaces (scrollbars, caret, form controls),
which the old token-only override left stranded on the system's theme. `--shadow` isn't a
colour, so `light-dark()` sits on each of its two shadow colours instead of around the list.

Theme follows the system. `t` or the footer `·` cycles system → dark → light
(persisted; applied before first paint by an inline script, so no flash). The canvas colour
is computed in JS, not read from CSS (`js/hue.js` mirrors `--flock`), so `light-dark()` in
the stylesheet never has to be parsed by script.

### Light

The clock has a second output. The same hours that set the hue also say where the light is
(`js/hue.js`: `lightAt`, keyframed by hour and smoothstepped between keys, exactly like
`hueAt`). The sun climbs from upper-left at dawn to overhead at noon and goes down
upper-right; the moon takes the night hours on the same path. Two short twilights hand over
between them at the horizon, dimmed almost to nothing, so the swing back across the sky is
never something you can catch happening.

`lightAt` returns five things: a screen-space **azimuth** (x right, y down, so −90° is
straight up), an **elevation** (0 on the horizon, 1 overhead), a **glint** strength, a
**glow** strength, and a **tint**.

- **Glint follows elevation, inverted.** Raking light at dawn and dusk strikes a wing edge-on
  and flashes off it; noon comes straight down on everything equally and barely glints at
  all. `power · (0.15 + 0.85 · (1 − elev)^1.5)` — about 0.65 at 7am and 0.16 at noon, scaled
  down again at night, because moonlight is dim as well as cool.
- **Glow follows elevation directly**, and the source's brightness only *compresses* it:
  `(0.55 + 0.45 · power) · (0.45 + 0.55 · elev)`. The wash is ambient light, so there is most
  of it at noon and least at 3am — the two curves pull opposite ways on purpose, and the page
  is brightest when the birds are flattest. `power` deliberately does **not** multiply here,
  the way it does in `glint`. It used to, and the moonlight was invisible: `power` is 0.45 for
  the moon, the elevation term cut it again, and night landed at a four-level lift on a
  near-black page. That was implementing "moonlight is dim" photometrically, which is the
  wrong model — the eye is adapted to a dark page, and what makes moonlight read as moonlight
  is that it is *cool*, which the tint already handles. Faintness was doing no work except
  hiding it. Compressed instead, the term is exactly 1 at full sun, so no daylight hour moved.
- **The theme says which light you are under; the clock says where it is.** A light page is
  a daylit page: its tint takes the hour's own hue, so it is rose at dawn and gold at noon —
  no second palette. A dark page is a *night* page, and its light is the moon, which is one
  colour at every hour: `260`, the dark `--bg`'s own hue, nearly drained of chroma.
  `dark ? oklch(.80 + .11·power, .03 + .02·power, 260) : oklch(.42 + .22·power, .04 +
  .09·power, hue)`.

  This was originally keyed to the clock alone, so dark mode at midday was lit by a gold sun
  — read as "sunlight with a yellow tinge" rather than as moonlight, which is exactly what it
  was. Dark mode is not a daylight page with the lights turned down; it is night. The clock
  still moves the light across the sky and sets how hard it rakes in both themes, so `?hour=`
  changes as much in dark as in light — everything except which body is up there.

**The wash** is one fixed pseudo-element (`body::before`) carrying a radial-gradient bloom,
at `z-index: 0` — under every content layer, over the page background. `--bg` therefore
stays the colour every contrast ratio is measured against, which is why the wash costs
nothing in the axe run. Its position is `--light-x` / `--light-y` and its alpha is scaled by
`--glow`; all three are set on `:root` by `main.js` on the hourly tick and on theme changes.
They also have **defaults in pure CSS** (a mid-morning sun), so the page is lit with no
script at all.

Two things about it are easy to get wrong, and were:

- **The bloom needs a core.** A plain two-stop radial peaks at one infinitesimal point and
  is fading everywhere else. With the light sitting near the top edge, that left only the
  gradient's tail on the page — measurably so: the strongest wash pixel was at `y = 0` at
  every hour. The colour is now held flat to 30 % of the radius before the falloff starts.
- **The light source has to stay on the page.** The azimuth alone put noon 10 % *above* the
  viewport, so the brightest light never landed anywhere. The horizontal throw is the
  readable part of the motion and keeps its full swing (±62 %); the vertical is damped
  (±44 %) so the source sits just inside the top edge at every hour.

And the two themes are tuned **separately, not symmetrically**. The same wash does unequal
work on each: over a near-black page it multiplies what is already there, over near-white
paper it only adds a small fraction to something already bright. So light mode's wash sits
*below* its background in lightness (76 % under 98.2 %) and dark mode's sits *above* (68 %
over 14 %), at a higher alpha. At the strongest on-screen point: ~50 levels in light, and in
dark ~73 at noon and ~39 at midnight — the dark figures run higher because a cool wash on a
blue-black ground lifts all three channels at once, where the light theme's warm one mostly
moves blue. Equal alphas produced one visible effect and one invisible one.

It breathes over 45 s on `transform` and `opacity` **only**. Those are compositor
properties: the gradient rasterises once and is never repainted. A gradient that animated
its own stops would repaint a full-viewport layer for 45 s at a stretch, which is the one
thing this page has spent its whole budget avoiding. The amplitude is a few percent.

The breathe is wrapped in `@media (prefers-reduced-motion: no-preference)`, **not** left to
the global reduced-motion override at the foot of the stylesheet. That override sets
`animation-duration: .01ms`, which does not stop an infinite animation — it restarts it
forever, several thousand times a second. (The archive arrow's bob hit this first; it is
gated the same way.) Under reduced motion the computed `animation-name` is `none`, and the
wash is a still. `@media print` hides it.

**The flock catches it.** A wing segment is a thin surface seen from above, so its screen
normal is the segment turned 90°: it flashes when it runs *across* the beam and goes dark
edge-on. `shade = glint · GLINT · |n · lightDir|³`, with `GLINT = 0.5` holding the whole
effect to a whisper.

The GL path computes this **in the vertex shader**, from `n` — which that shader was already
computing to stretch the quad across its segment. So:

- **Nothing is added to the instance layout.** Still two segments per bird, five floats each,
  one draw call. The lighting costs three uniforms and one varying, and no CPU work at all.
- **It is per *segment*, not per bird.** A bird's two wings shade independently, which is
  what makes it read as light rather than as tinting.
- **It flickers, and that is the point.** The wingbeat and the banking already rotate and
  foreshorten every segment each frame, so the glint travels across a turning flock on its
  own. Nothing animates it; it falls out of the geometry that was moving anyway.

Measured against the model at 1× DPR (light theme, seed 7): at 7am the lit fifth of the
flock shifts 16 levels per channel at the stroke's core against a predicted 20, the edge-on
fifth 9 against 12, and the shift correlates with predicted shade at r = 0.62 across all 140
birds. At noon the same numbers are 2.9 and 1.5 — the effect is ~5.7× weaker, which is
elevation doing its job.

`Canvas2DPainter` runs the same `shade()` on the CPU, folded into the six opacity buckets it
already sorts birds into: a wing catching the light lands its bird a bucket brighter. It is
per bird rather than per segment there — both wings are one sub-path — and quantised to six
steps, so it is coarse. It is the fallback; it only has to be *right*, not equal.
`tools/still.mjs` bakes the same shading into the no-JS SVG's per-polyline `opacity`, at the
same hour `og.png` is shot at. Only the angle bakes in: the still strokes `currentColor`, so
its colour still follows the theme at read time.

**`?hour=`** pins the clock — for the hue *and* the light — so a tool's screenshot
reproduces. `tools/og.mjs` pins `?hour=9` alongside `?still`, `?seed=` and reduced motion,
and `og.png` is byte-identical run to run. `?hue=` still pins the accent on its own.

## Type

Geist and Geist Mono, self-hosted, subset twice over by `tools/fonts.mjs`: to ASCII +
typographic punctuation, and to the weights the page actually sets. The CSS asks for exactly
three — 400 (body), 450 (`.row .name`), 500 (the name and the `h2`s) — so the `wght` axis
ships clipped to **400–500** rather than the variable font's native 100–900, in the subsetter
(`variationAxes`) and in both `@font-face` blocks. A variable axis pays for its whole range in
delta data whether or not anyone wears the ends, and the ends here were a third of the
payload: 35.0 KB → 22.4 KB for the pair, the single largest line item on the page. Nothing
rendered moved — the instances at 400/450/500 are the same outlines, differing only in
antialiasing coverage at glyph edges. Weights outside the range would now clamp to the
nearest end, so **the range and the CSS have to be changed together**. A metric-compatible fallback face
(`size-adjust`, `ascent-override`) keeps CLS at 0 while they load. Mono only for metadata:
years, captions, links, footer. `tnum` for numbers; `hanging-punctuation`;
`text-wrap: balance` on the name, `pretty` on the line; the *J* is optically outdented.

## Layout

One tall page. Hero is a full viewport (`100dvh`, safe-area aware), text bottom-left, the
flock owns the rest; the hero text recedes on scroll (scroll-driven animation). The hero's
`archive ↓` link keeps a slow 2.6 s bob on its arrow, eased at both ends so it hangs at the
top and bottom of the travel — the one piece of motion on the page that is *pointing* at
something. It rides `translate` while the hover nudge stays on `transform`, because the two
compose and a running animation would otherwise outrank the hover outright. Archive
below: numbered rows (name · medium in mono), 56 px tall, hairline rules.

### Two tenses

`Making` and `Archive` are the **same component**, twice. Same container, same hairline list,
same four-column row. Making them differ in appearance would have been the obvious move and
the wrong one: they are both *work*, and the page has one way of listing work. Three things
carry the difference instead:

- **The arrow.** `↗` leaves for a living site; `→` opens a dialog here. The archive is
  screenshots of things that are finished and offline; a project still being made has
  somewhere to *go*, so the row is a plain link and there is no sheet at all — sending you to
  the running thing beats any screenshot of it.
- **The header.** `Making · 2026 → · in progress` against `Archive · 2012 – 2014 · freelance
  web design`. The open-ended `→`, with no year after it, is the footer's `2013 → 2026`
  arrow doing the same job.
- **The flock.** The archive is an obstacle the birds route around — the past, under glass.
  Point at a Making row and the mark **condenses to 42 % and comes over**, then drifts back
  when you leave. Hover also switches the pointer's repel off for that row, so birds it just
  called are not scattered by the cursor that called them.

Both sections' rows are numbered from `01`. Numbering is per section, so each list counts its
own contents and neither renumbers when the other grows.

**Why it moves the mark and not the birds.** The first design called a few birds over with the
`attract` the taps already use. It cannot work: in `home` every bird is committed to its own
point on the mark — measured, 140 of 140 in state 0 — and at *twenty times* the intended force
the flock still did not visibly answer. What can move is where the mark itself wants to be.
`Flock.homeLure` is a point the placement solver prefers over the viewport's centre, at a
weight of 60/px against the usual 14, and hysteresis is skipped while a lure is set (a lure is
a request, not a near-tie). It never outranks the **overlap** term, so the mark comes as close
as it can and still never lands on the words — measured, birds standing on text go *down*
during the gesture, 23 to 18. The glide is the same eased, capped one the mark already uses
when the page scrolls; nothing new animates.

It has to shrink as well as move. At full size the mark cannot fit beside a 60 rem column, so
overlap rightly pins it a screen away and nothing reads as having happened. Condensed and
tucked under the line you are pointing at, the gesture is legible. `LURE_SCALE` is 0.42 —
and since the solver now condenses on its own account too, a lure sets `homeFit` back to 1 for
its duration so the two never multiply.

Only `.row[data-slug]` is wired to the dialogs — the Making row is a link out, and the old
`$$('.row')` would have caught it, cancelled its click and opened a sheet for `undefined`. The hero text
recedes on a scroll-driven animation whose range is a **percentage of the scrollable
distance**, not a `vh` figure: this page is short — one `100dvh` hero over an archive of six
— so on a tall window the whole document scrolls less than one viewport height and the hero
never leaves the screen. Keyed to `70vh` the fade could not finish (at 1400 px tall it
stalled at opacity .31, leaving the github/linkedin/archive links sitting over the archive
you were reading); a percentage is reachable whatever the window. It ends at `opacity: 0`
**and `visibility: hidden`** — opacity alone leaves three invisible links in the tab order,
and focus cannot be relied on to scroll them back into view, because on exactly those tall
windows they are already on screen. Footer: the
dateline “2013 → 2026” and the theme dot, nothing else. The arrow fades in the first
time it scrolls into view. The 2013 site is still preserved at `/2013/` and its
screenshots still come from there, but nothing links to it any more — the archive
sheets are how you see it now.

**One interactive grammar.** Every control answers a pointer in one of two ways, and both
are written once in `css/style.css` rather than per control:

- **Nudge** — a thing that leads somewhere (a link, an archive row) takes the accent colour
  and shifts a little the way it points. On a row: the number and the name travel 0.5 rem,
  the arrow slides 4 px, the name goes accent. The *medium* and the arrow are anchored to
  the right-hand edge and stay; on phones, where the medium is stacked under the name, it
  travels with it.
- **Disc** — a round 44 px control (the sheet's ×, its ← →, the footer's theme dot) lifts
  from muted to fg on a soft accent disc. The dot used to be the odd one out: no radius, no
  fill, hovering only to accent. It now wears the same disc as the other two.

Both animate **colour and transform only** — nothing interactive on this page touches a
layout property, and both borrow the same two timing tokens (`--t-nudge` 0.45 s for travel,
`--t-tint` 0.3 s for colour) so every control settles on the same beat.

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
  **Opening is still exactly that.** Stepping between projects is the one case that earns a
  View Transition, because there the dialog is already open and only its contents change:
  `step()` wraps the swap in `document.startViewTransition`, `#sheet > .sheet` is the only
  named element, and the root snapshot's own animation is switched off so the bar, the
  backdrop and the flock behind them hold still. What is left is a ~200 ms crossfade of the
  figures — the same surface changing what is on it. Behind `prefers-reduced-motion:
  no-preference` in the CSS *and* a `reduceMotion.matches` guard in JS, so under reduced
  motion no transition is started at all rather than started and then zeroed out; without
  `startViewTransition` the swap is the plain one it always was.
- **The sheets open warm.** The first hover or focus on a row appends a
  `<link rel="prefetch">` for that project's first AVIF, once per target; the Making row
  aims at `/forge/`. Prefetching on *intent* rather than on load is the whole point — it
  costs nothing until you point at something, so the first-load budget is untouched and a
  visitor who never opens a sheet never fetches an image. Skipped entirely when
  `navigator.connection.saveData` is set.
- A vertical ruler on wide screens reads “960 px — the width of the web in 2013”.
- **In dark theme the screenshots are dimmed** (`filter: brightness(.88)`). They are 2013
  pages: full-bleed white. At full brightness on a 14 %-lightness sheet, opening one at
  night is a flashbulb. Light mode computes `filter: none`, so it pays nothing. This is the
  one theme-varying value `light-dark()` can't carry — it isn't a colour, and CSS has no
  `@media (color-scheme: dark)` — so the *switch* is written for both dark paths while the
  *value* stays in one place.

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
  desktop and mobile; first load < 100 KB gzip (currently 86.9 KB); no console errors;
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
js/hue.js         hue AND light of the day, OKLCH → sRGB
js/mark.js        the 2013 mark as points
js/404.js
fonts/            subset Geist (glyphs and wght 400–500)
img/archive/      AVIF/WebP screenshots
img/mark.svg      favicon, theme-aware
img/og.png        generated from the site itself (?still&seed=2013&hour=9)
2013/             the previous site, untouched
tools/            dev only: fonts, images, still, og, serve, check
```
