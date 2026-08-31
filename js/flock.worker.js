/*
 * flock.worker.js — runs the flock off the main thread.
 * The page transfers its <canvas> here (OffscreenCanvas) and then only sends
 * small messages: pointer position, scroll offset, obstacle rects. Scrolling and
 * layout on the main thread never wait on the simulation, and vice versa.
 */
import { Runner } from './flock.js';

let runner = null;
self.onmessage = ({ data: m }) => {
  if (m.type === 'canvas') {
    runner = new Runner(m.canvas);
    runner.onstats = (s) => self.postMessage({ type: 'stats', ...s });
    runner.ondraw = () => self.postMessage({ type: 'drew' });
    runner.onsnapshot = (s) => self.postMessage({ type: 'snapshot', ...s });
    return;
  }
  runner?.handle(m);
};
