# jugalm.com — design notes

The spec the code is checked against. If the site and this file disagree, one of them is wrong.

## What it is

A calling card whose craft is the message. Name, one dry line, two links, an archive of
seven sites from 2012–2014 — six built for other people and the one this page replaced —
and a footer. Almost no words; the flock does the talking.

## The flock

A boids simulation (Reynolds, 1986) drawn as small birds on a canvas that covers **only
the birds, not the viewport** — see *What actually costs* below.
It runs in a **Web Worker on an OffscreenCanvas** and renders through **WebGL instanced
quads — one static unit quad, one ~8 KB dynamic buffer, one draw call per frame**, with
edge anti-aliasing done in the fragment shader (no MSAA) and Canvas 2D as an automatic
fallback. The main thread only sends small messages (pointer, where home is).

- **Rules, in order of weight:** separation, alignment, cohesion, and *you* — a moving
  pointer startles; content merely nudges (see below).
- **Four states per bird.** HOME: softly sprung to its own point in the 2013 brush *jm*
  (a 208-point cloud sampled from the old logo — `js/mark.js`); near home, cruise drops
  to a few px/s so the mark is legible but never still, and the whole mark sways ±5 px on
  a slow sine. STARTLE: a moving pointer nearby makes each bird break on its *own* heading
  (away ± up to 60° of temperament) — no radial shockwave, and never faster than that bird
  can fly. ROAM: after a startle, or now and then out of sheer restlessness, a bird takes
  a wide elliptical lap around wherever the mark currently sits, one to two full rounds
  (random per bird, its own ring — scale, centre, direction all redrawn on departure, so
  no two birds ever trace the same loop), before drifting home. A disrupted flock takes
  real time to reassemble, staggered bird by bird, and a settled flock always has a few
  birds out on a lap — the idle state is never 100 % of the flock at once. PERCH: below.
- **Time you were not watching still happened.** The loop stops when the tab hides — it must,
  it is someone else's battery — so coming back resumed the exact frozen frame you left, which
  is the one thing a flock should never do. The page measures how long you were gone and the
  simulation is run forward by it before a single frame is drawn: birds have wandered, a
  couple more are out on laps, the mark may have moved. Six seconds away moved one bird 76 px
  and put two more on the wing. Capped at **600 steps (10 s)** — a bound on the WORK, not on
  how long you may be away: in the worker it is free, but on the main-thread fallback it is
  one task, and 1200 steps measured 78 ms, a long task by any definition. 600 is ~28 ms, and
  it is the same number `settle()` has always run. Skipped entirely under `?still` and reduced
  motion, where a still frame is the whole point.
- **A pointer that stops moving stops being a predator.** Until now *you* could only ever
  be a threat: you are the fourth rule, and every branch of it pushed birds away. Leave the
  mouse alone for 45 seconds and the nearest bird — never one already fleeing — flies over
  and settles 32 px off the cursor, on the line it arrived along, wings held in the same
  roost gait the mark uses. Move one pixel and it goes the ordinary way: startled, on a
  heading away from you. It is HOME's own spring aimed at a seat beside the cursor instead
  of a point in the mark, and what it needed was not a new force but three **exemptions**,
  each of which would otherwise have made it impossible: the parked pointer's polite
  clearing would shove it off the seat; the near-pointer startle fires inside 80 px
  *whether or not you moved*, which is exactly where it is sitting; and the generic unstick
  breaks out any slow bird that has been off the mark for two seconds, which is a precise
  description of a bird that has landed. It is exempt from the content field too, because a
  resting cursor is usually on top of words, and a bird pushed off the text is a bird that
  failed to land. Measured: it arrives at ~35 px and holds at 1–2 px/s. `?perch=` sets the
  wait in seconds and `flock.perch()` skips it; `check.mjs` pins both halves — that exactly
  one bird settles near a still cursor, and that the first movement takes it away. Nothing
  polls: it is a single timer that every pointer movement throws away, and it never arms on
  touch, under reduced motion, in December, or while a sheet is open.
- **The mark lives in whitespace, not at a fixed spot.** Where it sits, and — when the
  viewport is too cramped to hold it — how big it is:
  a placement solver (`_placeHome`, run once a step — it's a coarse 7×6 grid
  plus a few refinement rings against the content rectangles, microseconds) scores
  candidate positions by overlap with content and distance from the viewport's centre, with
  hysteresis so a near-tie never makes it hop — while the view is *moving*; see **Where it
  rests is not where you came from**, below. The box then *glides* to the winning spot
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
  The ladder also has a floor to fall off: when even 0.64's *best* placement stands on more
  than 18 % of content — a landscape phone, all words, no rail, no sky — the mark stands down
  entirely (`homeOut`). The box parks, and every grounded bird rejoins the wheel within a
  couple of seconds, because a roaming bird feels the content field and a loitering one does
  not (HOME never does). It returns only once the smallest mark would be under 6 % — clearly
  clear, the same asymmetry as shrink/grow, so a threshold edge never flickers it in and out.
  Before this exit existed a settled landscape phone wore the mark ON the h1: overlap is
  near-constant when content covers everything, so the centre preference picked the title.
  The placement is also memoised on its inputs (scroll, viewport, fit, lure, the obstacle
  set): idle, the grid search does not run at all; scrolling, it runs once per scrolled
  frame, which is exactly when its answer changes.
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
  And share alone cannot win either: 66 % of a phone canvas is a ~10 px point pitch against
  a 10.4 px wingspan, and adjacent birds weld — measured at every share up to 90 % and
  wingspans down to 3.8 px, it is the pitch-to-span ratio that fails, not the size. So a
  phone keeps the size and halves the *grid*: `MARK_THIN` (main.js) takes a checkerboard of
  the sampled points, the pitch grows 1.4×, and 120 birds fill every point that remains
  instead of two-thirds of 208 — the strokes separate again.
