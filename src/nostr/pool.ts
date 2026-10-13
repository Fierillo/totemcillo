import { SimplePool } from 'nostr-tools/pool';
import type { Config } from '../config';
import { LnurlResolver } from './lnurl';
import type { ZapStore } from './store';
import type { NostrEvent } from './types';
import { isSigned, validateZapReceipt, type Resolver } from './verify';

export interface PoolLike {
  subscribeMany(relays: string[], filter: any, params: { onevent: (ev: NostrEvent) => void }): { close(): void };
  querySync(relays: string[], filter: any, params?: { maxWait?: number }): Promise<NostrEvent[]>;
  close(relays: string[]): void;
}

/** Los relays comparan #t exacto; NIP-24 pide minúscula pero hay clientes que respetan el caso. */
export const tagVariants = (t: string) => [t.toLowerCase(), t, t[0].toUpperCase() + t.slice(1).toLowerCase(), t.toUpperCase()];
export const notesFilter = (hashtags: string[], since?: number) => ({
  kinds: [1],
  '#t': [...new Set(hashtags.flatMap(tagVariants))],
  ...(since !== undefined ? { since } : {}),
});
export const zapsFilter = (ids: string[]) => ({ kinds: [9735], '#e': ids });

/** Carga el kind 0 firmado más reciente de un pubkey. */
export const profileLoader = (pool: PoolLike, relays: string[]) => async (pubkey: string): Promise<NostrEvent | null> => {
  const evs = await pool.querySync(relays, { kinds: [0], authors: [pubkey] }, { maxWait: 4000 });
  return evs.filter((e) => e.kind === 0 && e.pubkey === pubkey && isSigned(e)).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
};

/** Suscribe a notas con los hashtags y, en batches, a zap receipts (validados NIP-57) que las referencian. */
export function startNostr(
  cfg: Config,
  store: ZapStore,
  pool: PoolLike = new SimplePool() as unknown as PoolLike,
  batchMs = 1500,
  resolver: Resolver = new LnurlResolver(profileLoader(pool, cfg.relays)),
) {
  const subs: { close(): void }[] = [];
  const watched = new Set<string>();
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    timer = null;
    const ids = pending;
    pending = [];
    subs.push(pool.subscribeMany(cfg.relays, zapsFilter(ids), {
      onevent: (ev) => { validateZapReceipt(ev, resolver).then((z) => { if (z) store.addZap(z); }); },
    }));
  };
  const watch = (id: string) => {
    if (watched.has(id)) return;
    watched.add(id);
    pending.push(id);
    timer ??= setTimeout(flush, batchMs);
  };

  store.posts.forEach((p) => watch(p.id));
  const since = cfg.postMaxAgeHours ? Math.floor(Date.now() / 1000) - cfg.postMaxAgeHours * 3600 : undefined;
  subs.unshift(pool.subscribeMany(cfg.relays, notesFilter(cfg.hashtags, since), {
    onevent: (ev) => {
      if (ev.kind !== 1 || !isSigned(ev)) return;
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
