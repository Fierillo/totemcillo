import type { ZapStore, LiveEvent } from './nostr/store';
import { feedFor } from './livefeed';
import { sats } from './util';

const FX_MS = 3000;

/**
 * Bolt + sats in the lower band, only when the zapped post is not on screen (otherwise the real strike falls on its row).
 * One element: a burst coalesces on the latest zap (new random spot and slight tilt each time) and hides itself when done.
 */
export function zapFx(store: ZapStore, host: HTMLElement = document.body, ms = FX_MS, rnd = Math.random): () => void {
  let el: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = feedFor(store).onMiss((e: LiveEvent) => {
    if (e.type !== 'zap' || !e.msats) return;
    if (!el) {
      el = document.createElement('div');
      el.className = 'zap-fx';
      el.setAttribute('role', 'status');
      el.innerHTML = '<div class="zap-fx-burst"><svg viewBox="0 0 24 48" aria-hidden="true"><path d="M15 0 3 27h9L8 48l14-30h-9l5-18z"/></svg><span class="zap-fx-sats"></span></div>';
      (el.firstElementChild as HTMLElement).style.animationDuration = `${ms}ms`;
      host.append(el);
    }
    // Random spot on every zap; centered on `left`, so 20–80% keeps the burst inside the viewport.
    el.style.left = `${20 + rnd() * 60}%`;
    el.style.bottom = `${5 + rnd() * 10}vh`;
    el.style.setProperty('--tilt', `${-8 + rnd() * 16}deg`);
    el.querySelector('.zap-fx-sats')!.textContent = `${sats(e.msats)} sats`;
    el.classList.remove('is-on');
    void el.offsetWidth; // restart the keyframes on a burst
    el.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(() => el?.classList.remove('is-on'), ms);
  });
  return () => { off(); clearTimeout(timer); el?.remove(); };
}
