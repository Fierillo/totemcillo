import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';

const NOW = 1_000_000;
const post = (id: string, created_at: number) => ({ id, pubkey: 'p', content: id, created_at });
const mem = (data: unknown) => { const m = new Map([['totemcillo:v1', JSON.stringify(data)]]); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
afterEach(() => vi.useRealTimers());

describe('ventana de posts', () => {
  it('rechaza posts más viejos que la ventana al llegar', () => {
    const s = new ZapStore(undefined, { maxAgeSec: 3600, now: () => NOW });
    s.addPost(post('viejo', NOW - 3601));
    s.addPost(post('justo', NOW - 3600));
    expect([...s.posts.keys()]).toEqual(['justo']);
  });
  it('filtra posts vencidos al cargar el historial', () => {
    const s = new ZapStore(mem({ posts: [post('viejo', NOW - 5000), post('nuevo', NOW - 10)], zaps: [] }), { maxAgeSec: 3600, now: () => NOW });
    expect([...s.posts.keys()]).toEqual(['nuevo']);
  });
  it('sin maxAgeSec no hay ventana', () => {
    const s = new ZapStore();
    s.addPost(post('antiguo', 1));
    expect(s.posts.has('antiguo')).toBe(true);
  });
});
