import { SimplePool } from 'nostr-tools/pool';
import type { Config } from '../config';
import type { ZapStore } from './store';
import type { NostrEvent } from './types';
import { parseZapReceipt } from './zap';

/** Suscribe a notas con los hashtags y a zap receipts que las referencian. */
export function startNostr(cfg: Config, store: ZapStore) {
  const pool = new SimplePool();
  const tags = cfg.hashtags.map((t) => t.toLowerCase());
  const zapSubs: { close: () => void }[] = [];
  const watched = new Set<string>();
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flushZapSub = () => {
    timer = null;
    if (!pending.length) return;
    const ids = pending; pending = [];
    zapSubs.push(pool.subscribeMany(cfg.relays, { kinds: [9735], '#e': ids } as any, {
      onevent: (ev: NostrEvent) => { const z = parseZapReceipt(ev); if (z) store.addZap(z); },
    }));
  };
  const watch = (id: string) => {
    if (watched.has(id)) return;
    watched.add(id); pending.push(id);
    if (!timer) timer = setTimeout(flushZapSub, 1500);
  };

  // posts del historial
  store.posts.forEach((p) => watch(p.id));

  const notesSub = pool.subscribeMany(cfg.relays, { kinds: [1], '#t': tags } as any, {
    onevent: (ev: NostrEvent) => {
      store.addPost({ id: ev.id, pubkey: ev.pubkey, content: ev.content, created_at: ev.created_at });
      watch(ev.id);
    },
  });

  return {
    pool,
    close() { notesSub.close(); zapSubs.forEach((s) => s.close()); pool.close(cfg.relays); },
  };
}
