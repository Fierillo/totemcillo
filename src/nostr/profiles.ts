import type { NostrEvent } from './types';
import type { KV } from './store';
import type { PoolLike } from './pool';
import { isSigned } from './verify';
import { esc, shortKey } from '../util';

/** What we show from a kind:0 profile: alias (display_name, else name) and picture (https only). */
interface Profile { name?: string; picture?: string }
interface ProfileOptions {
  /** Fetches those authors' kind:0 from the relays (client-side; no server or Redis). */
  query?: (authors: string[]) => Promise<NostrEvent[]>;
  storage?: KV; batchMs?: number; retryMs?: number;
  /** Live kind:0 subscription for these authors (same relay pool); returns a closer. */
  subscribe?: (authors: string[], onevent: (ev: NostrEvent) => void) => { close(): void };
  /** Debounce before (re)opening the subscription when new authors show up (default 3 s). */
  subscribeDebounceMs?: number;
  /** Downloads and decodes an avatar; the profile is only exposed once it settles (rejects = broken). */
  preload?: (src: string) => Promise<void>;
}

export const PLACEHOLDER_CLASS = 'avatar-ph';
const KEY = 'totemcillo:profiles:v1';
const MAX_STORED = 1000;
/** How long "this author has no kind:0" is trusted after a reload (the live subscription still catches a new one). */
const NO_PROFILE_TTL_MS = 6 * 3600e3;
const BATCH = 100;
/** Cap on authors kept in the live subscription filter (most recently seen win). */
const MAX_WATCHED = 500;
const broken = new Set<string>();

const str = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);

