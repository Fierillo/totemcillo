import type { Post, Zap } from './types';

export interface PostStats { post?: Post; postId: string; msats: number; zaps: Zap[] }

interface Storage { getItem(k: string): string | null; setItem(k: string, v: string): void }

/** Store en memoria que agrega sats por post y persiste en localStorage. */
export class ZapStore {
  posts = new Map<string, Post>();
  zaps = new Map<string, Zap>();
  private listeners = new Set<() => void>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private storage?: Storage, private key = 'totemcillo:v1') {
    this.load();
  }

  addPost(p: Post) {
    if (this.posts.has(p.id)) return;
    this.posts.set(p.id, p);
    this.changed();
  }

  addZap(z: Zap) {
    if (this.zaps.has(z.id)) return;
    this.zaps.set(z.id, z);
    this.changed();
  }

  /** Stats por post, ordenadas por sats desc. `since` (unix s) filtra zaps. */
  stats(since = 0): PostStats[] {
    const map = new Map<string, PostStats>();
    for (const p of this.posts.values()) map.set(p.id, { post: p, postId: p.id, msats: 0, zaps: [] });
    for (const z of this.zaps.values()) {
      if (z.created_at < since) continue;
      let s = map.get(z.postId);
      if (!s) { s = { postId: z.postId, post: this.posts.get(z.postId), msats: 0, zaps: [] }; map.set(z.postId, s); }
      s.msats += z.msats;
      s.zaps.push(z);
    }
    for (const s of map.values()) s.zaps.sort((a, b) => b.created_at - a.created_at);
    return [...map.values()].sort((a, b) => b.msats - a.msats || (b.post?.created_at ?? 0) - (a.post?.created_at ?? 0));
  }

  top(n: number, since = 0) { return this.stats(since).filter((s) => s.msats > 0).slice(0, n); }

  latestZaps(n: number): Zap[] {
    return [...this.zaps.values()].sort((a, b) => b.created_at - a.created_at).slice(0, n);
  }

  latestPosts(n: number): Post[] {
    return [...this.posts.values()].sort((a, b) => b.created_at - a.created_at).slice(0, n);
  }

  onChange(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }

  private changed() {
    this.listeners.forEach((f) => f());
    if (!this.storage || this.saveTimer) return;
    this.saveTimer = setTimeout(() => { this.saveTimer = null; this.save(); }, 1000);
  }

  save() {
    this.storage?.setItem(this.key, JSON.stringify({ posts: [...this.posts.values()], zaps: [...this.zaps.values()] }));
  }

  private load() {
    try {
      const raw = this.storage?.getItem(this.key);
      if (!raw) return;
      const d = JSON.parse(raw) as { posts: Post[]; zaps: Zap[] };
      d.posts?.forEach((p) => this.posts.set(p.id, p));
      d.zaps?.forEach((z) => this.zaps.set(z.id, z));
    } catch (e) { console.warn('Historial corrupto, lo ignoro', e); }
  }
}
