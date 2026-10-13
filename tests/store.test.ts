import { describe, expect, it } from 'vitest';
import { ZapStore } from '../src/nostr/store';

const filled = () => {
  const s = new ZapStore();
  s.addPost({ id: 'a', pubkey: 'p', content: 'A', created_at: 1 });
  s.addPost({ id: 'b', pubkey: 'p', content: 'B', created_at: 2 });
  s.addPost({ id: 'c', pubkey: 'p', content: 'C', created_at: 3 });
  s.addZap({ id: '1', postId: 'a', msats: 1000, comment: '', created_at: 10 });
  s.addZap({ id: '1', postId: 'a', msats: 1000, comment: '', created_at: 10 });
  s.addZap({ id: '2', postId: 'b', msats: 5000, comment: '', created_at: 20 });
  s.addZap({ id: '3', postId: 'a', msats: 500, comment: '', created_at: 30 });
  s.addZap({ id: '4', postId: 'huerfano', msats: 700, comment: '', created_at: 40 });
  return s;
};

describe('ZapStore agregación', () => {
  it('suma sats por post, deduplica y ordena (sats, luego post más nuevo)', () => {
    const st = filled().stats();
    expect(st.map((x) => [x.postId, x.msats])).toEqual([['b', 5000], ['a', 1500], ['huerfano', 700], ['c', 0]]);
    expect(st[1].zaps.map((z) => z.id)).toEqual(['3', '1']);
    expect(st[2].post).toBeUndefined();
  });
  it('deduplica posts', () => {
    const s = filled();
    s.addPost({ id: 'a', pubkey: 'p', content: 'otro', created_at: 9 });
    expect(s.posts.get('a')!.content).toBe('A');
  });
  it('top N ignora posts sin zaps, zaps sin post y filtra por since', () => {
    const s = filled();
    expect(s.top(2).map((x) => x.postId)).toEqual(['b', 'a']);
    expect(s.top(10).map((x) => x.postId)).toEqual(['b', 'a']);
    expect(s.top(10, 25).map((x) => [x.postId, x.msats])).toEqual([['a', 500]]);
  });
  it('últimos zaps y posts', () => {
    const s = filled();
    expect(s.latestZaps(2).map((z) => z.id)).toEqual(['4', '3']);
    expect(s.latestPosts(2).map((p) => p.id)).toEqual(['c', 'b']);
  });
});
