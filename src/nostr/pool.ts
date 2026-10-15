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
/** Allow clock skew, never let future-dated events pin the feed. */
export const MAX_FUTURE_SEC = 120;
export const NOSTR_LIMITS = { eventsPerSecond: 100, concurrentZaps: 4, queuedZaps: 128, contentChars: 16_384, tags: 128, tagValues: 16, tagChars: 2048, eventChars: 32_768 };

function eventBudget() {
  let second = -1, used = 0;
  return () => {
    const now = Math.floor(Date.now() / 1000);
    if (now !== second) { second = now; used = 0; }
    return used++ < NOSTR_LIMITS.eventsPerSecond;
  };
}

/** Cheap bounds before hashing/signature checks or copying untrusted content. */
function boundedEvent(ev: NostrEvent): boolean {
  if (!ev || typeof ev.content !== 'string' || ev.content.length > NOSTR_LIMITS.contentChars || !Array.isArray(ev.tags) || ev.tags.length > NOSTR_LIMITS.tags) return false;
  let size = ev.content.length;
  for (const tag of ev.tags) {
    if (!Array.isArray(tag) || tag.length > NOSTR_LIMITS.tagValues) return false;
    for (const value of tag) {
      if (typeof value !== 'string' || value.length > NOSTR_LIMITS.tagChars) return false;
      size += value.length;
      if (size > NOSTR_LIMITS.eventChars) return false;
    }
  }
  return true;
}

const validTime = (ev: NostrEvent, cutoff = 0) =>
  Number.isSafeInteger(ev.created_at) && ev.created_at >= cutoff && ev.created_at <= Math.floor(Date.now() / 1000) + MAX_FUTURE_SEC;

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
  let zapSub: { close(): void } | undefined;
  let closed = false;
  let watched = new Set<string>();
  const hashtags = new Set(notesFilter(cfg.hashtags)['#t']);
  const admitNote = eventBudget();
  const admitZap = eventBudget();
  const inFlight = new Set<string>();
  const pendingZaps = new Map<string, NostrEvent>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const drainZaps = () => {
    while (!closed && pendingZaps.size && inFlight.size < NOSTR_LIMITS.concurrentZaps) {
      const ev = pendingZaps.values().next().value!;
      pendingZaps.delete(ev.id);
      const id = ev.tags.find((t) => t[0] === 'e')?.[1];
      if (!id || !store.posts.has(id)) continue;
      inFlight.add(ev.id);
      void validateZapReceipt(ev, resolver)
        .then((z) => { if (!closed && z && store.posts.has(z.postId)) store.addZap(z); })
        .catch(() => { /* Invalid/unavailable LNURL: do not count the zap. */ })
        .finally(() => { inFlight.delete(ev.id); drainZaps(); });
    }
  };

  const flush = () => {
    timer = null;
    const ids = [...store.posts.keys()];
    if (ids.length === watched.size && ids.every((id) => watched.has(id))) return;
    zapSub?.close();
    watched = new Set(ids);
    zapSub = ids.length ? pool.subscribeMany(cfg.relays, zapsFilter(ids), {
      onevent: (ev) => {
        if (closed || store.zaps.has(ev?.id) || inFlight.has(ev?.id) || pendingZaps.has(ev?.id) || pendingZaps.size >= NOSTR_LIMITS.queuedZaps || !admitZap()) return;
        if (!boundedEvent(ev) || ev.kind !== 9735 || !validTime(ev, cutoff) || !ev.tags.some((t) => t[0] === 'e' && watched.has(t[1]) && store.posts.has(t[1]))) return;
        pendingZaps.set(ev.id, ev);
        drainZaps();
      },
    }) : undefined;
  };
  const watch = () => {
    timer ??= setTimeout(flush, batchMs);
  };

  if (store.posts.size) watch();
  const notesSub = pool.subscribeMany(cfg.relays, notesFilter(cfg.hashtags, cutoff), {
    onevent: (ev) => {
      if (closed || store.posts.has(ev?.id) || !admitNote()) return;
      if (!boundedEvent(ev)) return;
      if (!validTime(ev, cutoff)) return;
      if (ev.kind !== 1 || !Array.isArray(ev.tags) || !ev.tags.some((t) => t[0] === 't' && hashtags.has(t[1])) || !isSigned(ev)) return;
      if (store.posts.has(ev.id)) return;
      store.addPost({ id: ev.id, pubkey: ev.pubkey, content: ev.content, created_at: ev.created_at });
      if (store.posts.has(ev.id)) watch();
    },
  });

  return {
    /** keepPool: closes only the subscriptions (the pool is still used by profiles or another subscription). */
    close(keepPool = false) {
      closed = true;
      pendingZaps.clear();
      if (timer) clearTimeout(timer);
      notesSub.close();
      zapSub?.close();
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
