import type { LiveEvent, ZapStore } from '../nostr/store';
import { feedFor } from '../livefeed';
import { profiles } from '../nostr/profiles';
import { strike, STRIKE_MS } from '../strike';
import { sats } from '../util';
import { FX } from '../fx';

/** Draws now; coalesces store/profile/resize bursts to at most ten updates per second. */
export function live(store: ZapStore, draw: () => void): () => void {
  draw();
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const redraw = () => { timer = undefined; last = Date.now(); draw(); };
  const schedule = () => {
    if (timer !== undefined) return;
    const wait = 100 - (Date.now() - last);
    if (wait <= 0) redraw();
    else timer = setTimeout(redraw, wait);
  };
  const off = store.onChange(schedule);
  const offP = profiles.onChange(schedule);
  window.addEventListener('resize', schedule);
  return () => { off(); offP(); window.removeEventListener('resize', schedule); clearTimeout(timer); };
}

/**
 * One-shot animation marks for a scene: live events whose target is on screen
 * (or pending when entering the scene) mark the row (is-new / is-zapped) for the next draw; zapped rows also get a lightning strike.
 */
export function liveMarks(store: ZapStore, name: string, kinds: LiveEvent['type'][], visible: (postId: string) => boolean) {
  const feed = feedFor(store);
  const marks = new Map<string, Set<string>>();
  const gains = new Map<string, number>(); // msats each zapped post gained since the last draw
  const struck = new Set<string>(); // zapped rows already struck at their old place (charge)
  let first = true;
  let held: ReturnType<typeof setTimeout> | undefined; // pending redraw after a strike (cleared on off)
  const add = (e: LiveEvent) => {
    const m = marks.get(e.postId) ?? new Set<string>();
    m.add(e.type === 'post' ? 'is-new' : 'is-zapped');
    marks.set(e.postId, m);
    if (e.type === 'zap') gains.set(e.postId, (gains.get(e.postId) ?? 0) + (e.msats ?? 0));
  };
  const off = feed.attach({ name, kinds, visible, mark: add });
  return {
    /** Call when drawing with the visible ids: on the first draw it takes that scene's pending events. */
    begin(ids: string[]) {
      if (!first) return;
      first = false;
      feed.take(name, kinds, new Set(ids)).forEach(add);
    },
    attrs(id: string) {
      const m = marks.get(id);
      const cls = m ? [...m].filter((c) => !(c === 'is-zapped' && struck.has(id))) : [];
      return { cls: cls.length ? ` ${cls.join(' ')}` : '' };
    },
    /**
     * Zap order: the strike lands on the row where it IS, the row charges there (`update`) and only after STRIKE_MS
     * `redraw` moves it to its new place. Returns true while holding (the caller skips this draw).
     */
    charge(find: (id: string) => HTMLElement | null, update: (el: HTMLElement, id: string) => void, redraw: () => void): boolean {
      const els = [...marks].flatMap(([id, m]) => {
        const el = m.has('is-zapped') && !struck.has(id) ? find(id) : null;
        return el ? [[id, el] as const] : [];
      });
      if (!els.length) return false;
      for (const [id, el] of els) {
        el.classList.add('is-zapped');
        update(el, id);
        const msats = gains.get(id);
        strike(el, Math.random, undefined, msats ? `+${sats(msats)} sats` : undefined);
        struck.add(id);
      }
      clearTimeout(held);
      held = setTimeout(redraw, STRIKE_MS);
      return true;
    },
    /** True for a row that already got its strike at its old place (its effect keeps running, not restarted). */
    struck: (id: string) => struck.has(id),
    /** Call after drawing: strikes the zapped rows now on screen in `root` ("+N sats" at the impact), then forgets the marks. */
    consume(root: ParentNode, center = false) {
      root.querySelectorAll<HTMLElement>('.is-zapped').forEach((el) => {
        if (struck.has(el.dataset.id!)) return; // already struck at its old place
        const msats = gains.get(el.dataset.id!);
        strike(el, Math.random, undefined, msats ? `+${sats(msats)} sats` : undefined, center);
      });
      marks.clear();
      gains.clear();
      struck.clear();
    },
    off() { clearTimeout(held); off(); },
  };
}

/** is-new = glow; is-zapped = the strike's leader, then zap-flash (style.css uses the same FX via --fx-*). */
const EFFECTS: Record<string, { ms: number; delay: number }> = { 'is-new': { ms: FX.glowMs, delay: 0 }, 'is-zapped': { ms: FX.leaderMs + FX.glowMs, delay: FX.leaderMs } };

/**
 * Keeps a row's live effect across redraws: `start` records rows that just got is-new / is-zapped,
 * `resume` re-adds the class on later redraws (profile, canZap) with a negative delay so the animation continues instead of restarting.
 */
export function rowEffects(key: (row: HTMLElement) => string, now = () => Date.now()) {
  const started = new Map<string, number>(); // "rowKey class" → when its effect started
  return {
    start(rows: HTMLElement[]) {
      const t = now();
      rows.forEach((li) => Object.keys(EFFECTS).forEach((c) => { if (li.classList.contains(c)) started.set(`${key(li)} ${c}`, t); }));
    },
    resume(rows: HTMLElement[]) {
      const t = now();
      rows.forEach((li) => Object.entries(EFFECTS).forEach(([c, { ms, delay }]) => {
        const k = `${key(li)} ${c}`, at = started.get(k);
        if (at === undefined) return;
        const el = t - at;
        if (el >= ms) { started.delete(k); return; }
        if (el > 0) { li.classList.add(c); li.style.animationDelay = `${delay - el}ms`; }
      }));
    },
  };
}

/** Re-fits `root` without redrawing when its size changes (header/QR/strip, scene entering) or an avatar finishes loading. */
export function refitOn(root: HTMLElement, fit: () => void): () => void {
  const size = () => { const r = root.getBoundingClientRect(); return `${r.width}x${r.height}`; };
  let last = size();
  const run = () => { last = size(); fit(); };
  const onLoad = (e: Event) => { if ((e.target as Element)?.tagName === 'IMG') run(); };
  const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { if (size() !== last) run(); });
  ro?.observe(root);
  root.addEventListener('load', onLoad, true); // load doesn't bubble
  return () => { ro?.disconnect(); root.removeEventListener('load', onLoad, true); };
}
