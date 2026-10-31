import type { LiveEvent, ZapStore } from './nostr/store';

export const MAX_PENDING = 10;
const INDICATOR_MS = 1500;
/** Scenes where each event type's target can be visible (pending expires once all were checked; the battle also takes pending zaps). */
export const TARGET_SCENES: Record<LiveEvent['type'], readonly string[]> = { post: ['post'], zap: ['post', 'batalla'] };

interface Handler { name: string; kinds: LiveEvent['type'][]; visible: (postId: string) => boolean; mark: (e: LiveEvent) => void }
interface Pending extends LiveEvent { checked: Set<string> }

/**
 * Dispatches live events: if a scene on screen shows the target, it animates right away;
 * otherwise, the miss listeners (post icon / zap burst) + pending until entering a scene that shows it (or it expires).
 */
export class LiveFeed {
  pending: Pending[] = [];
  private handlers = new Set<Handler>();
  private misses = new Set<(e: LiveEvent) => void>();
  private watchers = new Set<(e: LiveEvent) => void>();

  constructor(store: ZapStore, private max = MAX_PENDING) { store.onLive((e) => this.onLive(e)); }

  /** Called for live events whose target is not on screen (the one place that decides on-screen vs off-screen). */
  onMiss(fn: (e: LiveEvent) => void): () => void { this.misses.add(fn); return () => { this.misses.delete(fn); }; }

  /** Called for every live event before deciding on-screen vs off-screen (e.g. to switch to the scene that shows it first). */
  watch(fn: (e: LiveEvent) => void): () => void { this.watchers.add(fn); return () => { this.watchers.delete(fn); }; }

  attach(h: Handler): () => void { this.handlers.add(h); return () => { this.handlers.delete(h); }; }

  private onLive(e: LiveEvent) {
    this.watchers.forEach((fn) => fn(e));
    const checked = new Set<string>(); // scenes that already animated it (on screen now)
    for (const h of this.handlers) if (h.kinds.includes(e.type) && h.visible(e.postId)) { h.mark(e); checked.add(h.name); }
    if (!checked.size) this.misses.forEach((fn) => fn(e));
    // Stays pending for its other target scenes: they animate it (once) when next shown.
    const targets = TARGET_SCENES[e.type];
    if (targets.every((n) => checked.has(n)) || (checked.size && !targets.some((n) => checked.has(n)))) return; // done, or shown outside the totem scenes (mobile)
    this.pending.push({ ...e, checked });
    if (this.pending.length > this.max) this.pending.splice(0, this.pending.length - this.max);
  }

  /** On entering a scene: returns its visible pending events; each event is offered once per target scene and expires once all were checked. */
  take(name: string, kinds: LiveEvent['type'][], visibleIds: Set<string>): LiveEvent[] {
    const out: LiveEvent[] = [];
    this.pending = this.pending.filter((p) => {
      if (!kinds.includes(p.type) || p.checked.has(name)) return true;
      if (visibleIds.has(p.postId)) out.push({ type: p.type, postId: p.postId, msats: p.msats });
      p.checked.add(name);
      return !TARGET_SCENES[p.type].every((n) => p.checked.has(n));
    });
    return out;
  }
}

const feeds = new WeakMap<ZapStore, LiveFeed>();
/** One LiveFeed per store (shared by every scene). */
export function feedFor(store: ZapStore): LiveFeed {
  let f = feeds.get(store);
  if (!f) { f = new LiveFeed(store); feeds.set(store, f); }
  return f;
}

const POST_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>';

const ZAP_ICON = '<svg viewBox="0 0 24 48" aria-hidden="true"><path d="M15 0 3 27h9L8 48l14-30h-9l5-18z"/></svg>';

/** Brief off-scene icon for a new post at a random spot/tilt in the lower band; zaps get none unless `zaps` (on the totem the zap-fx burst already announces them). */
export function showIndicator(strip: HTMLElement, e: LiveEvent, { ms = INDICATOR_MS, rnd = Math.random, zaps = false } = {}): HTMLElement | undefined {
  if (e.type !== 'post' && !zaps) return;
  const el = document.createElement('span');
  el.className = `live-ind ${e.type}`;
  el.innerHTML = e.type === 'post' ? POST_ICON : ZAP_ICON;
  el.style.left = `${5 + rnd() * 80}%`;
  el.style.setProperty('--y', `${6 + rnd() * 16}vh`); // height in the lower band (style.css)
  el.style.setProperty('--tilt', `${-12 + rnd() * 24}deg`);
  strip.appendChild(el);
  while (strip.children.length > 6) strip.firstElementChild!.remove();
  setTimeout(() => el.remove(), ms);
  return el;
}
