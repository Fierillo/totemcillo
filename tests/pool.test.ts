import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPool, followCutoff, NOSTR_LIMITS, READY_FALLBACK_MS, RELAY_CONNECT_TIMEOUT_MS, notesFilter, profileLoader, startNostr, zapsFilter } from '../src/nostr/pool';
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
  it('permite conectar relays lentos', () => {
    expect(RELAY_CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect((createPool() as any).maxWaitForConnection).toBe(RELAY_CONNECT_TIMEOUT_MS);
  });
  it('notas por hashtag y zaps por ids', () => {
    expect(notesFilter(['lacrypta'])).toEqual({ kinds: [1], '#t': ['lacrypta', 'Lacrypta', 'LACRYPTA'] });
    expect(zapsFilter(['a'])).toEqual({ kinds: [9735], '#e': ['a'] });
  });
  it('incluye minúscula, original, Capitalizada y MAYÚSCULA sin duplicados', () => {
    expect(notesFilter(['LaCrypta', 'labitconf'])['#t']).toEqual(['lacrypta', 'LaCrypta', 'Lacrypta', 'LACRYPTA', 'labitconf', 'Labitconf', 'LABITCONF']);
  });
});

describe('followCutoff', () => {
  it('reinicia solo al mover el inicio antes de lo cargado y conserva las conexiones', () => {
    const handles: { close: ReturnType<typeof vi.fn> }[] = [];
    const start = vi.fn((_cutoff?: number) => { const h = { close: vi.fn() }; handles.push(h); return h; });
    const f = followCutoff(start, 100);
    expect(start).toHaveBeenLastCalledWith(100);
    f.setCutoff(200);
    expect(start).toHaveBeenCalledTimes(1);
    f.setCutoff(50);
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith(50);
    expect(handles[0].close).toHaveBeenCalledWith(true);
    f.setCutoff(70);
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe('startNostr', () => {
  it('marca el store como listo recién cuando todos los relays terminaron notas y zaps (EOSE)', () => {
    const p = mockPool(), store = new ZapStore();
    const h = startNostr(cfg, store, p, 1500, resolverFor(null));
    try {
      expect(store.ready).toBe(false);
      p.subs[0].h.onevent(note('post'));
      vi.advanceTimersByTime(1500); // abre la suscripción de zaps
      p.subs[1].h.oneose();
      expect(store.ready).toBe(false); // faltan notas de algún relay
      p.subs[0].h.oneose();
      expect(store.ready).toBe(true);
    } finally { h.close(); }
  });
  it('sin posts alcanza con el EOSE de las notas', () => {
    const p = mockPool(), store = new ZapStore();
    const h = startNostr(cfg, store, p, 1500, resolverFor(null));
    try {
      p.subs[0].h.oneose();
      expect(store.ready).toBe(true);
    } finally { h.close(); }
  });
  it('un post nuevo antes del EOSE exige el EOSE de la nueva suscripción de zaps, no el de la vieja', () => {
    const p = mockPool(), store = new ZapStore();
    const h = startNostr(cfg, store, p, 1500, resolverFor(null));
    try {
      p.subs[0].h.onevent(note('1'));
      vi.advanceTimersByTime(1500);
      p.subs[0].h.onevent(note('2'));
      p.subs[0].h.oneose();
      expect(store.ready).toBe(false); // el post 2 todavía no tiene sus zaps pedidos
      vi.advanceTimersByTime(1500);
      p.subs[1].h.oneose(); // nostr-tools dispara oneose al cerrar la suscripción vieja
      expect(store.ready).toBe(false);
      p.subs[2].h.oneose();
      expect(store.ready).toBe(true);
    } finally { h.close(); }
  });
  it('espera a que se validen los zaps recibidos antes de marcar listo', async () => {
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'p1', pubkey: 'pk', content: 'x', created_at: 1 });
    const z = makeZap({ postId: 'p1' });
    let finish!: (pk: string | null) => void;
    const resolver = { resolve: vi.fn(() => new Promise<string | null>((done) => { finish = done; })) };
    const h = startNostr(cfg, store, p, 1500, resolver);
    try {
      vi.advanceTimersByTime(1500);
      p.subs[1].h.onevent(z.receipt);
      p.subs[0].h.oneose(); p.subs[1].h.oneose();
      expect(store.ready).toBe(false);
      finish(z.server.pk);
      await flush();
      expect(store.zaps.size).toBe(1);
      expect(store.ready).toBe(true);
    } finally { h.close(); }
  });
  it('el respaldo supera el peor caso de conexión + EOSE de notas y luego de zaps', () => {
    expect(READY_FALLBACK_MS).toBeGreaterThan(2 * (RELAY_CONNECT_TIMEOUT_MS + 4400));
  });
  it('da por terminado el backfill tras el tiempo de reserva si ningún relay responde EOSE', () => {
    const p = mockPool(), store = new ZapStore();
    const h = startNostr(cfg, store, p, 1500, resolverFor(null));
    try {
      vi.advanceTimersByTime(READY_FALLBACK_MS - 1);
      expect(store.ready).toBe(false);
      vi.advanceTimersByTime(1);
      expect(store.ready).toBe(true);
    } finally { h.close(); }
  });
  it('al cerrar cancela el respaldo del backfill', () => {
    const p = mockPool(), store = new ZapStore();
    const h = startNostr(cfg, store, p, 1500, resolverFor(null));
    h.close();
    vi.advanceTimersByTime(READY_FALLBACK_MS + 1);
    expect(store.ready).toBe(false);
  });
  it('una ráfaga firmada de un autor baneado no expulsa el post legítimo del historial ni del filtro de zaps', () => {
    const p = mockPool(), store = new ZapStore();
    const good = keys();
    const legitimate = sign(good.sk, { kind: 1, created_at: 1, content: 'legítimo', tags: [['t', 'lacrypta']] });
    store.setModeration({ hiddenPosts: [], bannedPubkeys: [author.pk] });
    const feed = startNostr(cfg, store, p, 1500, resolverFor(null));
    try {
      p.subs[0].h.onevent(legitimate);
      for (let i = 0; i < 510; i++) {
        if (i % 50 === 0) vi.advanceTimersByTime(1000);
        p.subs[0].h.onevent(note(`spam ${i}`));
      }
      expect(store.latestPosts(10).map((post) => post.id)).toEqual([legitimate.id]);
      expect(store.posts.size).toBe(500);
      vi.advanceTimersByTime(1500);
      const active = p.subs.filter((s) => s.filter.kinds[0] === 9735 && !s.close.mock.calls.length);
      expect(active).toHaveLength(1);
      expect(active[0].filter['#e']).toContain(legitimate.id);
    } finally { feed.close(); }
  });
  it('usa los proveedores del store antes de consultar LNURL con el resolver real', async () => {
    const z = makeZap({ postId: 'p1' });
    const profile = sign(z.recipient.sk, { kind: 0, created_at: 1, tags: [], content: JSON.stringify({ lud16: 'a@getalby.com' }) });
    const p = mockPool([profile]), store = new ZapStore(undefined, { zapProviders: [] });
    store.addPost({ id: 'p1', pubkey: z.recipient.pk, content: 'post', created_at: 1 });
    const fetcher = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, json: async () => ({ allowsNostr: true, nostrPubkey: z.server.pk }) } as Response);
    const feed = startNostr(cfg, store, p);
    try {
      vi.advanceTimersByTime(1500);
      p.subs[1].h.onevent(z.receipt);
      await flush();
      expect(fetcher).not.toHaveBeenCalled();
      expect(store.zaps.size).toBe(0);
      store.setModeration({ hiddenPosts: [], bannedPubkeys: [], zapProviders: ['getalby.com'] });
      p.subs[1].h.onevent(z.receipt);
      await flush();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.zaps.has(z.receipt.id)).toBe(true);
      store.setModeration({ hiddenPosts: [], bannedPubkeys: [], zapProviders: [] });
      p.subs[1].h.onevent(sign(z.server.sk, { ...z.receipt, created_at: 101 }));
      await flush();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.zaps.size).toBe(1);
    } finally { feed.close(); fetcher.mockRestore(); }
  });
  it('descarta el exceso de receipts sin superar el límite de cola ni el de concurrencia', async () => {
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'p1', pubkey: 'pk', content: 'x', created_at: 1 });
    const z = makeZap({ postId: 'p1' });
    const finish: ((pk: string | null) => void)[] = [];
    const resolver = { resolve: vi.fn(() => new Promise<string | null>((done) => finish.push(done))) };
    startNostr(cfg, store, p, 1500, resolver);
    vi.advanceTimersByTime(1500);
    const capacity = NOSTR_LIMITS.concurrentZaps + NOSTR_LIMITS.queuedZaps;
    for (let i = 0; i < capacity + 10; i++) {
      if (i % 50 === 0) vi.advanceTimersByTime(1000);
      p.subs[1].h.onevent(sign(z.server.sk, { ...z.receipt, created_at: 100 + i }));
    }
    expect(resolver.resolve).toHaveBeenCalledTimes(NOSTR_LIMITS.concurrentZaps);
    for (let i = 0; i < finish.length; i += NOSTR_LIMITS.concurrentZaps) {
      finish.slice(i, i + NOSTR_LIMITS.concurrentZaps).forEach((done) => done(z.server.pk));
      await flush();
    }
    expect(resolver.resolve).toHaveBeenCalledTimes(capacity);
    expect(store.zaps.size).toBe(capacity);
  });
  it('no suscribe zaps de posts que el store descarta', () => {
    const p = mockPool(), store = new ZapStore(undefined, { cutoff: 100 });
    startNostr(cfg, store, p, 1500, resolverFor(null));
    p.subs[0].h.onevent(note('anterior al corte del store'));
    vi.advanceTimersByTime(1500);
    expect(store.posts.size).toBe(0);
    expect(p.subs).toHaveLength(1);
  });
  it('al cerrar ignora callbacks tardíos y resultados LNURL pendientes', async () => {
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'p1', pubkey: 'pk', content: 'x', created_at: 1 });
    const z = makeZap({ postId: 'p1' });
    let finish!: (pk: string | null) => void;
    const resolver = { resolve: vi.fn(() => new Promise<string | null>((done) => { finish = done; })) };
    const h = startNostr(cfg, store, p, 1500, resolver);
    vi.advanceTimersByTime(1500);
    p.subs[1].h.onevent(z.receipt);
    h.close(true);
    p.subs[0].h.onevent(note('tardío'));
    finish(z.server.pk);
    await flush();
    expect([...store.posts.keys()]).toEqual(['p1']);
    expect(store.zaps.size).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(p.subs).toHaveLength(2);
  });
  it('deduplica receipts y procesa una ráfaga con cuatro consultas LNURL simultáneas', async () => {
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'p1', pubkey: 'pk', content: 'x', created_at: 1 });
    const z = makeZap({ postId: 'p1' });
    const finish: ((pk: string | null) => void)[] = [];
    const resolver = { resolve: vi.fn(() => new Promise<string | null>((done) => finish.push(done))) };
    startNostr(cfg, store, p, 1500, resolver);
    vi.advanceTimersByTime(1500);
    const events = Array.from({ length: 10 }, (_, i) => sign(z.server.sk, { ...z.receipt, created_at: 100 + i }));
    for (let i = 0; i < 10; i++) p.subs[1].h.onevent(events[0]);
    for (const event of events.slice(1)) p.subs[1].h.onevent(event);
    expect(resolver.resolve).toHaveBeenCalledTimes(4);
    finish.forEach((done) => done(z.server.pk));
    await flush();
    expect(store.zaps.size).toBe(4);
    expect(resolver.resolve).toHaveBeenCalledTimes(8);
    finish.slice(4).forEach((done) => done(z.server.pk));
    await flush();
    expect(store.zaps.size).toBe(8);
    expect(resolver.resolve).toHaveBeenCalledTimes(10);
    finish.slice(8).forEach((done) => done(z.server.pk));
    await flush();
    expect(store.zaps.size).toBe(10);
    p.subs[1].h.onevent(events[0]); // already stored: no more work
    expect(resolver.resolve).toHaveBeenCalledTimes(10);
  });
  it('no resuelve LNURL de receipts ajenos al filtro, futuros o sobredimensionados', async () => {
    vi.setSystemTime(1_000_000);
    const p = mockPool(), store = new ZapStore();
    store.addPost({ id: 'p1', pubkey: 'pk', content: 'x', created_at: 1 });
    const valid = makeZap({ postId: 'p1' }), foreign = makeZap({ postId: 'otro' });
    const resolver = resolverFor(valid.server.pk);
    startNostr(cfg, store, p, 1500, resolver);
    vi.advanceTimersByTime(1500);
    const resign = (fields: object) => sign(valid.server.sk, { ...valid.receipt, ...fields });
    for (const event of [foreign.receipt, resign({ created_at: 9999999999 }), resign({ content: 'x'.repeat(20_000) })]) p.subs[1].h.onevent(event);
    await flush();
    expect(resolver.resolve).not.toHaveBeenCalled();
    expect(store.zaps.size).toBe(0);
    p.subs[1].h.onevent(valid.receipt);
    await flush();
    expect([...store.zaps.keys()]).toEqual([valid.receipt.id]);
  });
  it('acota la admisión durante una ráfaga y vuelve a admitir al segundo siguiente', () => {
    const p = mockPool(), store = new ZapStore();
    startNostr(cfg, store, p, 1500, resolverFor(null));
    for (let i = 0; i < 110; i++) p.subs[0].h.onevent(note(`ráfaga ${i}`));
    expect(store.posts.size).toBe(100);
    vi.advanceTimersByTime(1000);
    const next = note('después de la ráfaga');
    p.subs[0].h.onevent(next);
    expect(store.posts.has(next.id)).toBe(true);
    expect(store.posts.size).toBe(101);
  });
  it('rechaza eventos sobredimensionados antes de guardarlos o suscribirse a sus zaps', () => {
    const p = mockPool(), store = new ZapStore();
    startNostr(cfg, store, p, 1500, resolverFor(null));
    for (const fields of [
      { content: 'x'.repeat(20_000), tags: [['t', 'lacrypta']] },
      { content: 'tags', tags: [['t', 'lacrypta'], ...Array.from({ length: 128 }, () => ['x', 'v'])] },
      { content: 'tag largo', tags: [['t', 'lacrypta'], ['x', 'x'.repeat(3000)]] },
    ]) p.subs[0].h.onevent(sign(author.sk, { kind: 1, created_at: 5, ...fields }));
    expect(store.posts.size).toBe(0);
    vi.advanceTimersByTime(1500);
    expect(p.subs).toHaveLength(1);
  });
  it('mantiene una sola suscripción de zaps limitada a los posts retenidos', () => {
    const p = mockPool(), store = new ZapStore(undefined, { maxPosts: 2 });
    startNostr(cfg, store, p, 1500, resolverFor(null));
    for (let i = 0; i < 5; i++) {
      p.subs[0].h.onevent(note(`post ${i}`));
      vi.advanceTimersByTime(1500);
    }
    const active = p.subs.filter((s) => s.filter.kinds[0] === 9735 && !s.close.mock.calls.length);
    expect(active).toHaveLength(1);
    expect(new Set(active[0].filter['#e'])).toEqual(new Set(store.posts.keys()));
    expect(active[0].filter['#e']).toHaveLength(2);
  });
  it('rechaza fechas futuras y anteriores al corte, pero acepta historial y un pequeño desfase de reloj', () => {
    vi.setSystemTime(1_000_000);
    const p = mockPool(), store = new ZapStore();
    startNostr(cfg, store, p, 1500, resolverFor(null), 500);
    const event = (created_at: number) => sign(author.sk, { kind: 1, created_at, content: 'fecha', tags: [['t', 'lacrypta']] });
    for (const time of [499, 1121, 9_999_999_999]) p.subs[0].h.onevent(event(time));
    expect(store.posts.size).toBe(0);
    for (const time of [500, 1000, 1120]) p.subs[0].h.onevent(event(time));
    expect([...store.posts.values()].map((p) => p.created_at)).toEqual([500, 1000, 1120]);
  });
  it('rechaza posts firmados fuera de los hashtags pedidos aunque el relay los entregue', () => {
    const p = mockPool(), store = new ZapStore();
    startNostr(cfg, store, p, 1500, resolverFor(null));
    for (const tags of [[], [['t', 'otro']], [['t', 'lacrypta-falso']]]) {
      p.subs[0].h.onevent(sign(author.sk, { kind: 1, created_at: 5, content: 'ajeno', tags }));
    }
    expect(store.posts.size).toBe(0);
    const valid = note('válido');
    p.subs[0].h.onevent(valid);
    expect([...store.posts.keys()]).toEqual([valid.id]);
  });
  it('suscribe notas en los relays y las agrega al store', () => {
    const p = mockPool(), store = new ZapStore();
    startNostr(cfg, store, p, 1500, resolverFor(null));
    expect(p.subscribeMany).toHaveBeenCalledWith(cfg.relays, expect.objectContaining(notesFilter(cfg.hashtags)), expect.anything());
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
    expect(p.subs[1].close).toHaveBeenCalledOnce();
    expect(p.subs[2].filter['#e']).toEqual(['old', n1.id, n2.id, n3.id]);
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

describe('ventana de tiempo en la suscripción', () => {
  it('el filtro de notas usa el corte fijo recibido', () => {
    const p = mockPool();
    startNostr(cfg, new ZapStore(), p, 1500, resolverFor(null), 123_456);
    expect(p.subs[0].filter).toEqual({ ...notesFilter(cfg.hashtags), since: 123_456 });
  });
  it('sin corte explícito no agrega since', () => {
    const p = mockPool();
    startNostr(cfg, new ZapStore(), p, 1500, resolverFor(null));
    expect(p.subs[0].filter).toEqual(notesFilter(cfg.hashtags));
  });
  it('notesFilter sin since no lo agrega', () => {
    expect(notesFilter(['a'])).not.toHaveProperty('since');
    expect(notesFilter(['a'], 5)).toHaveProperty('since', 5);
  });
});
