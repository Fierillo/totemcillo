import type { Post, Zap } from './types';

export interface PostStats { post?: Post; postId: string; msats: number; zaps: Zap[] }

const arr = (x: unknown): unknown[] => (Array.isArray(x) ? x : []);
const str = (x: unknown, max: number) => typeof x === 'string' && x.length > 0 && x.length <= max;
const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export const isPost = (x: any): x is Post =>
  !!x && str(x.id, 64) && str(x.pubkey, 64) && typeof x.content === 'string' && num(x.created_at);
export const isZap = (x: any): x is Zap =>
  !!x && str(x.id, 64) && str(x.postId, 64) && num(x.msats) && x.msats > 0 && typeof x.comment === 'string' &&
  num(x.created_at) && (x.sender === undefined || str(x.sender, 64));

export const MAX_CONTENT = 2000;
export const MAX_COMMENT = 280;
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n) + '…' : s);
const clipPost = (p: Post): Post => ({ ...p, content: clip(p.content, MAX_CONTENT) });
const clipZap = (z: Zap): Zap => ({ ...z, comment: clip(z.comment, MAX_COMMENT) });

export interface StoreOptions { key?: string; maxPosts?: number; maxZaps?: number }

function trimOldest<T extends { id: string; created_at: number }>(m: Map<string, T>, max: number) {
  while (m.size > max) {
    let old: T | undefined;
    for (const v of m.values()) if (!old || v.created_at < old.created_at) old = v;
    m.delete(old!.id);
  }
}

export interface KV { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Store en memoria que agrega sats por post y persiste (localStorage) con debounce. */
export class ZapStore {
  posts = new Map<string, Post>();
  zaps = new Map<string, Zap>();
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  private key: string;
  private maxPosts: number;
  private maxZaps: number;

  constructor(private storage?: KV, opts: StoreOptions = {}) {
    this.key = opts.key ?? 'totemcillo:v1';
    this.maxPosts = opts.maxPosts ?? 500;
    this.maxZaps = opts.maxZaps ?? 5000;
    this.load();
  }

  addPost(p: Post) {
    if (this.posts.has(p.id)) return;
    this.posts.set(p.id, clipPost(p));
    trimOldest(this.posts, this.maxPosts);
    if (this.posts.has(p.id)) this.changed();
  }

  addZap(z: Zap) {
    if (this.zaps.has(z.id)) return;
    this.zaps.set(z.id, clipZap(z));
    trimOldest(this.zaps, this.maxZaps);
    if (this.zaps.has(z.id)) this.changed();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  save() {
    this.storage?.setItem(this.key, JSON.stringify({ posts: [...this.posts.values()], zaps: [...this.zaps.values()] }));
  }

  private changed() {
    this.listeners.forEach((f) => f());
    if (!this.storage || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1000);
  }

  private load() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      const d = JSON.parse(raw);
      arr(d?.posts).filter(isPost).forEach((p) => this.posts.set(p.id, clipPost(p)));
      arr(d?.zaps).filter(isZap).forEach((z) => this.zaps.set(z.id, clipZap(z)));
      trimOldest(this.posts, this.maxPosts);
      trimOldest(this.zaps, this.maxZaps);
    } catch (e) {
      console.warn('Historial corrupto, lo ignoro', e);
    }
  }

  stats(since = 0): PostStats[] {
    const map = new Map<string, PostStats>();
    const entry = (id: string) => {
      let s = map.get(id);
      if (!s) map.set(id, (s = { postId: id, post: this.posts.get(id), msats: 0, zaps: [] }));
      return s;
    };
    this.posts.forEach((p) => entry(p.id));
    for (const z of this.zaps.values()) {
      if (z.created_at < since) continue;
      const s = entry(z.postId);
      s.msats += z.msats;
      s.zaps.push(z);
    }
    map.forEach((s) => s.zaps.sort((a, b) => b.created_at - a.created_at));
    return [...map.values()].sort((a, b) => b.msats - a.msats || (b.post?.created_at ?? 0) - (a.post?.created_at ?? 0));
  }

  top(n: number, since = 0) {
    return this.stats(since).filter((s) => s.msats > 0).slice(0, n);
  }

  latestZaps(n: number): Zap[] {
    return [...this.zaps.values()].sort((a, b) => b.created_at - a.created_at).slice(0, n);
  }

  latestPosts(n: number): Post[] {
    return [...this.posts.values()].sort((a, b) => b.created_at - a.created_at).slice(0, n);
  }
}
