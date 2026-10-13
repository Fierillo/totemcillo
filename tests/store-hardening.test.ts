import { describe, expect, it, vi } from 'vitest';
import * as storeMod from '../src/nostr/store';
import { ZapStore } from '../src/nostr/store';

const KEY = 'totemcillo:v1';
const mem = (data?: unknown) => {
  const m = new Map<string, string>();
  if (data !== undefined) m.set(KEY, typeof data === 'string' ? data : JSON.stringify(data));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const post = { id: 'a', pubkey: 'p', content: 'A', created_at: 1 };
const zap = { id: '1', postId: 'a', msats: 1000, comment: '', created_at: 10 };

describe('historial envenenado', () => {
  it('descarta entradas con forma inválida', () => {
    const s = new ZapStore(mem({
      posts: [post, { id: 'x' }, { ...post, id: 'y', content: 5 }, null, { ...post, id: 'z'.repeat(65) }, { ...post, id: 'w', created_at: 'hoy' }],
      zaps: [zap, { ...zap, id: '2', msats: '1000' }, { ...zap, id: '3', msats: -5 }, { ...zap, id: '4', sender: {} }, { ...zap, id: '5', comment: null }],
    }));
    expect([...s.posts.keys()]).toEqual(['a']);
    expect([...s.zaps.keys()]).toEqual(['1']);
  });
  it('tolera estructuras que no son arrays', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const d of [{ posts: 'nope', zaps: { a: 1 } }, 'null', '42']) {
      const s = new ZapStore(mem(d));
      expect(s.posts.size + s.zaps.size).toBe(0);
    }
  });
});

describe('límites de memoria', () => {
  it('limita posts y zaps descartando los más viejos', () => {
    const s = new ZapStore(undefined, { maxPosts: 2, maxZaps: 2 });
    s.addPost({ ...post, id: 'p1', created_at: 1 });
    s.addPost({ ...post, id: 'p2', created_at: 3 });
    s.addPost({ ...post, id: 'p3', created_at: 2 });
    expect([...s.posts.keys()].sort()).toEqual(['p2', 'p3']);
    const fn = vi.fn();
    s.onChange(fn);
    s.addPost({ ...post, id: 'p0', created_at: 0 });
    expect(s.posts.has('p0')).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    for (const i of [1, 2, 3]) s.addZap({ ...zap, id: `z${i}`, created_at: i });
    expect([...s.zaps.keys()].sort()).toEqual(['z2', 'z3']);
  });
  it('aplica los límites al cargar el historial', () => {
    const s = new ZapStore(mem({ posts: [1, 2, 3].map((i) => ({ ...post, id: `p${i}`, created_at: i })), zaps: [] }), { maxPosts: 1 });
    expect([...s.posts.keys()]).toEqual(['p3']);
  });
  it('tiene límites por defecto', () => {
    const s = new ZapStore();
    for (let i = 0; i < 600; i++) s.addPost({ ...post, id: `p${i}`, created_at: i });
    expect(s.posts.size).toBe(500);
  });
});

describe('contenido enorme', () => {
  it('trunca contenido de posts y comentarios de zaps, también al cargar', () => {
    const { MAX_CONTENT, MAX_COMMENT } = storeMod;
    expect(MAX_CONTENT).toBeGreaterThan(0);
    const s = new ZapStore();
    s.addPost({ ...post, content: 'x'.repeat(100_000) });
    s.addZap({ ...zap, comment: 'y'.repeat(100_000) });
    expect(s.posts.get('a')!.content).toHaveLength(MAX_CONTENT + 1);
    expect(s.posts.get('a')!.content.endsWith('…')).toBe(true);
    expect(s.zaps.get('1')!.comment).toHaveLength(MAX_COMMENT + 1);
    const l = new ZapStore(mem({ posts: [{ ...post, content: 'x'.repeat(100_000) }], zaps: [{ ...zap, comment: 'y'.repeat(100_000) }] }));
    expect(l.posts.get('a')!.content).toHaveLength(MAX_CONTENT + 1);
    expect(l.zaps.get('1')!.comment).toHaveLength(MAX_COMMENT + 1);
  });
});