- **The box borrows its size; it does not own one.** `homeBox` is the animated rectangle the
  birds actually aim at, and its `w`/`h` were copied once at creation and then never updated
  when the fit ladder stepped — measured **stale by 272 px**. Nothing about the mark itself
  looked wrong, because the bird targets come from `home.size × homeFit`; what read the stale
  box was the **roam ring**, whose centre (`hb.x + hb.w / 2`) and radius (`max(hb.w, hb.h)`)
  both come from it. So whenever the mark condensed, the campus loop circled a mark of the
  wrong size, ~136 px off-centre from the one on screen — and every `snapshot()` reported a
  size the page was not using, which is its own trap for anyone debugging with it. The
  position is animated; the size never was and was never the box's to keep, so it is now
  assigned from the goal every step. One source, and they cannot diverge. Pinned in
  `check.mjs` by forcing the ladder to step and asserting the box followed.
- **Where it rests is not where you came from.** The hysteresis above is right while the view
  is moving — it is what stops the mark hopping between near-ties on every scrolled frame —
  and wrong the moment it stops, because it made the resting place **path-dependent**.
  Scrolled smoothly down to the archive and smoothly back, the goal moved continuously under
  the box, and at scroll 0 the spot it had been dragged to still scored close enough to keep.
  So it kept it: measured, **136 px above** where the very same page puts the mark on load,
  and permanently — twelve seconds later it had not moved. A jump-scroll never reproduced it,
  which is how it survived this long; only a real wheel does, because only a real wheel drags
  the goal through every position in between. Once the inputs have held still for
  `PLACE_SETTLE` (0.7 s) the solver therefore gets **one more pass with the hysteresis off**,
  and the mark glides to the placement the page actually implies. `_settled` then latches, so
  nothing re-solves until something genuinely changes — sampled every 5 s for a minute at
  rest, the box does not move by a pixel. `check.mjs` drives real wheel events down and back
  and fails if the mark comes to rest more than 12 px from where it started.
- **One copy of the size formula.** `markSize(w, h, phone)` lives in `js/mark.js`, with the
  mark itself, because the two places that need it cannot import each other: the page, which
  has a DOM, and `tools/still.mjs`, which has none. It was written out in both, and a copy is
  a thing that drifts — this one had to be hand-edited twice in one afternoon to keep the
  no-JS still matching the canvas beside it. Pure by construction: hand it numbers, it hands
  back a size. The still regenerates byte-identical across the move, which is the proof the
  two copies really were the same.
- **The mark grows with the room it has, and the SPACING is what grows.** It used to be a
  fraction of the width under a flat 620 px cap, which bound above about 1476 px — so a
  2560-wide desktop wore exactly the same mark as a 1440 one, and read as a small huddle
  marooned in a lot of empty page. It is now `min(40 % of the canvas width, 58 % of its
  height × aspect, 840)`. Because a bird is one fixed size everywhere, a wider mark is a
  wider point **pitch**: the flock spreads out and thins rather than magnifying. Measured, as
  a multiple of the 10.4 px wingspan — 1.73 at 1280, 1.93 at 1440, 2.22 at 1680, 2.52 at
  1920, 2.59 at 2560. The fraction is 0.40 rather than 0.42 precisely so 1440 keeps the size
  it had: 0.42 asked for 655 px there, which overlapped enough content that the fit ladder
  *shrank* it to 524 — smaller than before the change, in the one place it must not move.
  - **840 px is where it stops, and that is a legibility limit rather than a taste.**
    Uncapped, 2560 asked for 1126 px at a 3.31 pitch, and at that spacing the strokes stop
    joining and the *jm* comes apart into a constellation — the same pitch-to-wingspan
    failure a phone has from the other side, where the birds weld into a blob. 2.6 is the
    last ratio at which it still reads; both ends were photographed.
  - **The height term is desktop-only.** A short wide window has no more room than a square
    one, so the request is capped against the canvas height too. Applied to phones as well it
    shrank the *landscape* mark enough to drop its share of the words below `FIT_GIVEUP`,
    which put a mark back onto a landscape phone — the exact failure `homeOut` exists to
    prevent. The gate caught it. Phones keep the share they were tuned to.
  - `tools/still.mjs` carries its own copy of this formula, having no DOM to ask, so **the
    two are changed together**; the comment there says so.
- **`fps.mjs` runs headed, and that is the point of it.** Headless Chromium has no GPU
  compositing — a viewport-sized transparent canvas is re-uploaded every frame and throttles
  the worker's whole loop — so the tool built to report the frame rate a person actually sees
  was reporting 34–46 draws/s for configurations that are a flat **60** on the same machine
  with a real GPU, 600 birds at DPR 2 included. An instrument that reads "bad" for a site that
  is fine cannot tell you when the site stops being fine. `--headless` remains, for a machine
  with no display, and prints that its numbers are a floor. (`perf.mjs` stays headless on
  purpose: it measures main-thread frame times and long tasks, and its budgets are calibrated
  to that software-GL floor — it says so in its own header.)
- **Bird count is free; canvas area is not.** Measured on a throttled phone (iPhone 13
  emulation at 4× and 6× CPU): 60, 90, 120, 140 and 200 birds all hold 60 draws/s with zero
  frames over 20 ms. The phone count sat at 60 for no benefit that could be measured — the
  cost of this page has always been the compositor's canvas layer, not the simulation.
