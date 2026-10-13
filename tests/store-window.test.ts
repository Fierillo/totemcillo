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

describe('poda de posts vencidos', () => {
  const setup = () => {
    const clock = { now: NOW };
    const s = new ZapStore(undefined, { maxAgeSec: 3600, now: () => clock.now });
    s.addPost(post('a', NOW - 100));
    s.addPost(post('b', NOW - 3000));
    s.addZap({ id: 'z', postId: 'b', msats: 5000, comment: '', created_at: NOW - 2000 });
    return { s, clock };
  };
  it('prune quita posts vencidos junto con sus zaps y notifica', () => {
    const { s, clock } = setup();
    s.addZap({ id: 'za', postId: 'a', msats: 1000, comment: '', created_at: NOW - 50 });
    const fn = vi.fn();
    s.onChange(fn);
    clock.now = NOW + 1000;
    expect(s.prune()).toBe(1);
    expect([...s.posts.keys()]).toEqual(['a']);
    expect([...s.zaps.keys()]).toEqual(['za']);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(s.prune()).toBe(0);
    expect(fn).toHaveBeenCalledTimes(1);
  });
  it('startPruning poda cada intervalo y se puede frenar', () => {
    vi.useFakeTimers();
    const { s, clock } = setup();
    const stop = s.startPruning(60_000);
    clock.now = NOW + 1000;
    vi.advanceTimersByTime(59_999);
    expect(s.posts.has('b')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(s.posts.has('b')).toBe(false);
    stop();
    clock.now = NOW + 10_000;
    vi.advanceTimersByTime(120_000);
    expect(s.posts.has('a')).toBe(true);
  });
});

describe('zaps de posts vencidos al cargar', () => {
  it('con ventana, descarta zaps cuyo post no quedó cargado', () => {
    const s = new ZapStore(mem({
      posts: [post('viejo', NOW - 5000), post('nuevo', NOW - 10)],
      zaps: [{ id: 'zv', postId: 'viejo', msats: 1000, comment: '', created_at: NOW - 4000 }, { id: 'zn', postId: 'nuevo', msats: 1000, comment: '', created_at: NOW - 5 }],
    }), { maxAgeSec: 3600, now: () => NOW });
    expect([...s.zaps.keys()]).toEqual(['zn']);
  });
});
