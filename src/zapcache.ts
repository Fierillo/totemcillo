import type { KV } from './nostr/store';

export const ZAP_CACHE_KEY = 'totemcillo:canzap:v1';
export const ZAP_TTL = { yes: 24 * 3600e3, no: 3 * 3600e3 };
const MAX = 500;
/** pubkey → [1 zappable | 0 not, checkedAt ms, profile created_at seen when checked] */
type Entry = [0 | 1, number, number];

/**
 * canZap with a bounded localStorage cache (read once, written on every answer): fresh answers come back with no
 * network; stale ones come back at once and are re-checked in the background (`update` fires if the answer changed).
 * A newer kind 0 invalidates.
 */
export function cachedCanZap(check: (pk: string) => Promise<boolean>, storage: KV | undefined, now = () => Date.now(), profileAt: (pk: string) => number = () => 0) {
  let d: Record<string, Entry>;
  try { const v = JSON.parse(storage?.getItem(ZAP_CACHE_KEY) ?? '{}'); d = v && typeof v === 'object' ? v : {}; } catch { d = {}; }
  const write = (pk: string, ok: boolean) => {
    d[pk] = [ok ? 1 : 0, now(), profileAt(pk)];
    d = Object.fromEntries(Object.entries(d).sort((a, b) => b[1][1] - a[1][1]).slice(0, MAX));
    try { storage?.setItem(ZAP_CACHE_KEY, JSON.stringify(d)); } catch { /* quota full */ }
  };
  const refresh = (pk: string) => check(pk).then((ok) => { write(pk, ok); return ok; });
  const can = (pk: string, update?: (ok: boolean) => void): Promise<boolean> => {
    const e = d[pk];
    if (!Array.isArray(e) || profileAt(pk) > (e[2] ?? 0)) return refresh(pk);
    const cached = e[0] === 1;
    if (now() - e[1] >= (cached ? ZAP_TTL.yes : ZAP_TTL.no)) void refresh(pk).then((ok) => { if (ok !== cached) update?.(ok); }, () => {});
    return Promise.resolve(cached);
  };
  /** Cached answer (even if stale) with no network: views draw the final bolt at once. */
  const peek = (pk: string): boolean | undefined => { const e = d[pk]; return Array.isArray(e) && profileAt(pk) <= (e[2] ?? 0) ? e[0] === 1 : undefined; };
  return Object.assign(can, { peek });
}

export type CanZap = ((pubkey: string, update?: (ok: boolean) => void) => Promise<boolean>) & { peek?: (pubkey: string) => boolean | undefined };

/**
 * Per-view zappability: asks `canZap` once per author and calls `changed` (coalesced: answers that land together
 * redraw once). Without `canZap` everyone counts as zappable.
 */
export function zappability(canZap: CanZap | undefined, changed: () => void, coalesceMs = 50) {
  const known = new Map<string, boolean | undefined>();
  const fresh = new Set<string>(); // answered after being drawn hidden: fade in once
  let timer: ReturnType<typeof setTimeout> | undefined;
  const state = (pk: string) => {
    if (canZap && !known.has(pk)) {
      known.set(pk, canZap.peek?.(pk));
      const set = (ok: boolean) => {
        const was = known.get(pk);
        if (was === ok) return;
        if (was === undefined) fresh.add(pk);
        known.set(pk, ok);
        timer ??= setTimeout(() => { timer = undefined; changed(); }, coalesceMs);
      };
      canZap(pk, set).then(set, () => {});
    }
    return canZap ? known.get(pk) : true;
  };
  return {
    /** Red bolt: the author can't receive zaps (asks if unknown). */
    off: (pk: string) => state(pk) === false,
    /** Confirmed zappable (asks if unknown); Top only ranks these. */
    ok: (pk: string) => state(pk) === true,
    /** Already answered (or no check at all), without asking. */
    settled: (pk: string) => !canZap || known.get(pk) !== undefined,
    /** Asked and still waiting. */
    pending: (pk: string) => known.has(pk) && known.get(pk) === undefined,
    /** Bolt classes: hidden (space kept) while unknown, a one-shot fade when the answer lands; cached answers draw as is. */
    cls: (pk: string) => state(pk) === undefined ? ' bolt-pending' : fresh.delete(pk) ? ' bolt-in' : '',
    stop: () => clearTimeout(timer),
  };
}