- **Timestep:** fixed 1/60 s with an accumulator, so 30, 60 and 120 Hz screens see the same
  behaviour; frames where no step ran are not redrawn (a 120 Hz display renders 60, not
  120). Neighbour search is a uniform grid keyed by perception radius; the hot loops
  (step and render) allocate nothing — all scratch is preallocated. The canvas backing
  store is capped by **area, not by ratio** — see *A pixel budget, not a ratio* below.
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
- **The still leaves when there are birds, not when there is a worker.** `flock-on` — the
  class that stands the no-JS still down — used to be set the moment `startWorker()`
  returned true. But a constructed worker has not drawn anything: it still has to fetch
  `flock.js`, compile it, init and reach a first frame, which is hundreds of milliseconds
  away. In that gap the page had taken the composed mark away and put nothing in its place.
  Measured on a throttled load (400 kbps, 4× CPU): a formed mark at 700 ms, an **empty sky**
  at 1400, birds at 2200. The best frame the page had, deleted, and replaced by a hole.
  The flock now says when it has drawn (`Runner.ondraw`, fired once from `draw()`, relayed
  by the worker as one message) and the still goes then — **fading**, not cutting, so the
  mark dissolves into the flock scattering in behind it rather than being swapped for it in
  a single frame. Same load, after: the mark holds to 1400, the flock draws at 1800, and
  there is no gap at any point. A flock that never draws never fires this, which is the
  point — the fallback still outlives anything broken above it, and now it also outlives a
  worker that starts but never paints. The node is hidden, never removed: it is also the
  letterhead the print stylesheet uses, and print switches its transition off so it can
  never be photographed mid-fade (caught at 0.92 before that).
- **Reduced motion:** one composed still (the simulation is run ahead 600 steps, then
  drawn once). **No script:** an inline SVG still generated by `tools/still.mjs`. The
  still is hidden by `flock-on`, which main.js sets only *after* the runner starts —
  not by the inline `js` probe. Gating it on `js` meant any failure in main.js (a stale
  cached copy, a bad import) hid the fallback while the canvas never started: an empty
  sky with no birds from either path. Now a broken main.js degrades to the still.
- **Hidden handles:** `window.flock` (count, fps, params, home, season(), perch(), tempo(),
  hue, light, seed, where, snapshot()), `?n=` `?seed=` `?still` `?hue=` `?hour=` `?moon=`
  `?perch=` `?season=snow` `?mainthread`. One console line. `flock.params` reports the
  params the flock is **running**, not a copy of the defaults it started from — they ride
  the same once-a-second channel as the frame rate, which is also the only way the page can
  know them now that it does not import the simulation (see *Engineering constraints*).

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
   (measured headed: 60 fps steady, mid-scatter included). So the backing store is capped
   (see below), and the canvas draws only when a sim step ran.
**A pixel budget, not a ratio.** The cap used to be a flat `DPR ≤ 1.5`, and that was the
right number measured on the wrong axis. What the compositor pays for is the layer's *area*
in device pixels; the ratio is only how you get there. A phone's canvas is about a quarter of
a desktop's in CSS pixels, so a flat 1.5 spent a quarter of the budget on the sharpest screen
in the room — a DPR-3 phone drew at 1.5 and the result was upscaled **2×**, which is visible,
and was reported as the birds looking soft. So the ratio is now whatever keeps the layer under
what a 1440×900 desktop has always cost (`PIX = 3.6 MP`), clamped to `[1.5, 2]`. It is a
floor-raising rule rather than a true budget, deliberately: **1.5 stays the minimum**, so no
large display renders worse than it did (a 5K one is over `PIX` and keeps what it had), and 2
is the ceiling, past which nothing more is visible on 1.25 px shader-feathered strokes.
Measured: phones go 1.5 → 2.0 at 1.6–2.0 MP, still *half* the 3.6 MP a laptop has always
carried; an iPad lands on 1.69 and exactly 3.6 MP; 1440×900 @2 and 5K @2 are untouched at
1.5. Peak edge gradient on a phone crop rose 22 %, and Lighthouse mobile stayed 100.

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

**The hue eases between hours, but not into the first one.** `--hue` has a static default in
the stylesheet — the 2013 yellow, so the page is coloured with no script at all — and a
`2s linear` transition, for the drift from one hour to the next and for `?hue=`. Applied to
the *first* hue, that transition animated the whole way from the default to whatever the
clock actually says: measured at 3am, **254° in 2.2 seconds**, 88 → 111 → 177 → 241 → 306 →
342. And because a transition on a number interpolates the number rather than taking the
shorter way round a wheel, the trip ran through green and cyan — hues this palette does not
contain. Every visit opened by touring every colour the design had rejected. The transition
now lives on `:root.hue-live`, which main.js adds two frames after the first hue is in place
(two, because the class must not land in the same style recalculation as the value, or it
transitions anyway). The hue arrives; it no longer tunes in. On a slow connection there is
still one snap, when main.js first runs and replaces the static default — the alternative is
duplicating the hour keyframes into the inline head script, and a duplicated table is a
table that drifts.

