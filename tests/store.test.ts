import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZapStore, MAX_COMMENT, providerAllowed } from '../src/nostr/store';
import { graphemes } from '../src/text';
import { postCutoff } from '../src/config';
import { DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS } from '../shared/settings';
import { moderationOf } from '../src/moderation-lists';

const KEY = 'totemcillo:v1';
const mem = (data?: unknown) => {
  const m = new Map<string, string>();
  if (data !== undefined) m.set(KEY, typeof data === 'string' ? data : JSON.stringify(data));
  return { m, getItem: (k: string) => m.get(k) ?? null, setItem: vi.fn((k: string, v: string) => void m.set(k, v)) };
};
const post = { id: 'a', pubkey: 'p', content: 'A', created_at: 1 };
const zap = { id: '1', postId: 'a', msats: 1000, comment: '', created_at: 10 };

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

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

describe('persistencia y notificaciones', () => {
  it('recarga posts y zaps guardados', () => {
    const st = mem(), s = new ZapStore(st);
    s.addPost(post); s.addZap(zap); s.save();
    expect(new ZapStore(st).stats()[0].msats).toBe(1000);
  });
  it('agrupa escrituras con debounce de un segundo', () => {
    vi.useFakeTimers();
    const st = mem(), s = new ZapStore(st);
    s.addPost(post); s.addZap(zap);
    expect(st.setItem).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(st.setItem).toHaveBeenCalledTimes(1);
  });
  it('ignora JSON corrupto y estructuras que no son arrays', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    for (const data of ['{roto', 'null', '42', { posts: 'nope', zaps: { a: 1 } }]) {
      const s = new ZapStore(mem(data));
      expect(s.posts.size + s.zaps.size).toBe(0);
    }
  });
  it('descarta entradas con forma inválida', () => {
    const s = new ZapStore(mem({
      posts: [post, { id: 'x' }, { ...post, id: 'y', content: 5 }, null, { ...post, id: 'z'.repeat(65) }, { ...post, id: 'w', created_at: 'hoy' }],
      zaps: [zap, { ...zap, id: '2', msats: '1000' }, { ...zap, id: '3', msats: -5 }, { ...zap, id: '4', sender: {} }, { ...zap, id: '5', comment: null }],
    }));
    expect([...s.posts.keys()]).toEqual(['a']);
    expect([...s.zaps.keys()]).toEqual(['1']);
  });
  it('notifica solo datos nuevos y permite desuscribirse', () => {
    const s = new ZapStore(), fn = vi.fn(), off = s.onChange(fn);
    s.addPost(post); s.addPost(post); s.addZap(zap);
    expect(fn).toHaveBeenCalledTimes(2);
    off(); s.addZap({ ...zap, id: '2' });
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('límites de memoria y contenido', () => {
  it('prioriza posts visibles sobre los borrados y sigue descartando por antigüedad entre visibles', () => {
    const s = new ZapStore(undefined, { maxPosts: 2 });
    s.addPost({ ...post, id: 'legitimo', created_at: 1 });
    s.addPost({ ...post, id: 'borrado', created_at: 100 });
    s.setModeration({ hiddenPosts: ['borrado'], bannedPubkeys: [] });
    s.addPost({ ...post, id: 'nuevo', created_at: 101 });
    expect([...s.posts.keys()]).toEqual(['legitimo', 'nuevo']);
    s.addPost({ ...post, id: 'ultimo', created_at: 102 });
    expect([...s.posts.keys()]).toEqual(['nuevo', 'ultimo']);
  });
  it('con espacio conserva el post y sus zaps para deshacer un baneo', () => {
    const s = new ZapStore(undefined, { maxPosts: 3 });
    s.addPost({ ...post, id: 'legitimo' });
    s.setModeration({ hiddenPosts: [], bannedPubkeys: ['atacante'] });
    s.addPost({ ...post, id: 'baneado', pubkey: 'atacante', created_at: 2 });
    s.addZap({ ...zap, postId: 'baneado' });
    expect(s.latestPosts(10).map((p) => p.id)).toEqual(['legitimo']);
    expect(s.latestZaps(10)).toEqual([]);
    s.setModeration({ hiddenPosts: [], bannedPubkeys: [] });
    expect(s.latestPosts(10).map((p) => p.id)).toEqual(['baneado', 'legitimo']);
    expect(s.top(10).map((p) => p.postId)).toEqual(['baneado']);
  });
  it('descarta primero el post baneado ya retenido y sus zaps sin hacerlos reaparecer como huérfanos', () => {
    const s = new ZapStore(undefined, { maxPosts: 2 });
    s.addPost({ ...post, id: 'legitimo', created_at: 1 });
    s.addPost({ ...post, id: 'baneado', pubkey: 'atacante', created_at: 100 });
    s.addZap({ ...zap, postId: 'baneado' });
    s.setModeration({ hiddenPosts: [], bannedPubkeys: ['atacante'] });
    s.addPost({ ...post, id: 'nuevo', created_at: 101 });
    expect(s.latestPosts(10).map((p) => p.id)).toEqual(['nuevo', 'legitimo']);
    expect(s.latestZaps(10)).toEqual([]);
    expect(s.stats().map((p) => p.postId)).toEqual(['nuevo', 'legitimo']);
    expect(s.zaps.size).toBe(0);
  });
  it('una ráfaga de un autor baneado no desplaza posts visibles ni genera cambios descartados', () => {
    const s = new ZapStore(undefined, { maxPosts: 2 });
    s.addPost({ ...post, id: 'legitimo-1', created_at: 1 });
    s.addPost({ ...post, id: 'legitimo-2', created_at: 2 });
    s.setModeration({ hiddenPosts: [], bannedPubkeys: ['atacante'] });
    const changed = vi.fn(), live = vi.fn();
    s.onChange(changed); s.onLive(live);
    for (let i = 0; i < 10; i++) s.addPost({ ...post, id: `spam-${i}`, pubkey: 'atacante', created_at: 100 + i });
    expect(s.latestPosts(10).map((p) => p.id)).toEqual(['legitimo-2', 'legitimo-1']);
    expect(s.posts.size).toBe(2);
    expect(changed).not.toHaveBeenCalled();
    expect(live).not.toHaveBeenCalled();
  });
  it('descarta los posts y zaps más viejos, sin notificar inserciones descartadas', () => {
    const s = new ZapStore(undefined, { maxPosts: 2, maxZaps: 2 });
    for (const [id, created_at] of [['p1', 1], ['p2', 3], ['p3', 2]] as const) s.addPost({ ...post, id, created_at });
    expect([...s.posts.keys()].sort()).toEqual(['p2', 'p3']);
    const fn = vi.fn(); s.onChange(fn);
    s.addPost({ ...post, id: 'p0', created_at: 0 });
    expect(s.posts.has('p0')).toBe(false);
    expect(fn).not.toHaveBeenCalled();
    for (const i of [1, 2, 3]) s.addZap({ ...zap, id: `z${i}`, created_at: i });
    expect([...s.zaps.keys()].sort()).toEqual(['z2', 'z3']);
  });
  it('aplica límites al historial y tiene un máximo por defecto', () => {
    const s = new ZapStore(mem({ posts: [1, 2, 3].map((i) => ({ ...post, id: `p${i}`, created_at: i })), zaps: [] }), { maxPosts: 1 });
    expect([...s.posts.keys()]).toEqual(['p3']);
    const defaults = new ZapStore();
    for (let i = 0; i < 600; i++) defaults.addPost({ ...post, id: `p${i}`, created_at: i });
    expect(defaults.posts.size).toBe(500);
  });
  it('trunca posts por palabras y grafemas al ingresar y al cargar, con máximo configurable', () => {
    const big = 'palabra '.repeat(20_000), s = new ZapStore();
    s.addPost({ ...post, content: big });
    expect(graphemes(s.posts.get('a')!.content).length).toBeLessThanOrEqual(210);
    expect(s.posts.get('a')!.content).toMatch(/palabra…$/);
    expect(graphemes(new ZapStore(mem({ posts: [{ ...post, content: big }], zaps: [] })).posts.get('a')!.content).length).toBeLessThanOrEqual(210);
    const custom = new ZapStore(undefined, { postMaxChars: 50 });
    custom.addPost({ ...post, content: '😀'.repeat(100) });
    expect(custom.posts.get('a')!.content).toBe('😀'.repeat(49) + '…');
  });
  it('quita espacios y saltos de línea sobrantes al principio y al final, al ingresar y al cargar', () => {
    const s = new ZapStore();
    s.addPost({ ...post, content: '\n  Otro test #lacrypta \n\n' });
    expect(s.posts.get('a')!.content).toBe('Otro test #lacrypta');
    expect(new ZapStore(mem({ posts: [{ ...post, content: 'hola\nchau\n\n' }], zaps: [] })).posts.get('a')!.content).toBe('hola\nchau');
  });
  it('limita comentarios enormes de zaps', () => {
    const s = new ZapStore();
    s.addZap({ ...zap, comment: 'y'.repeat(100_000) });
    expect(s.zaps.get('1')!.comment).toHaveLength(MAX_COMMENT + 1);
  });
});

describe('inicio fijo', () => {
  const NOW = 1_000_000, CUT = NOW - 3600;
  const p = (id: string, created_at: number) => ({ ...post, id, created_at });
  it('convierte ISO con zona a segundos Unix y tolera un inicio vacío o inválido', () => {
    expect(postCutoff({ startLine: '2026-10-13T21:00:00-03:00' })).toBe(Date.UTC(2026, 9, 14) / 1000);
    expect(postCutoff({ startLine: '' })).toBeUndefined();
    expect(postCutoff({ startLine: 'basura' })).toBeUndefined();
  });
  it('rechaza posts anteriores, acepta el límite y no impone corte si falta', () => {
    const s = new ZapStore(undefined, { cutoff: CUT });
    s.addPost(p('viejo', CUT - 1)); s.addPost(p('justo', CUT));
    expect([...s.posts.keys()]).toEqual(['justo']);
    const unlimited = new ZapStore(); unlimited.addPost(p('antiguo', 1));
    expect(unlimited.posts.has('antiguo')).toBe(true);
  });
  it('no vence posts ni zaps aceptados por el paso del tiempo', () => {
    vi.useFakeTimers(); vi.setSystemTime(NOW * 1000);
    const s = new ZapStore(undefined, { cutoff: CUT });
    s.addPost(p('a', CUT + 1)); s.addZap({ ...zap, postId: 'a', created_at: CUT + 2 });
    vi.advanceTimersByTime(10 * 86400 * 1000);
    s.addPost(p('b', CUT + 5));
    expect([...s.posts.keys()].sort()).toEqual(['a', 'b']);
    expect(s.zaps.has(zap.id)).toBe(true);
  });
  it('filtra el historial por inicio y descarta sus zaps huérfanos', () => {
    const s = new ZapStore(mem({ posts: [p('viejo', CUT - 10), p('nuevo', CUT + 10)],
      zaps: [{ ...zap, id: 'zv', postId: 'viejo', created_at: CUT }, { ...zap, id: 'zn', postId: 'nuevo', created_at: CUT + 20 }],
    }), { cutoff: CUT });
    expect([...s.posts.keys()]).toEqual(['nuevo']);
    expect([...s.zaps.keys()]).toEqual(['zn']);
  });
  it('mover el inicio en vivo cambia posts, zaps y totales', () => {
    const s = new ZapStore(undefined, { cutoff: 100 });
    s.addPost({ ...post, id: 'p', created_at: 150 });
    s.addZap({ ...zap, id: 'z1', postId: 'p', created_at: 120 });
    s.addZap({ ...zap, id: 'z2', postId: 'p', msats: 5000, created_at: 220 });
    const move = (seconds: number) => s.setModeration({ hiddenPosts: [], bannedPubkeys: [], startLine: new Date(seconds * 1000).toISOString() });
    move(200);
    expect(s.top(10)).toEqual([]);
    expect(s.latestZaps(10)).toEqual([]);
    move(140);
    expect(s.top(10).map((x) => x.msats)).toEqual([5000]);
    move(50); s.addPost({ ...post, id: 'viejo', created_at: 60 });
    expect(s.latestPosts(10).map((p) => p.id)).toEqual(['p', 'viejo']);
  });
});

describe('proveedores permitidos', () => {
  const providerStore = () => {
    const s = new ZapStore(undefined, { clock: () => 100, zapProviders: DEFAULT_ZAP_PROVIDERS });
    s.addPost({ ...post, id: 'p1' });
    s.addZap({ ...zap, id: 'ok', postId: 'p1', domain: 'pay.getalby.com' });
    s.addZap({ ...zap, id: 'trucho', postId: 'p1', msats: 9_000_000, created_at: 11, domain: 'mi-lnurl.xyz' });
    s.addZap({ ...zap, id: 'viejo', postId: 'p1', msats: 7000, created_at: 12 });
    return s;
  };
  it('acepta dominio exacto o subdominio, nunca prefijos ni sufijos engañosos', () => {
    for (const domain of ['getalby.com', 'pay.getalby.com']) expect(providerAllowed(domain, ['getalby.com'])).toBe(true);
    for (const domain of ['evilgetalby.com', 'getalby.com.evil.io', undefined]) expect(providerAllowed(domain, ['getalby.com'])).toBe(false);
  });
  it('filtra totales y últimos zaps; cambiar la lista reevalúa lo guardado', () => {
    const s = providerStore();
    expect(s.top(10).map((x) => x.msats)).toEqual([1000]);
    expect(s.latestZaps(10).map((z) => z.id)).toEqual(['ok']);
    s.setModeration({ hiddenPosts: [], bannedPubkeys: [], zapProviders: ['mi-lnurl.xyz'] });
    expect(s.latestZaps(10).map((z) => z.id)).toEqual(['trucho']);
  });
  it('no emite animaciones para proveedores excluidos', () => {
    const s = new ZapStore(undefined, { clock: () => 100, zapProviders: ['getalby.com'] });
    s.addPost(post);
    const live = vi.fn(); s.onLive(live);
    s.addZap({ ...zap, id: 't', created_at: 99, domain: 'evil.xyz' });
    expect(live).not.toHaveBeenCalled();
    s.addZap({ ...zap, id: 'o', created_at: 99, domain: 'getalby.com' });
    expect(live).toHaveBeenCalledWith({ type: 'zap', postId: 'a' });
  });
  it('recibe proveedores e inicio por moderación, con defaults si faltan', () => {
    expect(moderationOf({ zapProviders: ['x.com'], startLine: '2026-10-14T21:30:00-03:00' })).toMatchObject({ zapProviders: ['x.com'], startLine: '2026-10-14T21:30:00-03:00' });
    expect(moderationOf({})).toMatchObject({ zapProviders: DEFAULT_ZAP_PROVIDERS, startLine: DEFAULT_START_LINE });
  });
});
