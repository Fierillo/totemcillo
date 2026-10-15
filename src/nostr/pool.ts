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

/** Relays compare #t exactly; NIP-24 asks for lowercase but some clients keep the case. */
export const tagVariants = (t: string) => [t.toLowerCase(), t, t[0].toUpperCase() + t.slice(1).toLowerCase(), t.toUpperCase()];
export const notesFilter = (hashtags: string[], since?: number) => ({
  kinds: [1],
  '#t': [...new Set(hashtags.flatMap(tagVariants))],
  ...(since !== undefined ? { since } : {}),
});
/** Connection timeout per relay. Some relays that carry real posts take ~5 s to connect when the
 *  browser opens all sockets at once; nostr-tools' 3 s default silently dropped them. */
export const RELAY_CONNECT_TIMEOUT_MS = 12_000;
/** Pool shared by the totem and /admin, so both see the same relays the same way. */
export const createPool = (): PoolLike => new SimplePool({ maxWaitForConnection: RELAY_CONNECT_TIMEOUT_MS } as any) as unknown as PoolLike;

export const zapsFilter = (ids: string[]) => ({ kinds: [9735], '#e': ids });

/** Loads the most recent signed kind 0 of a pubkey. */
export const profileLoader = (pool: PoolLike, relays: string[]) => async (pubkey: string): Promise<NostrEvent | null> => {
  const evs = await pool.querySync(relays, { kinds: [0], authors: [pubkey] }, { maxWait: 4000 });
  return evs.filter((e) => e.kind === 0 && e.pubkey === pubkey && isSigned(e)).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
};

/** Subscribes to notes with the hashtags and, in batches, to the zap receipts (NIP-57 validated) that reference them. */
export function startNostr(
  cfg: Config,
  store: ZapStore,
  pool: PoolLike = new SimplePool() as unknown as PoolLike,
  batchMs = 1500,
  resolver: Resolver = new LnurlResolver(profileLoader(pool, cfg.relays)),
  cutoff?: number,
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
  subs.unshift(pool.subscribeMany(cfg.relays, notesFilter(cfg.hashtags, cutoff), {
    onevent: (ev) => {
      if (ev.kind !== 1 || !isSigned(ev)) return;
      store.addPost({ id: ev.id, pubkey: ev.pubkey, content: ev.content, created_at: ev.created_at });
      watch(ev.id);
    },
  }));

  return {
    /** keepPool: closes only the subscriptions (the pool is still used by profiles or another subscription). */
    close(keepPool = false) {
      if (timer) clearTimeout(timer);
      subs.forEach((s) => s.close());
      if (!keepPool) pool.close(cfg.relays);
    },
  };
}

/** Follows the server start line: if it moves before what was loaded, resubscribes from there. */
export function followCutoff(start: (cutoff?: number) => { close(keepPool?: boolean): void }, initial?: number) {
  let loaded = initial;
  let h = start(initial);
  return {
    setCutoff(c?: number) {
      const earlier = loaded !== undefined && (c === undefined || c < loaded);
      if (!earlier) return;
      loaded = c;
      const old = h;
      h = start(c);
      old.close(true);
    },
  };
}