Theme follows the system. `t` or the footer's theme control cycles system → dark → light
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
- **Glow follows elevation, and both terms *compress* rather than multiply:**
  `(0.55 + 0.45 · power) · (0.72 + 0.28 · elev)`. The wash is ambient light, so there is most
  of it at noon and least at 3am — glint and glow pull opposite ways on purpose, and the page
  is brightest when the birds are flattest. Neither term multiplies the way `power` does in
  `glint`, and both learned it the same way. `power` went first: it used to multiply, and the
  moonlight was invisible — 0.45 for the moon, cut again by elevation, landing at a four-level
  lift on a near-black page. That is "moonlight is dim" implemented photometrically, which is
  the wrong model. The eye is adapted to a dark page, and what makes moonlight read as
  moonlight is that it is *cool*, which the tint already handles; faintness was doing no work
  except hiding it. **Elevation was still multiplying raw, and it had the same bug.** Its floor
  (0.45) fell on exactly the hours `power` also dips — the sun setting at 19.4 and the moon
  setting at 5.4 — so the two troughs stacked and the wash all but vanished for the hour either
  side of each handover: glow 0.31 at 20:00 against 0.97 at noon, a 3.1× swing, and the evening
  page looked unlit. Compressed to `0.72 + 0.28 · elev` the day's range is 0.48–0.99, dusk and
  night come up 30–75 %, and noon moves by 1 % — each term is exactly 1 at full noon, so no
  daylight hour moved.
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
over 14 %), at a higher alpha — 0.17 against 0.22, since a cool wash on a blue-black ground
must lift all three channels where the light theme's warm one mostly moves blue. Equal alphas
produced one visible effect and one invisible one. Measured as the sRGB distance between the
bloom's core and the far corner, the wash now runs 20–37 levels in light and 21–36 in dark
across the whole day, against 10–33 and 11–27 before the elevation fix and this alpha.

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

### The moon has phases

The night's light was the same light every night. It is the moon — so it now follows the
moon's own cycle, and only in one place: the **glint**. A crescent is a smaller specular
source and flashes off a wing less; a full moon is exactly the number the site had before.
The illuminated fraction comes from the synodic month alone (`moonLit`, three lines, no
ephemeris) — checked against the real full moons of 3 January and 28 August 2026, both hit.

Two things it deliberately does not do. It never touches **`glow`**: the wash is what a
dark-adapted eye reads the page by, and dimming moonlight photometrically is the mistake
this file has already made twice (above). And it is not keyed to the clock — how lunar an
hour is comes off `power`, which is 1 at every daylight key and at most 0.5 at every lunar
one, so `lunar = clamp((1 − power)·2)` is 0 through the day, 1 once the sun is down, and
**continuous across both handovers**; a second set of hour keys could have drifted out of
step with the first. The phase's effect therefore fades in through dusk as the sun's fades
out, and no hour has an edge in it.

It is a whisper, and measured as one: at 2 am, full moon against new moves 1 199 pixels by
an average of 1.09 levels — the glint halves, 0.251 to 0.113, but glint is a cubed
alignment term held to 0.5. At noon it moves **zero** pixels, which is the check that it
stays out of daylight. `?moon=` pins it, and `window.flock.light.moon` reads it.

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

One tall page. Hero is a full viewport (the *visible* one — see below — safe-area aware), text bottom-left, the
flock owns the rest; the hero text recedes on scroll (scroll-driven animation).
  **The hero is sized to the viewport you can actually see, and no static unit could do
  it.** Its text is anchored to the *bottom* of the box, so the height is the whole problem,
  and the browser's chrome is not one shape. `dvh` is the current height but only as honest
  as the browser's reporting: iOS Chrome opened from another app (a link tapped in Messages
  or WhatsApp) lays out at the chrome-*hidden* height while the bottom bar is on screen — the
  box ran ~120 px long and buried the github/linkedin/archive row under the toolbar. `svh` is
  the height with chrome at its *largest*, i.e. assuming a top bar **and** a bottom bar; that
  same mode has no top bar, so the box came up ~46 px short and the archive's first heading
  showed above the fold — a first impression that disagreed with the settled state you get
  after scrolling. Both were measured from phone screenshots. `visualViewport.height` is
  neither guess: it is what is on screen. JS sets `--vh` from it in the head, *before first
  paint*, so the hero is laid out once at the right height and CLS stays 0, and `main.js`
  keeps it current on `visualViewport` resize (rAF-coalesced). Pinch-zoom is ignored — zoomed
  in, that height is the slice being magnified, and honouring it would collapse the hero the
  moment someone zoomed a screenshot. `min-height: var(--vh, 100svh)` keeps `svh` as the
  no-script floor: wrong by 46 px, but never hiding anything. Verified at 718 / 724 / 844 px
  of visible height — hero matches all three, links clear the bottom by the full gutter, the
  archive never peeks. The sheet keeps `dvh`: nothing in it is bottom-anchored and it
  scrolls internally, so an over-reported height hides nothing you cannot reach.
  **Two things about that clearance were wrong.** The links carried the UA's own
  `ul { margin-block: 1em }` underneath a rule that set only `margin-top`, so the hero cleared
  the bottom by the gutter *plus* an accidental 13 px nobody chose, and the whole block sat
  that much high. And the gutter comes from the **width**, which is the wrong axis for the one
  padding that shares a budget with the text: at 1280×360 — a laptop with its window dragged
  flat — it took 64 px off each end of a 360 px viewport, 36 % of it, and the hero grew taller
  than the screen it is supposed to be exactly as tall as. Vertically the hero now takes
  whichever is smaller, the gutter or a twelfth of `--vh` — the same height the box is measured
  against, so the two cannot disagree. It binds only where the viewport is genuinely short;
  every ordinary size still gets the full gutter.
  **Pinned across 8 viewports in `check.mjs`**, 320×480 to 2560×1440 plus a 1440×300: the name
  and the links are above the fold, the links clear the bottom by exactly the padding, the hero
  is never taller than the viewport, and the document is never wider than it. Swept by hand
  across 25 sizes first — phones, landscape phones, tablets, laptops, ultrawides and absurdities. The hero's
