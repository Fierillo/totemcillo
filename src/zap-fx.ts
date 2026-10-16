import type { ZapStore, LiveEvent } from './nostr/store';
import { sats } from './util';

export const FX_MS = 3000;

/**
 * Bolt + sats at the bottom of the screen over whatever is on scene rotation, mobile tabs or empty state.
 * One element: a burst coalesces on the latest zap (new random horizontal spot each time) and hides itself when done.
 */
export function zapFx(store: ZapStore, host: HTMLElement = document.body, ms = FX_MS): () => void {
  let el: HTMLElement | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const off = store.onLive((e: LiveEvent) => {
    if (e.type !== 'zap' || !e.msats) return;
    if (!el) {
      el = document.createElement('div');
      el.className = 'zap-fx';
      el.setAttribute('role', 'status');
      el.innerHTML = '<div class="zap-fx-burst"><svg viewBox="0 0 24 48" aria-hidden="true"><path d="M15 0 3 27h9L8 48l14-30h-9l5-18z"/></svg><span class="zap-fx-sats"></span></div>';
      (el.firstElementChild as HTMLElement).style.animationDuration = `${ms}ms`;
      host.append(el);
    }
    el.style.left = `${20 + Math.random() * 60}%`; // random horizontal spot on every zap
    el.querySelector('.zap-fx-sats')!.textContent = `${sats(e.msats)} sats`;
    el.classList.remove('is-on');
    void el.offsetWidth; // restart the keyframes on a burst
    el.classList.add('is-on');
    clearTimeout(timer);
    timer = setTimeout(() => el?.classList.remove('is-on'), ms);
  });
  return () => { off(); clearTimeout(timer); el?.remove(); };
}
