import { SimplePool } from 'nostr-tools/pool';
import type { Config } from '../config';
import type { ZapStore } from './store';
import type { NostrEvent } from './types';
import { parseZapReceipt } from './zap';

export interface PoolLike {
  subscribeMany(relays: string[], filter: any, params: { onevent: (ev: NostrEvent) => void }): { close(): void };
  close(relays: string[]): void;
}

/** Los relays comparan #t exacto; NIP-24 pide minúscula pero hay clientes que respetan el caso. */
export const tagVariants = (t: string) => [t.toLowerCase(), t, t[0].toUpperCase() + t.slice(1).toLowerCase(), t.toUpperCase()];
export const notesFilter = (hashtags: string[]) => ({ kinds: [1], '#t': [...new Set(hashtags.flatMap(tagVariants))] });
export const zapsFilter = (ids: string[]) => ({ kinds: [9735], '#e': ids });

/** Suscribe a notas con los hashtags y, en batches, a zap receipts que las referencian. */
export function startNostr(cfg: Config, store: ZapStore, pool: PoolLike = new SimplePool() as unknown as PoolLike, batchMs = 1500) {
  const subs: { close(): void }[] = [];
  const watched = new Set<string>();
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const ids = pending;
    pending = [];
    subs.push(pool.subscribeMany(cfg.relays, zapsFilter(ids), {
      onevent: (ev) => { const z = parseZapReceipt(ev); if (z) store.addZap(z); },
    }));
  };
  const watch = (id: string) => {
    if (watched.has(id)) return;
    watched.add(id);
    pending.push(id);
    timer ??= setTimeout(flush, batchMs);
  };

  store.posts.forEach((p) => watch(p.id));
  subs.unshift(pool.subscribeMany(cfg.relays, notesFilter(cfg.hashtags), {
    onevent: (ev) => {
      store.addPost({ id: ev.id, pubkey: ev.pubkey, content: ev.content, created_at: ev.created_at });
      watch(ev.id);
    },
  }));

  return {
    close() {
      if (timer) clearTimeout(timer);
      subs.forEach((s) => s.close());
      pool.close(cfg.relays);
    },
  };
}