`archive ↓` link keeps a slow 2.6 s bob on its arrow, eased at both ends so it hangs at the
top and bottom of the travel — the one piece of motion on the page that is *pointing* at
something. It rides `translate` while the hover nudge stays on `transform`, because the two
compose and a running animation would otherwise outrank the hover outright. Archive
below: numbered rows (name · medium in mono), 56 px tall, hairline rules. **The numbers are
counted, not typed** — `counter-reset` on each `<ol class="rows">`, `counter-increment` on the
`li`, `decimal-leading-zero` in a `::before`. They were six hardcoded spans until a reorder
desynced them from the rows they label, which is a bug the markup should not be able to have.
Both lists reset their own counter, so Making and Archive each start at 01. The empty span
stays: it holds the grid's first column, and it is `aria-hidden` because the number is
decoration — the name is the row's accessible label.

**The rows lift into place as they arrive** — `.rows .row`, on each row's own `view()`
timeline over the first 20 % of its cover range, an 8 px `translate` and nothing else.
Behind `@supports (animation-timeline: view())` and `no-preference`, exactly like the hero's
recede; without either, the rows are simply where they belong. Two things it deliberately
is not. It is not on the `li`: the li carries the hairline, and a rule that slid while its
neighbour's stayed put would break the rhythm of the list, which is the one thing this
section is made of. And **there is no fade**, though a fade was the first idea: `.name` has
contrast to spare (17.5:1) but `.medium`, `.num` and `.arrow` are deliberately quiet greys
at 6.17:1, whose floor for AA is opacity **0.87** — 13 % of headroom, measured. Any fade
worth seeing spends contrast the page does not have, and axe says so, 21 nodes at a time.
So the lift is the whole gesture: it costs no contrast, moves no layout, and if you are not
looking for it you will not find it.

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

**`j` and `k` walk the rows**, both lists, in the order they are written. Focus is the whole
mechanism — it already draws the ring, takes the nudge and the accent, scrolls itself into
view and opens on Enter — so the feature is four lines and no new visual state. Inside an
open sheet the pair does what `←`/`→` do: the same gesture, one level in.

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
dateline “2013 → 2026” and the theme control, nothing else. The arrow fades in the first
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
- **Disc** — a round 44 px control (the sheet's × and its ← →) lifts from muted to fg on a
  soft accent disc.

**The theme control is the one thing that left the disc**, and it left for a reason. It was a
single `·` with a 44 px hit box drawn around it by a `-1rem` margin. The target passed an
audit — 44 px, measurably — and failed in the hand: nothing about a dot says *theme*, so the
glyph reads as the button and that is what people aim at, about 4 px of it, with the box
silently overlapping the dateline beside it. A hit area you cannot see is not an affordance.
So it now shows its own surface — a hairline pill, 83 × 44 — carrying a 15 px icon and the
current mode in a word. **Both, not either.** There are *three* states, and no icon
distinguishes "dark" from "auto, and it happens to be night" without the viewer guessing; the
word settles it, and the icon is what makes the control recognisable at a glance before the
word is read. The icon is one inline SVG with three `<g>`s and CSS shows exactly one, keyed
off `:root[data-theme]` — the same attribute the inline pre-paint script sets, so the icon is
never briefly wrong. The word is the visible label *and* a substring of the `aria-label`, so
the accessible name and the readable one agree (WCAG 2.5.3). With no script it cannot switch
anything, so it is not offered at all.

**A target you can hit is not the same thing as a shape you can see**, and this control needs
both, at different sizes. It was 44 px tall because the *target* is — and at that height it
was more than twice the dateline beside it, a button parked in a line of quiet mono type and
the loudest thing in the footer. The box is still 44 px; the **pill is now a pseudo-element
28 px tall**, sized to the line of type it sits in. The 8 px above and below are forgiving
slop, not the affordance — the pill, the icon and the word are all still visible, which is
the entire point of the redesign that gave this control a surface. The hover fill and the
focus ring moved onto the pseudo-element with it, so both draw around the shape you can see
instead of the box around it.

Both animate **colour and transform only** — nothing interactive on this page touches a
layout property, and both borrow the same two timing tokens (`--t-nudge` 0.45 s for travel,
`--t-tint` 0.3 s for colour) so every control settles on the same beat.

## Archive sheets

Each project's full-length 960 px screenshot (AVIF → WebP → the original PNG from
`/2013/img`) lives in a `<section class="sheet">` inside its row's `<li>`.

- **The seventh sheet is this site, in 2013.** The archive listed what was built for other
  people and left out the best thing built in those years — the page whose brush mark 140
  birds spend all day assembling. Nothing linked to `/2013/` any more either, so the
  question the flock raises had no answer anywhere on the site. Row 07, `jugalm.com · Web
  & Identity`, opens on the old homepage with the *jm* at the top of it, and its caption is
  the only one that leads somewhere: the page is still running. It is also the only sheet
  not dug out of a folder — there is no 2013 PNG of it, because it is not a picture, it is
  a site. `images.mjs` shoots it from the running server at the same 960 px, and skips that
  step with a note if no server is up. Having no original is also why its `<img src>` falls
  back to the WebP rather than to a PNG: the other six keep their 2013-era originals
  because those *are* the artefact, and inventing one here would carry ~700 KB to be the
  fallback for a browser that supports `<dialog>` and `light-dark()` but not WebP.
