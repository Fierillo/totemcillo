import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notesFilter, startNostr, zapsFilter } from '../src/nostr/pool';
import { ZapStore } from '../src/nostr/store';
import { defaultConfig } from '../src/config';

const mockPool = () => {
  const subs: any[] = [];
  return {
    subs,
    subscribeMany: vi.fn((relays: string[], filter: any, h: any) => { const s = { relays, filter, h, close: vi.fn() }; subs.push(s); return s; }),
    close: vi.fn(),
  };
};
const cfg = { ...defaultConfig, hashtags: ['LaCrypta', 'labitconf'] };
const note = (id: string) => ({ id, pubkey: 'pk', content: `nota ${id}`, created_at: 5, kind: 1, tags: [] });
const receipt = (id: string, e: string) => ({
  id, kind: 9735, pubkey: 'x', created_at: 9, content: '',
  tags: [['e', e], ['description', JSON.stringify({ pubkey: 's', content: '', tags: [['amount', '5000']] })]],
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('filtros', () => {
  it('notas por hashtag en minúscula y zaps por ids', () => {
    expect(notesFilter(['LaCrypta'])).toEqual({ kinds: [1], '#t': ['lacrypta'] });
    expect(zapsFilter(['a'])).toEqual({ kinds: [9735], '#e': ['a'] });
  });
});

describe('startNostr', () => {
  it('suscribe notas en los relays y las agrega al store', () => {
    const p = mockPool(), store = new ZapStore();
    startNostr(cfg, store, p);
    expect(p.subscribeMany).toHaveBeenCalledWith(cfg.relays, { kinds: [1], '#t': ['lacrypta', 'labitconf'] }, expect.anything());
    p.subs[0].h.onevent(note('n1'));
    expect(store.posts.get('n1')?.content).toBe('nota n1');
  });
  it('agrupa ids (historial + nuevos, sin repetir) en batches y procesa receipts', () => {
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'old', pubkey: 'pk', content: 'vieja', created_at: 1 });
    startNostr(cfg, store, p, 1500);
    p.subs[0].h.onevent(note('n1'));
    p.subs[0].h.onevent(note('n2'));
    p.subs[0].h.onevent(note('n1'));
    vi.advanceTimersByTime(1499);
    expect(p.subs).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(p.subs).toHaveLength(2);
    expect(p.subs[1].filter).toEqual({ kinds: [9735], '#e': ['old', 'n1', 'n2'] });
    p.subs[1].h.onevent(receipt('r1', 'n1'));
    p.subs[1].h.onevent({ ...receipt('r2', 'n1'), tags: [] });
    expect([...store.zaps.keys()]).toEqual(['r1']);
    p.subs[0].h.onevent(note('n3'));
    vi.advanceTimersByTime(1500);
    expect(p.subs[2].filter['#e']).toEqual(['n3']);
  });
  it('close cierra suscripciones y pool', () => {
    const p = mockPool(), store = new ZapStore();
    const h = startNostr(cfg, store, p);
    p.subs[0].h.onevent(note('n1'));
    vi.advanceTimersByTime(1500);
    h.close();
    p.subs.forEach((s) => expect(s.close).toHaveBeenCalled());
    expect(p.close).toHaveBeenCalledWith(cfg.relays);
  });
});
