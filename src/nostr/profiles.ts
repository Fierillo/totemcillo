import type { NostrEvent } from './types';
import type { KV } from './store';
import { isSigned } from './verify';
import { esc, shortKey } from '../util';

/** What we show from a kind:0 profile: alias (display_name, else name) and picture (https only). */
export interface Profile { name?: string; picture?: string }
export interface ProfileOptions {
  /** Fetches those authors' kind:0 from the relays (client-side; no server or Redis). */
  query?: (authors: string[]) => Promise<NostrEvent[]>;
  storage?: KV; batchMs?: number; retryMs?: number;
}

export const PLACEHOLDER_CLASS = 'avatar-ph';
const KEY = 'totemcillo:profiles:v1';
const MAX_STORED = 1000;
const BATCH = 100;
const broken = new Set<string>();

const str = (x: unknown, max: number) => (typeof x === 'string' && x.trim() ? x.trim().slice(0, max) : undefined);

/** Parses a kind:0's content; null if unusable. */
export function parseProfile(ev: NostrEvent): Profile | null {
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

  constructor(o: ProfileOptions = {}) { this.configure(o); }

  configure(o: ProfileOptions) {
    this.o = { ...this.o, ...o };
    if (o.storage) this.load();
  }

  clear() { this.map.clear(); this.queued.clear(); this.inflight.clear(); this.failedAt.clear(); if (this.timer) clearTimeout(this.timer); this.timer = null; }

  /** Profile if already known; null if it has none; undefined while loading (and queues it). */
  get(pk: string): Profile | null | undefined {
    if (this.map.has(pk)) return this.map.get(pk);
    this.request(pk);
    return undefined;
  }

  set(pk: string, p: Profile | null) { this.map.set(pk, p); this.changed(); }

  onChange(fn: () => void): () => void { this.fns.add(fn); return () => { this.fns.delete(fn); }; }

  private changed() { this.fns.forEach((f) => f()); }

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
        for (const pk of batch) {
          const ev = evs.filter((e) => e.kind === 0 && e.pubkey === pk && isSigned(e)).sort((a, b) => b.created_at - a.created_at)[0];
          this.map.set(pk, ev ? parseProfile(ev) : null);
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
        const p = parseProfile({ content: JSON.stringify({ name: (v as any).name, picture: (v as any).picture }) } as NostrEvent);
        if (p) this.map.set(pk, p);
      }
    } catch { /* corrupt cache: ignored */ }
  }

  private save() {
    if (!this.o.storage) return;
    const entries = [...this.map].filter(([, p]) => p).slice(-MAX_STORED);
    try { this.o.storage.setItem(KEY, JSON.stringify(Object.fromEntries(entries))); } catch { /* quota full */ }
  }
}

/** Avatars always go through our proxy: no stand IP leak, bounded size, small WebP. */
export const avatarSrc = (picture: string) => `/api/avatar?url=${encodeURIComponent(picture)}`;

/** Cache shared by the whole app (main.ts configures it with the relays). */
export const profiles = new ProfileCache();

/** Author as round avatar + alias (or short npub and neutral avatar while loading / if missing). Safe HTML. */
export function authorHtml(pk: string | undefined, pc: ProfileCache = profiles): string {
  const ph = `<span class="avatar ${PLACEHOLDER_CLASS}" aria-hidden="true"></span>`;
  if (!pk) return `<span class="author">${ph}<span class="alias">anónimo</span></span>`;
  const p = pc.get(pk);
  const av = p?.picture && !broken.has(avatarSrc(p.picture))
    ? `<img class="avatar" src="${esc(avatarSrc(p.picture))}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer">`
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
