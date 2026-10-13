import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { notesFilter, profileLoader, startNostr, zapsFilter } from '../src/nostr/pool';
import { ZapStore } from '../src/nostr/store';
import { defaultConfig } from '../src/config';
import { keys, makeZap, sign } from './helpers';

const mockPool = (profiles: any[] = []) => {
  const subs: any[] = [];
  return {
    subs,
    subscribeMany: vi.fn((relays: string[], filter: any, h: any) => { const s = { relays, filter, h, close: vi.fn() }; subs.push(s); return s; }),
    querySync: vi.fn(async (_r: string[], _f: any, _o?: any) => profiles),
    close: vi.fn(),
  };
};
const cfg = { ...defaultConfig, hashtags: ['LaCrypta', 'labitconf'] };
const author = keys();
const note = (content: string, kind = 1) => sign(author.sk, { kind, created_at: 5, content, tags: [['t', 'lacrypta']] });
const resolverFor = (pk: string | null) => ({ resolve: vi.fn(async (_p: string) => pk) });
const flush = async () => { for (let i = 0; i < 50; i++) await Promise.resolve(); };

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('filtros', () => {
  it('notas por hashtag y zaps por ids', () => {
    expect(notesFilter(['lacrypta'])).toEqual({ kinds: [1], '#t': ['lacrypta', 'Lacrypta', 'LACRYPTA'] });
    expect(zapsFilter(['a'])).toEqual({ kinds: [9735], '#e': ['a'] });
  });
  it('incluye minúscula, original, Capitalizada y MAYÚSCULA sin duplicados', () => {
    expect(notesFilter(['LaCrypta', 'labitconf'])['#t']).toEqual(['lacrypta', 'LaCrypta', 'Lacrypta', 'LACRYPTA', 'labitconf', 'Labitconf', 'LABITCONF']);
  });
});

describe('startNostr', () => {
  it('suscribe notas en los relays y las agrega al store', () => {
    const p = mockPool(), store = new ZapStore();
    startNostr(cfg, store, p, 1500, resolverFor(null));
    expect(p.subscribeMany).toHaveBeenCalledWith(cfg.relays, notesFilter(cfg.hashtags), expect.anything());
    const n = note('hola');
    p.subs[0].h.onevent(n);
    expect(store.posts.get(n.id)?.content).toBe('hola');
  });
  it('agrupa ids (historial + nuevos, sin repetir) en batches', () => {
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'old', pubkey: 'pk', content: 'vieja', created_at: 1 });
    startNostr(cfg, store, p, 1500, resolverFor(null));
    const n1 = note('1'), n2 = note('2');
    p.subs[0].h.onevent(n1);
    p.subs[0].h.onevent(n2);
    p.subs[0].h.onevent(n1);
    vi.advanceTimersByTime(1499);
    expect(p.subs).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(p.subs[1].filter).toEqual({ kinds: [9735], '#e': ['old', n1.id, n2.id] });
    const n3 = note('3');
    p.subs[0].h.onevent(n3);
    vi.advanceTimersByTime(1500);
    expect(p.subs[2].filter['#e']).toEqual([n3.id]);
  });
  it('cuenta sólo zaps válidos firmados por el nostrPubkey del LNURL', async () => {
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'p1', pubkey: 'pk', content: 'x', created_at: 1 });
    const z = makeZap({ postId: 'p1' }), bad = makeZap({ postId: 'p1' });
    const resolver = resolverFor(z.server.pk);
    startNostr(cfg, store, p, 1500, resolver);
    vi.advanceTimersByTime(1500);
    p.subs[1].h.onevent({ ...z.receipt, id: 'f'.repeat(64) });
    p.subs[1].h.onevent(bad.receipt);
    p.subs[1].h.onevent(z.receipt);
    await flush();
    expect([...store.zaps.keys()]).toEqual([z.receipt.id]);
    expect(resolver.resolve).toHaveBeenCalledWith(z.recipient.pk);
  });
  it('por defecto resuelve el LNURL con perfiles kind 0 del pool; sin perfil no cuenta', async () => {
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'p1', pubkey: 'pk', content: 'x', created_at: 1 });
    const z = makeZap({ postId: 'p1' });
    startNostr(cfg, store, p);
    vi.advanceTimersByTime(1500);
    p.subs[1].h.onevent(z.receipt);
    await flush();
    expect(p.querySync).toHaveBeenCalledWith(cfg.relays, { kinds: [0], authors: [z.recipient.pk] }, expect.anything());
    expect(store.zaps.size).toBe(0);
  });
  it('close cierra suscripciones y pool', () => {
    const p = mockPool(), store = new ZapStore();
    const h = startNostr(cfg, store, p, 1500, resolverFor(null));
    p.subs[0].h.onevent(note('1'));
    vi.advanceTimersByTime(1500);
    h.close();
    p.subs.forEach((s) => expect(s.close).toHaveBeenCalled());
    expect(p.close).toHaveBeenCalledWith(cfg.relays);
  });
});

describe('profileLoader', () => {
  it('devuelve el kind 0 firmado más nuevo del autor', async () => {
    const k = keys();
    const old = sign(k.sk, { kind: 0, created_at: 1, content: '{"lud16":"old@x.com"}', tags: [] });
    const nuevo = sign(k.sk, { kind: 0, created_at: 2, content: '{"lud16":"new@x.com"}', tags: [] });
    const forged = { ...sign(k.sk, { kind: 0, created_at: 3, content: '{}', tags: [] }), content: '{"lud16":"evil@x.com"}' };
    const ajeno = sign(keys().sk, { kind: 0, created_at: 9, content: '{}', tags: [] });
    expect(await profileLoader(mockPool([old, forged, nuevo, ajeno]), ['wss://r'])(k.pk)).toEqual(nuevo);
    expect(await profileLoader(mockPool([]), ['wss://r'])(k.pk)).toBeNull();
  });
});

describe('firmas de notas', () => {
  it('descarta notas con firma inválida o de otro kind', () => {
    const p = mockPool(), store = new ZapStore();
    startNostr(cfg, store, p, 1500, resolverFor(null));
    const n = note('original');
    p.subs[0].h.onevent({ ...n, content: 'falsificado' });
    p.subs[0].h.onevent(note('reacción', 7));
    expect(store.posts.size).toBe(0);
    p.subs[0].h.onevent(n);
    expect(store.posts.size).toBe(1);
  });
});
