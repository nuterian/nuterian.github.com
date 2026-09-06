/*
 * count.js — one POST per page view, one more with how the page ran, and
 * nothing else.
 *
 * Self-hosted Umami at stats.jugalm.com. No cookies, no localStorage, no
 * device fingerprint, no client-side identifier of any kind: the server
 * derives a visit from the request itself against a salt that rotates daily,
 * so yesterday's visitor cannot be joined to today's. Nothing here can
 * identify a person, and nothing here is shared with anyone.
 *
 * It costs the page nothing. sendBeacon hands the browser a request and
 * returns immediately — the browser sends it on its own schedule, off the
 * critical path, and it cannot block paint, interaction or unload. There is
 * no third-party script: this file is the whole client.
 */
const ENDPOINT = 'https://stats.jugalm.com/api/send';
const WEBSITE = '0a907e1e-2783-4515-b2bf-d5a2b7d8db57';

// Asked not to be counted, in either of the two ways a browser can ask.
const optedOut = () =>
  navigator.doNotTrack === '1' || window.doNotTrack === '1' || navigator.globalPrivacyControl === true;

// Only the real site, and only real people: a local build or a Playwright
// run is not a visit, and the gate suite alone would otherwise invent
// dozens of them every time it runs.
const skip = () =>
  location.hostname !== 'jugalm.com' || navigator.webdriver || optedOut() || !navigator.sendBeacon;

export function count(url = location.pathname + location.search + location.hash) {
  send({ url });
}

// The second beacon: once, how the page RAN on this device — the flock's
// achieved frame rate and renderer, the pixel ratio it chose, the canvas
// area, LCP and the slowest interaction. Every knob on this page was tuned on
// emulation and on one desk, and every real problem it has had was invisible
// to the lab (DESIGN.md, "What actually costs"). Numbers only, no identifier,
// same rules as the count.
export function report(name, data) {
  send({ url: location.pathname, name, data });
}

// LCP and the worst interaction, watched from the moment this module loads
// (buffered, so entries before the observer count too). `inp` here is the
// slowest event duration seen, not the 98th percentile the metric proper
// uses — on a page with three links, the slowest one is the number.
export function watchVitals() {
  let lcp = 0, inp = 0;
  try {
    new PerformanceObserver(l => { for (const e of l.getEntries()) lcp = Math.max(lcp, e.startTime); })
      .observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) inp = Math.max(inp, e.duration); })
      .observe({ type: 'event', buffered: true, durationThreshold: 16 });
  } catch { /* an old browser simply reports zeros */ }
  return () => ({ lcp: Math.round(lcp), inp: Math.round(inp) });
}

function send(fields) {
  if (skip()) return;
  try {
    const body = JSON.stringify({
      type: 'event',
      payload: {
        website: WEBSITE,
        hostname: location.hostname,
        title: document.title,
        referrer: document.referrer,
        screen: `${screen.width}x${screen.height}`,
        language: navigator.language,
        ...fields,
      },
    });
    // text/plain, and that is load-bearing. sendBeacon always sends with
    // credentials mode "include"; application/json is not CORS-safelisted, so
    // it forces a preflight, and a credentialed preflight REFUSES the
    // wildcard Access-Control-Allow-Origin that Umami answers with — the
    // beacon was rejected before it left the browser. A safelisted content
    // type makes it a no-cors request instead: no preflight, nothing to
    // reject, and the body is still parsed as JSON at the other end because
    // Request.json() does not consult the header. The response is opaque,
    // which is fine — there is nothing to read.
    navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'text/plain;charset=UTF-8' }));
  } catch { /* counting is never worth an error in the console */ }
}