- **A sheet opens roughly composed.** Each screenshot's own three bands — top, middle and
  bottom, each the average of a twelfth of the image — become a `linear-gradient` behind
  the `<img>`, so a slow connection sees Aprende's dark header, Golem's red and Meditation
  Music's peach in the right places instead of a white slab of the right shape. `#fff` is
  still the default for anything without one. The colours are written **into index.html by
  `images.mjs`**, not pasted from its output: a colour typed by hand is a colour that goes
  stale the next time a screenshot is retaken, which is the same reasoning as the counted
  row numbers.

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
- **The page behind a sheet does not scroll.** `<dialog>` puts the sheet in the top layer
  and inerts the rest, but it does *not* lock the document, so on a phone the archive kept
  scrolling away under the overlay. `html.sheet-open { overflow-y: hidden }` — on `html`,
  not `body`, which is `position: relative` because it is the phone canvas's containing
  block and so cannot be taken out of flow; and on the y axis only, so the `overflow-x:
  clip` that keeps a 120 px-wider canvas from widening the document still stands.
  `scrollbar-gutter: stable` on `html` means losing the scrollbar doesn't reflow the page
  wider the moment a sheet opens (measured: archive width 832 px before and after). The
  no-JS `:target` path needs none of it — it covers the viewport outright.
- **Opening a sheet focuses the sheet, not a button.** `showModal()` focuses the first
  focusable thing it finds, which is `←` — so a sheet opened by tapping a row arrived with a
  focus ring drawn around a control nobody had asked for. The dialog takes `tabindex="-1"`
  and is focused itself (ARIA's own modal pattern): its name is announced, the trap and ESC
  are untouched, and the first Tab still lands on `←` *with* its ring, because a keyboard
  user has actually asked for one. `outline: none` on the dialog is safe here — it is a
  container, not a control. A deep link (`/#unlistr`) opens the sheet while the page is
  still loading and the following `load` hands focus back to `<body>`, leaving a screen
  reader outside an open modal, so the focus is re-asserted once after the page settles.
- **The bar clears the top of a phone.** Full-bleed (`--sheet-top: 0`) the bar was landing
  hard against the top edge and, on a notched device, partly underneath it. The bar's height
  is `--bar` and the dead space above its controls is `--bar-extra`, 0 on the desktop and
  `.85rem + env(safe-area-inset-top)` on a phone; the dialog's top padding, the bar's
  negative pull-up, its sticky `top` and its `min-height` are all written in terms of them,
  so the whole assembly grows together and nothing has to be re-derived. Measured with a
  59 px inset standing in for a Dynamic Island: the bar's background still starts at 0 (it
  is what sits behind the status bar) and every control begins at 81 px.
- **The steppers look as dead as they are.** At the first and last project ← and → were
  already `disabled` and did nothing, but looked identical to live ones, so the only
  feedback for pressing one was silence. They now fade to 0.3 rather than disappearing:
  where you are in a run of six is part of what the pair tells you.
- A vertical ruler on wide screens reads “960 px — the width of the web in 2013”.
- **In dark theme the screenshots are dimmed** (`filter: brightness(.88)`). They are 2013
  pages: full-bleed white. At full brightness on a 14 %-lightness sheet, opening one at
  night is a flashbulb. Light mode computes `filter: none`, so it pays nothing. This is the
  one theme-varying value `light-dark()` can't carry — it isn't a colour, and CSS has no
  `@media (color-scheme: dark)` — so the *switch* is written for both dark paths while the
  *value* stays in one place.

### On paper

Nobody prints a web page; the person who does gets one that was expecting them. `@media
print` used to be four `display: none`s and a rule that printed all nine screenshots. It is
now a **calling card on one sheet** — measured at one page on A4 *and* US Letter, which is
the constraint that set every other number in the block.

- **The letterhead is the flock's own still.** The inline no-JS SVG is already in the
  document, so the whole section costs nothing anyone downloads: print releases it from
  `.flock-on`'s `display: none`, unpins it, and lets it run the page width. It is a whole
  1560 × 1020 frame of sky with the birds only in the middle, so the empty air is pulled
  back off the page with negative margins rather than printed as a gap — the alternative
  was scaling the frame down until the mark was a stamp.
- **It prints in the light palette whatever theme is on screen**, and one declaration says
  so: `:root { color-scheme: light }`. Every token is a `light-dark()` pair, so the scheme
  *is* the palette. The two PDFs came out byte-identical.
- **The hero must not print half-faded.** On screen it recedes on a scroll-driven
  animation, so printing while scrolled down would have committed whatever opacity the page
  happened to be at. Print resets the animation, the opacity and the visibility outright.
- **44 px is a fingertip and there are none here**, so rows drop to the density the type
  wants — which is most of what makes it one sheet — and the row arrows go, since they
  point at things you cannot press.
- **The archive prints as the list it is**, not as nine full-length screenshots. Unless a
  sheet is actually open, in which case that is the thing you asked to print.

### The 404 spells what you typed

It assembled the characters `404` — a number nobody types — while the address bar held the
word the person actually asked for. `textPoints()` samples any string, so it samples theirs:
mistype `/forge` as `/froge` and the flock comes together into your own typo. It costs nothing
to everyone who never lands there, which is the shape of every reward on this site, and the
`<h1>` still says "Not found" in words, so nothing is ever carried only by birds.