/** Parses a kind:0's content; null if unusable. */
function parseProfile(ev: NostrEvent): Profile | null {
  try {
    const c = JSON.parse(ev.content);
    if (!c || typeof c !== 'object') return null;
    const name = str(c.display_name, 64) ?? str(c.name, 64);
    const pic = str(c.picture, 2048);
    const p: Profile = {};
    if (name) p.name = name;
    if (pic && /^https:\/\//i.test(pic)) p.picture = pic;
    return p.name || p.picture ? p : null;
  } catch { return null; }
}

/** Profile cache: requests in batches, stores in memory and localStorage, notifies when they arrive. */
export class ProfileCache {
  private map = new Map<string, Profile | null>();
  private queued = new Set<string>();
  private inflight = new Set<string>();
  private failedAt = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private fns = new Set<() => void>();
  private o: ProfileOptions = {};
  /** created_at of the kind:0 behind each cached profile (0 = none known). */
  private at = new Map<string, number>();
  /** Authors currently shown (requested through get()), in insertion order. */
  private watched = new Set<string>();
  private subKey = '';
  private sub: { close(): void } | null = null;
  private subTimer: ReturnType<typeof setTimeout> | null = null;
  private settled = new Set<string>();
  private preloading = new Set<string>();
  /** When each author was found to have no profile (ms). */
  private noneAt = new Map<string, number>();

  constructor(o: ProfileOptions = {}) { this.configure(o); }

  configure(o: ProfileOptions) {
    this.o = { ...this.o, ...o };
    if (o.storage) this.load();
  }

  clear() {
    this.unsubscribe();
    for (const c of [this.watched, this.at, this.map, this.queued, this.inflight, this.failedAt, this.settled, this.preloading, this.noneAt]) c.clear();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  /** Profile if already known (avatar preloaded); null if it has none; undefined while loading (and queues it). */
  get(pk: string): Profile | null | undefined {
    this.watch(pk);
    if (!this.map.has(pk)) {
      this.request(pk);
      return undefined;
    }
    const p = this.map.get(pk);
    return p?.picture && !this.avatarSettled(avatarSrc(p.picture)) ? undefined : p;
  }

  private avatarSettled(src: string): boolean {
    if (!this.o.preload || this.settled.has(src)) return true;
    if (this.preloading.has(src)) return false;
    this.preloading.add(src);
    this.o.preload(src)
      .catch(() => { broken.add(src); })
      .finally(() => { this.preloading.delete(src); this.settled.add(src); this.changed(); });
    return false;
  }

  /** created_at of the known kind:0 (0 if none): lets other caches notice a newer profile. */
  updatedAt(pk: string): number { return this.at.get(pk) ?? 0; }

  set(pk: string, p: Profile | null) { this.map.set(pk, p); this.changed(); }

  onChange(fn: () => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }

  private changed() { this.fns.forEach((f) => f()); }

  /**
   * Applies a kind:0 if it is signed, from a watched/known author and newer than what we have.
   * Returns true when the profile changed (then it is persisted and listeners are notified).
   */
  ingest(ev: NostrEvent): boolean {
    if (!ev || ev.kind !== 0 || !(this.watched.has(ev.pubkey) || this.map.has(ev.pubkey))) return false;
    if (!this.accept(ev)) return false;
    this.save();
    this.changed();
    return true;
  }

  /** Same signature and freshness rules for queries and live updates. */
  private accept(ev: NostrEvent): boolean {
    if (ev.kind !== 0 || ev.created_at <= (this.at.get(ev.pubkey) ?? -1) || !isSigned(ev)) return false;
    this.at.set(ev.pubkey, ev.created_at);
    this.map.set(ev.pubkey, parseProfile(ev));
    return true;
  }

  private watch(pk: string) {
    if (this.watched.has(pk)) return;
    this.watched.add(pk);
    if (this.watched.size > MAX_WATCHED) this.watched.delete(this.watched.values().next().value!);
    if (!this.o.subscribe) return;
    if (this.subTimer) clearTimeout(this.subTimer);
    this.subTimer = setTimeout(() => this.resubscribe(), this.o.subscribeDebounceMs ?? 3000);
  }

  /** Closes the previous subscription and opens one with the current author list (if it changed). */
  private resubscribe() {
    this.subTimer = null;
    const authors = [...this.watched];
    const key = [...authors].sort().join(',');
    if (!this.o.subscribe || !authors.length || key === this.subKey) return;
    this.sub?.close();
    this.subKey = key;
    this.sub = this.o.subscribe(authors, (ev) => { this.ingest(ev); });
  }

  private unsubscribe() {
    if (this.subTimer) clearTimeout(this.subTimer);
    this.subTimer = null;
    this.sub?.close();
    this.sub = null;
    this.subKey = '';
  }

  private request(pk: string) {
    if (!this.o.query || this.queued.has(pk) || this.inflight.has(pk)) return;
    const f = this.failedAt.get(pk);
    if (f !== undefined && Date.now() - f < (this.o.retryMs ?? 60_000)) return;
    this.queued.add(pk);
    this.timer ??= setTimeout(() => void this.flush(), this.o.batchMs ?? 300);
  }

  private async flush() {
    this.timer = null;
    const all = [...this.queued];
    this.queued.clear();
    for (let i = 0; i < all.length; i += BATCH) {
      const batch = all.slice(i, i + BATCH);
      batch.forEach((pk) => this.inflight.add(pk));
      try {
        const evs = await this.o.query!(batch);
        const authors = new Set(batch);
        for (const ev of evs) if (authors.has(ev.pubkey)) this.accept(ev);
        for (const pk of batch) {
          if (!this.map.has(pk)) { this.map.set(pk, null); this.noneAt.set(pk, Date.now()); }
          this.failedAt.delete(pk);
        }
        this.save();
        this.changed();
      } catch {
        const now = Date.now();
        batch.forEach((pk) => this.failedAt.set(pk, now));
      } finally {
        batch.forEach((pk) => this.inflight.delete(pk));
      }
    }
  }

  private load() {
    try {
      const d = JSON.parse(this.o.storage?.getItem(KEY) ?? 'null');
      if (!d || typeof d !== 'object') return;
      for (const [pk, v] of Object.entries(d)) {
        if (!/^[0-9a-f]{64}$/.test(pk) || !v || typeof v !== 'object') continue;
        const none = (v as any).none;
        if (Number.isFinite(none)) { if (Date.now() - none < NO_PROFILE_TTL_MS) { this.map.set(pk, null); this.noneAt.set(pk, none); } continue; }
        const p = parseProfile({ content: JSON.stringify({ name: (v as any).name, picture: (v as any).picture }) } as NostrEvent);
        if (p) { this.map.set(pk, p); const t = (v as any).at; if (Number.isFinite(t)) this.at.set(pk, t); }
      }
    } catch { /* corrupt cache: ignored */ }
  }

  private save() {
    if (!this.o.storage) return;
    const entries = [...this.map].filter(([pk, p]) => p || this.noneAt.has(pk)).slice(-MAX_STORED)
      .map(([pk, p]) => [pk, !p ? { none: this.noneAt.get(pk) } : this.at.has(pk) ? { ...p, at: this.at.get(pk) } : p]);
    try { this.o.storage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* quota full */ }
  }
}

/** Avatars always go through our proxy: no stand IP leak, bounded size, small WebP. */
const avatarSrc = (picture: string) => `/api/avatar?url=${encodeURIComponent(picture)}`;

const AVATAR_TIMEOUT_MS = 4000;
/** Downloads and decodes the image so it never paints half loaded; slow or broken ones reject. */
async function preloadImage(src: string, timeoutMs = AVATAR_TIMEOUT_MS): Promise<void> {
  const img = new Image();
  img.referrerPolicy = 'no-referrer';
  img.src = src;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`Avatar ${src} took over ${timeoutMs} ms; showing the neutral avatar`)), timeoutMs); });
  try { await Promise.race([img.decode(), timeout]); } finally { clearTimeout(timer); }
}

