# jugalm.com

My personal site — a calling card, and a small playground.

**[jugalm.com](https://jugalm.com)** · the archive of what I built before it lives at
**[/2013/](https://jugalm.com/2013/)**, preserved as it was.
(It used to live at [nuterian.github.io](https://nuterian.github.io), which now redirects here.)

The birds are a boids simulation drawn as ink strokes. They run in a Web Worker
on an OffscreenCanvas, render as instanced quads in WebGL — one draw call a
frame — and settle into the brush mark from the 2013 site. Everything degrades:
no Worker falls back to the main thread, no WebGL to Canvas 2D, no script to a
still image, and no network at all still works, because a service worker keeps
the whole site on disk.

No build step, no framework, no dependencies. Three files matter: `index.html`,
`css/style.css`, `js/main.js`.

[DESIGN.md](DESIGN.md) is the spec. It records the reasoning, including the
approaches that were tried and thrown away — read it before changing anything
that looks arbitrary, because most of it isn't.

## Running it

    cd tools && node serve.mjs 4174

`tools/check.mjs` is the gate: accessibility, a 100 KB first-load budget,
Lighthouse, offline, no-script, and the handful of behaviours that are easy to
break by accident. `engines.mjs` runs the same journeys in WebKit and Firefox.
