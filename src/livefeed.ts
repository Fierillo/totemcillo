import type { LiveEvent, ZapStore } from './nostr/store';

export const MAX_PENDING = 10;
export const INDICATOR_MS = 1500;
/** Escenas donde puede verse el objetivo de cada tipo de evento. */
export const TARGET_SCENES: Record<LiveEvent['type'], readonly string[]> = { post: ['post'], zap: ['post', 'top10Historico', 'top10Ultimas3h'] };

interface Handler { name: string; kinds: LiveEvent['type'][]; visible: (postId: string) => boolean; mark: (e: LiveEvent) => void }
interface Pending extends LiveEvent { checked: Set<string> }

/**
 * Reparte los eventos en vivo: si una escena en pantalla muestra el objetivo, lo anima ya;
 * si no, indicador abajo + pendiente hasta entrar a una escena que lo muestre (o vence).
 */
export class LiveFeed {
  pending: Pending[] = [];
  private handlers = new Set<Handler>();
  private indicator?: (e: LiveEvent) => void;

  constructor(store: ZapStore, private max = MAX_PENDING) { store.onLive((e) => this.onLive(e)); }

  setIndicator(fn: (e: LiveEvent) => void) { this.indicator = fn; }

  attach(h: Handler): () => void { this.handlers.add(h); return () => { this.handlers.delete(h); }; }

  private onLive(e: LiveEvent) {
    for (const h of this.handlers) if (h.kinds.includes(e.type) && h.visible(e.postId)) { h.mark(e); return; }
    this.indicator?.(e);
    this.pending.push({ ...e, checked: new Set() });
    if (this.pending.length > this.max) this.pending.splice(0, this.pending.length - this.max);
  }

  /** Al entrar a una escena: devuelve (y quita) los pendientes visibles; los demás suman esta escena como revisada y vencen si ya no les queda ninguna. */
  take(name: string, kinds: LiveEvent['type'][], visibleIds: Set<string>): LiveEvent[] {
    const out: LiveEvent[] = [];
    this.pending = this.pending.filter((p) => {
      if (!kinds.includes(p.type)) return true;
      if (visibleIds.has(p.postId)) { out.push({ type: p.type, postId: p.postId }); return false; }
      p.checked.add(name);
      return !TARGET_SCENES[p.type].every((n) => p.checked.has(n));
    });
    return out;
  }
}

const feeds = new WeakMap<ZapStore, LiveFeed>();
/** Un LiveFeed por store (lo comparten todas las escenas). */
export function feedFor(store: ZapStore): LiveFeed {
  let f = feeds.get(store);
  if (!f) { f = new LiveFeed(store); feeds.set(store, f); }
  return f;
}

const ICONS = {
  zap: '<svg viewBox="0 0 24 48" aria-hidden="true"><path d="M15 0 3 27h9L8 48l14-30h-9l5-18z"/></svg>',
  post: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 3h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-5 4v-4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z"/></svg>',
};

/** Ícono chico y breve en la franja de abajo (se apilan si llegan varios). */
export function showIndicator(strip: HTMLElement, e: LiveEvent, ms = INDICATOR_MS) {
  const el = document.createElement('span');
  el.className = `live-ind ${e.type}`;
  el.innerHTML = ICONS[e.type];
  strip.appendChild(el);
  while (strip.children.length > 6) strip.firstElementChild!.remove();
  setTimeout(() => el.remove(), ms);
}
