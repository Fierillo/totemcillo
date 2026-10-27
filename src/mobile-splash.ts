import { BOLT } from './bolt';

export const SPLASH_MS = { min: 700, max: 8000, quiet: 300 }; // loading screen: short minimum (no flash), safety maximum
export type SplashMs = { min: number; max: number; quiet?: number };

/**
 * Loading screen until the UI is mounted (web fonts + own images, then two frames), `ready()` holds (the feed bolts
 * are final) and nothing moves for a quiet window (no redraw reported via `drew()`, no long task); `max` always ends it.
 * `done` runs once when it leaves.
 */
export function bootSplash(doc: Document, ms: SplashMs, ready: () => boolean, done: () => void) {
  let booting = ms.max > 0, lastDraw = Date.now(), lastLong = 0, uiReady = false;
  const bootAt = Date.now(), el = doc.createElement('div');
  let longs: PerformanceObserver | undefined;
  const stop = () => { clearInterval(timer); longs?.disconnect(); };
  const settle = () => {
    const t = Date.now() - bootAt, quiet = Date.now() - Math.max(lastDraw, lastLong) >= (ms.quiet ?? 0);
    if (!booting || !((uiReady && ready() && quiet && t >= ms.min) || t >= ms.max)) return;
    booting = false;
    stop();
    el.classList.add('is-out');
    setTimeout(() => el.remove(), 400);
    done();
  };
  const timer = booting ? setInterval(settle, 100) : undefined;
  if (booting) {
    el.className = 'm-splash';
    el.setAttribute('role', 'status');
    el.innerHTML = `<h1 class="m-splash-title">Totemcillo</h1><div class="m-splash-bolt" aria-hidden="true">${BOLT}</div><p class="m-splash-tag">#lacrypta</p><p class="m-splash-msg">Cargando…</p>`;
    try { longs = new PerformanceObserver(() => { lastLong = Date.now(); }); longs.observe({ type: 'longtask' }); } catch { /* unsupported */ }
    const d = doc as Document & { fonts?: { ready: Promise<unknown> } };
    const imgs = () => [...d.querySelectorAll<HTMLImageElement>('.mobile img, .m-splash img, header img')].filter((i) => !i.complete && i.src.startsWith(d.location?.origin ?? '\0')) // own assets only, not remote avatars
      .map((i) => new Promise((r) => { i.addEventListener('load', r, { once: true }); i.addEventListener('error', r, { once: true }); }));
    void Promise.resolve(d.fonts?.ready).then(() => Promise.all(imgs()))
      .then(() => requestAnimationFrame(() => requestAnimationFrame(() => { uiReady = true; })));
    doc.body.append(el);
  }
  return {
    get booting() { return booting; },
    drew() { lastDraw = Date.now(); },
    close() { stop(); el.remove(); },
  };
}
