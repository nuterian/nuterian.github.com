/*
 * count.js — one POST per page view, and nothing else.
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

export function count(url = location.pathname + location.search + location.hash) {
  // Only the real site, and only real people: a local build or a Playwright
  // run is not a visit, and the gate suite alone would otherwise invent
  // dozens of them every time it runs.
  if (location.hostname !== 'jugalm.com' || navigator.webdriver || optedOut()) return;
  if (!navigator.sendBeacon) return;
  try {
    const body = JSON.stringify({
      type: 'event',
      payload: {
        website: WEBSITE,
        hostname: location.hostname,
        url,
        title: document.title,
        referrer: document.referrer,
        screen: `${screen.width}x${screen.height}`,
        language: navigator.language,
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
