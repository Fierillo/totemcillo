import type { Post, Zap } from './types';

export interface PostStats { post?: Post; postId: string; msats: number; zaps: Zap[] }

export class ZapStore {
  posts = new Map<string, Post>();
  zaps = new Map<string, Zap>();

  addPost(p: Post) {
    if (!this.posts.has(p.id)) this.posts.set(p.id, p);
  }

  addZap(z: Zap) {
    if (!this.zaps.has(z.id)) this.zaps.set(z.id, z);
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