/** Cache shared by the whole app (main.ts configures it with the relays). */
export const profiles = new ProfileCache();

/** Configure the same cached, live profiles and avatar fallback in kiosk and admin. */
export function configureProfiles(pool: Pick<PoolLike, 'querySync' | 'subscribeMany'>, relays: string[], storage: KV, doc: Document) {
  profiles.configure({
    query: (authors) => pool.querySync(relays, { kinds: [0], authors }, { maxWait: 4000 }),
    subscribe: (authors, onevent) => pool.subscribeMany(relays, { kinds: [0], authors }, { onevent }),
    storage,
    preload: preloadImage,
  });
  installAvatarFallback(doc);
}

const AUTHOR_LOADING = '<span class="author" aria-busy="true"><span class="avatar skel" aria-hidden="true"></span><span class="alias skel skel-name" aria-hidden="true"></span></span>';

/** Author as round avatar + alias; skeleton while loading; short npub and neutral avatar if it has no profile. Safe HTML. */
export function authorHtml(pk: string | undefined, pc: ProfileCache = profiles): string {
  const ph = `<span class="avatar ${PLACEHOLDER_CLASS}" aria-hidden="true"></span>`;
  if (!pk) return `<span class="author">${ph}<span class="alias">anónimo</span></span>`;
  const p = pc.get(pk);
  if (p === undefined) return AUTHOR_LOADING;
  const av = p?.picture && !broken.has(avatarSrc(p.picture))
    ? `<img class="avatar" src="${esc(avatarSrc(p.picture))}" alt="" decoding="async" referrerpolicy="no-referrer">`
    : ph;
  return `<span class="author">${av}<span class="alias">${p?.name ? esc(p.name) : shortKey(pk)}</span></span>`;
}

/** If a profile picture fails to load, swaps it for the neutral avatar (and doesn't retry it). */
export function installAvatarFallback(doc: Document) {
  doc.addEventListener('error', (e) => {
    const t = e.target as HTMLElement | null;
    if (!t || t.tagName !== 'IMG' || !t.classList.contains('avatar')) return;
    broken.add(t.getAttribute('src') ?? '');
    const s = doc.createElement('span');
    s.className = `avatar ${PLACEHOLDER_CLASS}`;
    s.setAttribute('aria-hidden', 'true');
    t.replaceWith(s);
  }, true);
}