- **What it will spell is deliberately narrow**: lowercase a–z, 0–9 and hyphens, off the last
  path segment, extension dropped, hyphens read as spaces, 14 characters at most; anything
  else falls back to `404`. Not for safety — it is rasterised to an offscreen canvas as a
  point cloud and never touches the DOM — but because a long string samples too small to read.
- **More letters, more birds.** The legibility budget is birds *per glyph*: `jm` is 2 glyphs
  to 140, and `404` here was 3 to 150 — about fifty each. Held at 150, a seven-letter word got
  twenty-one and read as a smear. Bird count is the cheap axis (above), so the flock is sized
  to the word rather than the word to the flock: 48 per glyph, capped at 420.
- **And the sampling pitch follows the flock**, which was wrong here long before the word was.
  A fixed 6 px pitch sampled `404` into ~340 points for 150 birds, so two points in five stood
  empty and the glyphs never closed. The grid is now coarsened until the cloud is something
  that many birds can hold — the same ~1.5 points per bird the home page reads at, and the
  same reasoning as the phone halving the mark's grid rather than shrinking the mark.

## Accessibility

WCAG 2.2 AA throughout, verified by axe on light/dark × desktop/phone × home/sheet/404.
Canvas is `aria-hidden`; nothing is conveyed only by the flock. Skip link. Visible accent
focus rings. ≥ 44 px targets. Every screenshot has a real description.

## Engineering constraints

- Counting is first-party and self-hosted: one `sendBeacon` to `stats.jugalm.com` (Umami on
  a Hetzner box, behind Coolify's Traefik). No cookies, no `localStorage`, no fingerprint and
  no client-side identifier — the server derives a visit from the request against a salt that
  rotates daily, so yesterday's visitor cannot be joined to today's. It honours Do Not Track
  and Global Privacy Control, skips `navigator.webdriver` (the gate suite would otherwise
  invent dozens of visits per run) and skips any hostname that isn't `jugalm.com`. Being
  first-party on our own subdomain also means blocklists don't eat it, so the numbers are
  closer to true than a hosted tracker's would be. An opened archive sheet counts as its own
  view, which is the one genuinely interesting thing this page can measure. `js/count.js`.
  The dashboard is NOT public: Traefik routes only `/api/send` and `/script.js` on that host
  and everything else 503s, because Umami ships with default credentials; it is reached over
  Tailscale instead.
- No build step for the site. No framework, and no third-party requests
  (the network tab is this repo). `view-source` is commented and unminified.
- **`flock.js` exports only what is imported.** It offered eleven symbols and five had no
  consumer anywhere: `DEFAULTS`, `rng`, `wingPose`, `GLPainter`, `Canvas2DPainter`. `DEFAULTS`
  became vestigial the moment the page stopped importing the simulation (below) and nothing
  noticed. They are internal now. Almost no bytes — the point is that a public export is a
  promise, and five of them were promises to nobody.
- **The page does not import the simulation.** This was the single largest item on the
  page, and it was paid **twice**: `js/flock.js` is 22.7 KB gzipped, the worker fetches it
  because it runs it, and `main.js` fetched it too — on the path essentially every visitor
  takes, to run none of it. It wanted three things from that module and none of them needed
  the module: `MARK`/`MARK_ASPECT`, which live in `mark.js` and were only being
  *re-exported* by `flock.js` (dropped, so the worker stops fetching `mark.js` as well —
  the tools that used the re-export now import `mark.js` directly); `DEFAULTS`, for one
  console getter, which now reads the params the flock is actually running off the stats
  message; and `Runner`, which is needed **only if the worker path fails**, so it is now a
  dynamic `import()` on that branch alone. First load went **98.1 KB → 80.5 KB** with a
  session's worth of new work already in it, and Lighthouse mobile FCP 1276 → 1052 ms.
  Two things had to move with it, and both are load-bearing:
  - **Messages queue until the flock exists.** The fallback start is now `async`, and the
    rest of the module carries on addressing a flock that is still arriving. `post` begins
    as a queue and is flushed *after* `init` — never before, because everything else
    describes the flock that `init` creates. Flushing first left `setHome` landing on a
    null flock and the mark never appeared; the landscape gate caught it.
  - **The world is measured at module load**, not at `init`. A queued message carries the
    value it was composed with, so `sendHome()` queued before an awaited `init` shipped a
    mark sized against the placeholder 1×1 canvas — a 0.66 px mark, which the same gate
    caught. Ordering a queue correctly is not enough; the values in it must be right too.
  - `flock-on` (which stands the no-JS still down) is still set only once the flock is
    genuinely live — immediately on the worker path, and after the import resolves on the
    other. A simulation that fails to load must not hide the still that replaces it.
- Everything is behind feature detection: no Worker/OffscreenCanvas → main thread;
  no View Transitions → plain; no `<dialog>` → `:target`; no script → still.
- **All four gates run in CI**, in three jobs. `check.mjs` was the only one that did, which
  left `flight.mjs`, `crowd.mjs` and `engines.mjs` — the three that guard how the flock flies,
  whether it jams, and whether any of this works outside Chromium — running only when someone
  remembered. They protect the least screenshot-visible behaviour on the site, and most of
  this file is a catalogue of exactly those things regressing. WebKit and Firefox get their
  own job because they take far longer to download than to run, and nothing should wait on it.
- **Gates** (`tools/check.mjs`, run in CI): axe 0 violations; Lighthouse 100/100/100/100 on
  desktop and mobile; first load < 100 KB gzip (currently 80.5 KB); no console errors;
  reduced motion is actually still; no-JS still and `:target` work; the behaviours that
  shipped as screenshots, pinned (landscape stand-down, the thinned phone grid, the theme
  switch under blocked storage — all on `?still&mainthread`, stepping the sim by hand so
  each is deterministic and takes milliseconds; plus the perch, which is run live rather
  than stepped, because it is a flight; plus the hero across eight viewports, which is
  layout and needs no flock at all); and offline: kill the network, reload,
  and the page, the flock and a sheet with its screenshot must all still be there.
- **Gates, other engines** (`tools/engines.mjs`): the same site in WebKit and Firefox —
  the engines where the risky dependencies actually differ (OffscreenCanvas in a module
  worker, `light-dark()`, `@property`, `:target` with scripting off). It asserts outcomes,
  not paths — each engine takes whichever flock path it supports — and prints the path, so
  a silent fallback is at least a visible one. As of writing, both take worker + webgl2.
- **The service worker** (`sw.js`): navigations are network-first, so a deploy lands on
  the very next visit and only a dead network falls back to cache; everything else is
  stale-while-revalidate, so repeat visits paint from disk and an asset is at most one
  visit behind. The shell is precached at install (offline works for a visitor who never
  scrolled); archive screenshots are cached as they are seen; the cache version exists to
  *drop* things, not to update them — updates flow through on their own. Offline, the
  console says so: `flock offline — everything you see was already here.`
- **The dev server sends the headers production actually sends.** It claimed to behave like
  GitHub Pages and did not: every non-HTML file went out `public, max-age=31536000, immutable`,
  where Pages sends `max-age=600` with an ETag and a Last-Modified on *everything*, HTML
  included — measured against jugalm.com, not assumed. `immutable` means never revalidate, so
  an edited stylesheet never arrived on any number of reloads, **including hard ones**, while
  index.html updated around it; and the worker's own revalidating fetch was answered from the
  same poisoned cache. It cost an afternoon, chased first as a layout bug and then as a
  service-worker bug. It now serves 600 s with a Pages-shaped `"<mtime>-<size>"` ETag and
  answers conditional requests with a 304. Measured after: a normal reload still shows the old
  file, because 600 s is genuinely fresh — but a **hard reload shows the new one**, which
  `immutable` refused. That is the difference between a cache and a trap. `--no-cache` remains
  for continuous editing.
- **The screenshot is handed to the worker once the worker exists.** A sheet opened by a deep
  link on a first visit is the one thing it never sees: it registers on `load` and starts
  controlling the page after that, so the `<img>` has already been fetched around it. Whether
  the image or the worker wins is a race, and it was measured falling both ways. So once the
  worker is in control, whatever is on screen is asked for once more — `force-cache`, which
  the browser answers from disk for nothing, with the worker now in the middle to keep it.
  The offline gate asserts the screenshot is in the **worker's** cache, not merely the
  browser's; it is honest about what that does not prove (it passes with the hand-over removed
  too, because the race can fall the right way). The mechanism is there so the property stops
  depending on who won on the day.
