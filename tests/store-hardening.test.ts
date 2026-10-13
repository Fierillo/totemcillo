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
