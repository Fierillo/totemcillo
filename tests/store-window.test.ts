import { describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { postCutoff, defaultConfig } from '../src/config';

const NOW = 1_000_000;
const CUT = NOW - 3600;
const post = (id: string, created_at: number) => ({ id, pubkey: 'p', content: id, created_at });
const mem = (data: unknown) => { const m = new Map([['totemcillo:v1', JSON.stringify(data)]]); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe('corte fijo de posts', () => {
  it('postCutoff = startLine (ISO con offset) en unix s, independiente del reloj', () => {
    expect(postCutoff({ ...defaultConfig, startLine: '2026-10-13T21:00:00-03:00' })).toBe(Date.UTC(2026, 9, 14, 0, 0, 0) / 1000);
    expect(postCutoff({ ...defaultConfig, startLine: '' })).toBeUndefined();
    expect(postCutoff({ ...defaultConfig, startLine: 'basura' })).toBeUndefined();
  });
  it('rechaza posts anteriores al corte al llegar', () => {
    const s = new ZapStore(undefined, { cutoff: CUT });
    s.addPost(post('viejo', CUT - 1));
    s.addPost(post('justo', CUT));
    expect([...s.posts.keys()]).toEqual(['justo']);
  });
  it('el corte no se mueve con el tiempo: posts aceptados quedan aunque pasen horas', () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW * 1000);
    const s = new ZapStore(undefined, { cutoff: CUT });
    s.addPost(post('a', CUT + 1));
    s.addZap({ id: 'z', postId: 'a', msats: 1000, comment: '', created_at: CUT + 2 });
    vi.setSystemTime((NOW + 10 * 86400) * 1000);
    vi.advanceTimersByTime(10 * 86400 * 1000);
    s.addPost(post('b', CUT + 5));
    expect([...s.posts.keys()].sort()).toEqual(['a', 'b']);
    expect(s.zaps.has('z')).toBe(true);
    vi.useRealTimers();
  });
  it('no expone poda periódica por edad', () => {
    const s: any = new ZapStore(undefined, { cutoff: CUT });
    expect(s.prune).toBeUndefined();
    expect(s.startPruning).toBeUndefined();
  });
  it('el historial de localStorage respeta el corte fijo (y descarta zaps huérfanos)', () => {
    const s = new ZapStore(mem({
      posts: [post('viejo', CUT - 10), post('nuevo', CUT + 10)],
      zaps: [{ id: 'zv', postId: 'viejo', msats: 1000, comment: '', created_at: CUT }, { id: 'zn', postId: 'nuevo', msats: 1000, comment: '', created_at: CUT + 20 }],
    }), { cutoff: CUT });
    expect([...s.posts.keys()]).toEqual(['nuevo']);
    expect([...s.zaps.keys()]).toEqual(['zn']);
  });
  it('sin corte no hay límite', () => {
    const s = new ZapStore();
    s.addPost(post('antiguo', 1));
    expect(s.posts.has('antiguo')).toBe(true);
  });
});