- **None of the paragraph above was true, because a worker's own `fetch` goes through the
  HTTP cache like anyone else's** — and these assets are served `immutable` for a year. The
  background refresh was handed back the very bytes it was trying to replace, and stored
  them again, so a cached asset could never be updated at all: not after one reload, not
  after ten. Found the way you would expect — an edited stylesheet that would not show up on
  `localhost` — and it reproduces in four steps: install the worker, edit `css/style.css`,
  reload three times, watch nothing happen. It is now a rule with two halves:
  - **A refresh that has something to replace bypasses the HTTP cache** (`cache: 'no-cache'`
    — revalidate, take a 304 when nothing moved), and **the precache bypasses it outright**
    (`cache: 'reload'`), so an install cannot bake in whatever the browser was holding. `V`
    is bumped to `flock-v2` to drop the caches the old code poisoned; measured, a poisoned
    browser recovers in two reloads — one to install alongside, one to take over and drop
    the old cache.
  - **A refresh that has nothing cached deliberately does not.** There is no update to miss,
    and there the browser's cache is a resource rather than an obstacle: it is what serves an
    archive screenshot offline on a *first* visit. The worker registers on `load` and only
    controls the page afterwards, so a deep-linked sheet's `<img>` is requested before it is
    listening and never passes through it — measured, the image is absent from the worker's
    cache after a first visit, **under the old code too**. Which means the offline gate has
    always been passing on the browser's disk cache while appearing to test this worker. It
    still passes, and now the reason is written down. From the second visit on the page is
    controlled from the start and a screenshot you look at really is cached here; the
    difference matters because GitHub Pages sends a far shorter `max-age` than the dev
    server's year.
- **One copy of the plumbing** (`js/theme.js`): which theme is in force, how a mode is
  applied and remembered, how the hour's light lands on the page and the flock. main.js
  and 404.js each carried a private copy and the copies drifted — a missing modifier
  guard on one page, unconverted tap coordinates on the other. Both bugs died with the
  duplication.
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
sw.js             offline and repeat visits (see Engineering constraints)
css/style.css
js/main.js        the page
js/flock.js       the simulation + renderer + frame loop (pure)
js/flock.worker.js
js/theme.js       theme + the hour's light, shared by both pages
js/hue.js         hue AND light of the day, OKLCH → sRGB
js/mark.js        the 2013 mark as points
js/404.js
fonts/            subset Geist (glyphs and wght 400–500)
img/archive/      AVIF/WebP screenshots
img/mark.svg      favicon, theme-aware
img/og.png        generated from the site itself (?still&seed=2013&hour=9)
2013/             the previous site — the page untouched, three lines of head metadata added
tools/            dev only: fonts, images, still, og, serve, check
```
