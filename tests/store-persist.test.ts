import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';

const mem = () => {
  const m = new Map<string, string>();
  return { m, getItem: vi.fn((k: string) => m.get(k) ?? null), setItem: vi.fn((k: string, v: string) => void m.set(k, v)) };
};
const post = { id: 'a', pubkey: 'p', content: 'A', created_at: 1 };
const zap = { id: '1', postId: 'a', msats: 1000, comment: '', created_at: 10 };

afterEach(() => vi.useRealTimers());

describe('ZapStore persistencia y eventos', () => {
  it('save y recarga desde storage', () => {
    const st = mem();
    const s = new ZapStore(st);
    s.addPost(post);
    s.addZap(zap);
    s.save();
    expect(new ZapStore(st).stats()[0].msats).toBe(1000);
  });
  it('guarda automáticamente con debounce de 1s', () => {
    vi.useFakeTimers();
    const st = mem();
    const s = new ZapStore(st);
    s.addPost(post);
    s.addZap(zap);
    expect(st.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(st.setItem).toHaveBeenCalledTimes(1);
  });
  it('ignora historial corrupto', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const st = mem();
    st.m.set('totemcillo:v1', '{roto');
    expect(new ZapStore(st).posts.size).toBe(0);
  });
  it('notifica cambios sólo con datos nuevos y permite desuscribirse', () => {
    const s = new ZapStore();
    const fn = vi.fn();
    const off = s.onChange(fn);
    s.addPost(post);
    s.addPost(post);
    s.addZap(zap);
    expect(fn).toHaveBeenCalledTimes(2);
    off();
    s.addZap({ ...zap, id: '2' });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});
