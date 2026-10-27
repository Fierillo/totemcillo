// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProfileCache, profiles, configureProfiles, authorHtml, installAvatarFallback, PLACEHOLDER_CLASS } from '../src/nostr/profiles';
import { ZapStore } from '../src/nostr/store';
import { postScene } from '../src/scenes/post';
import { batallaScene } from '../src/scenes/batalla';
import { renderMobile } from '../src/mobile';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';
import { keys, sign } from './helpers';

const meta = (sk: Uint8Array, content: object, created_at = 10) => sign(sk, { kind: 0, created_at, content: JSON.stringify(content), tags: [] });
const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

beforeEach(() => vi.useFakeTimers());
afterEach(() => { profiles.clear(); profiles.configure({ query: undefined, subscribe: undefined, storage: undefined, preload: undefined }); vi.useRealTimers(); });

describe('caché de perfiles: autores sin perfil y fecha del kind 0', () => {
  it('recuerda en localStorage que un autor no tiene perfil (6 h): en la recarga no vuelve a esqueleto ni consulta', async () => {
    const s = mem(), pk = 'e'.repeat(64);
    const a = new ProfileCache({ storage: s, batchMs: 0, query: async () => [] });
    a.get(pk);
    await vi.advanceTimersByTimeAsync(10);
    expect(a.get(pk)).toBeNull();
    const query = vi.fn(async () => []);
    const b = new ProfileCache({ storage: s, batchMs: 0, query });
    expect(b.get(pk)).toBeNull();
    await vi.advanceTimersByTimeAsync(10);
    expect(query).not.toHaveBeenCalled();
  });
  it('updatedAt(pk) da el created_at del kind 0 conocido (0 si no hay)', async () => {
    const { sk, pk } = keys();
    const c = new ProfileCache({ batchMs: 0, query: async () => [meta(sk, { name: 'x' }, 42)] });
    expect(c.updatedAt(pk)).toBe(0);
    c.get(pk);
    await vi.advanceTimersByTimeAsync(10);
    expect(c.updatedAt(pk)).toBe(42);
  });
});

describe('ProfileCache: kind 0 desde relays, en lotes y con caché', () => {
  it('agrupa pedidos en un solo query y usa display_name, si no name; picture sólo https', async () => {
    const a = keys(), b = keys(), c = keys();
    const query = vi.fn(async (authors: string[]) => [
      meta(a.sk, { display_name: 'Ana Display', name: 'ana', picture: 'https://img/a.png' }),
      meta(a.sk, { name: 'vieja' }, 1),
      meta(b.sk, { name: 'beto', picture: 'javascript:alert(1)' }),
      { ...meta(c.sk, { name: 'falsa' }), sig: '00'.repeat(64) }, // invalid signature
    ].filter((e) => authors.includes(e.pubkey)));
    const pc = new ProfileCache({ query, batchMs: 50 });
    expect(pc.get(a.pk)).toBeUndefined();
    pc.get(b.pk); pc.get(c.pk); pc.get(a.pk);
    await vi.advanceTimersByTimeAsync(60);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0].sort()).toEqual([a.pk, b.pk, c.pk].sort());
    expect(pc.get(a.pk)).toEqual({ name: 'Ana Display', picture: 'https://img/a.png' });
    expect(pc.get(b.pk)).toEqual({ name: 'beto' });
    expect(pc.get(c.pk)).toBeNull(); // no valid profile: not requested again
    pc.get(c.pk);
    await vi.advanceTimersByTimeAsync(60);
    expect(query).toHaveBeenCalledTimes(1);
  });
  it('avisa cambios y persiste en localStorage; otra instancia lo lee sin pedir', async () => {
    const a = keys();
    const storage = mem();
    const pc = new ProfileCache({ query: async () => [meta(a.sk, { name: 'ana' })], storage, batchMs: 10 });
    const fn = vi.fn();
    pc.onChange(fn);
    pc.get(a.pk);
    await vi.advanceTimersByTimeAsync(20);
    expect(fn).toHaveBeenCalled();
    const q2 = vi.fn(async () => []);
    const pc2 = new ProfileCache({ query: q2, storage, batchMs: 10 });
    expect(pc2.get(a.pk)).toEqual({ name: 'ana' });
    await vi.advanceTimersByTimeAsync(20);
    expect(q2).not.toHaveBeenCalled();
  });
  it('error de red: no rompe y se puede reintentar más tarde', async () => {
    const a = keys();
    let fail = true;
    const pc = new ProfileCache({ query: async () => { if (fail) throw new Error('x'); return [meta(a.sk, { name: 'ana' })]; }, batchMs: 10, retryMs: 1000 });
    pc.get(a.pk);
    await vi.advanceTimersByTimeAsync(20);
    expect(pc.get(a.pk)).toBeUndefined();
    fail = false;
    await vi.advanceTimersByTimeAsync(1100);
    pc.get(a.pk);
    await vi.advanceTimersByTimeAsync(20);
    expect(pc.get(a.pk)).toEqual({ name: 'ana' });
  });
});

describe('authorHtml', () => {
  const pk = 'f'.repeat(64);
  it('cargando: skeleton de avatar y nombre, nunca la npub sin resolver', () => {
    const pc = new ProfileCache({ batchMs: 10 });
    const d = document.createElement('div');
    d.innerHTML = authorHtml(pk, pc);
    expect(d.querySelectorAll('.author .skel')).toHaveLength(2);
    expect(d.textContent).not.toContain('ffffffff');
    expect(d.querySelector('img')).toBeNull();
  });
  it('sin perfil: avatar neutro + npub corto', () => {
    const pc = new ProfileCache({ batchMs: 10 });
    pc.set(pk, null);
    const h = authorHtml(pk, pc);
    expect(h).toContain(PLACEHOLDER_CLASS);
    expect(h).toContain('ffffffff…ffff');
    expect(h).not.toContain('skel');
  });
  it('precarga la foto antes de mostrar el perfil; si falla, alias con avatar neutro', async () => {
    let finish!: () => void, fail!: (e: Error) => void;
    const preload = vi.fn((src: string) => new Promise<void>((done, reject) => { if (src.includes('ok')) finish = done; else fail = reject; }));
    const pc = new ProfileCache({ preload });
    const ok = 'a'.repeat(64), bad = 'b'.repeat(64);
    pc.set(ok, { name: 'Ana', picture: 'https://img/ok.png' });
    pc.set(bad, { name: 'Beto', picture: 'https://img/bad.png' });
    const fn = vi.fn(); pc.onChange(fn);
    expect(pc.get(ok)).toBeUndefined();
    expect(pc.get(bad)).toBeUndefined();
    pc.get(ok);
    expect(preload).toHaveBeenCalledTimes(2);
    finish(); fail(new Error('404'));
    await vi.advanceTimersByTimeAsync(0);
    expect(fn).toHaveBeenCalled();
    expect(pc.get(ok)).toEqual({ name: 'Ana', picture: 'https://img/ok.png' });
    const d = document.createElement('div');
    d.innerHTML = authorHtml(ok, pc) + authorHtml(bad, pc);
    expect(d.querySelectorAll('img.avatar')).toHaveLength(1);
    expect([...d.querySelectorAll('.alias')].map((e) => e.textContent)).toEqual(['Ana', 'Beto']);
    expect(d.querySelectorAll(`.${PLACEHOLDER_CLASS}`)).toHaveLength(1);
  });
  it('con perfil: <img> redondo (sin lazy ni referrer) + alias escapado', () => {
    const pc = new ProfileCache({ batchMs: 10 });
    pc.set(pk, { name: '<b>Ana</b>', picture: 'https://img/a.png?x="1"' });
    const d = document.createElement('div');
    d.innerHTML = authorHtml(pk, pc);
    const img = d.querySelector('img.avatar')!;
    expect(img.getAttribute('src')).toBe('/api/avatar?url=' + encodeURIComponent('https://img/a.png?x="1"'));
    expect(img.getAttribute('alt')).toBe('');
    expect(img.hasAttribute('loading')).toBe(false);
    expect(img.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(d.querySelector('.alias')!.textContent).toBe('<b>Ana</b>');
    expect(d.querySelector('b')).toBeNull();
  });
  it('perfil sin foto: avatar neutro + alias; sender anónimo: "anónimo"', () => {
    const pc = new ProfileCache({ batchMs: 10 });
    pc.set(pk, { name: 'ana' });
    expect(authorHtml(pk, pc)).toContain(PLACEHOLDER_CLASS);
    expect(authorHtml(undefined, pc)).toContain('anónimo');
  });
  it('imagen rota → se reemplaza por el avatar neutro', () => {
    const pc = new ProfileCache({ batchMs: 10 });
    pc.set(pk, { name: 'ana', picture: 'https://img/rota.png' });
    const d = document.createElement('div');
    document.body.appendChild(d);
    installAvatarFallback(document);
    d.innerHTML = authorHtml(pk, pc);
    d.querySelector('img.avatar')!.dispatchEvent(new Event('error'));
    expect(d.querySelector('img.avatar')).toBeNull();
    expect(d.querySelector(`.${PLACEHOLDER_CLASS}`)).not.toBeNull();
    d.remove();
  });
});

describe('escenas y móvil muestran alias + avatar (y se actualizan al llegar el perfil)', () => {
  const setup = () => {
    const a = keys(), z = keys();
    const store = new ZapStore();
    store.addPost({ id: '1'.repeat(64), pubkey: a.pk, content: 'hola', created_at: 100 });
    store.addZap({ id: '2'.repeat(64), postId: '1'.repeat(64), sender: z.pk, msats: 21000, comment: '', created_at: 101 });
    const query = vi.fn(async (authors: string[]) => [meta(a.sk, { name: 'Autora', picture: 'https://img/a.png' }), meta(z.sk, { display_name: 'Zapeador' })].filter((e) => authors.includes(e.pubkey)));
    profiles.configure({ query });
    return { store, a, z };
  };
  it('mensajes, batalla y móvil', async () => {
    const { store } = setup();
    const roots = [document.createElement('div'), document.createElement('div'), document.createElement('div')];
    const cleanups = [
      postScene(store, { publicUrl: 'https://x/' }).render(roots[0]),
 batallaScene(store, 3, undefined, undefined, () => 102_000).render(roots[1]),
      renderMobile(roots[2], store, defaultConfig, new Announcement('')),
    ];
    try {
      for (const r of roots) {
        expect(r.querySelector('.author .skel'), r.innerHTML.slice(0, 80)).not.toBeNull();
        expect(r.textContent).not.toContain('…');
      }
      await vi.advanceTimersByTimeAsync(1000);
      for (const r of [roots[0], roots[1], roots[2]]) {
        expect([...r.querySelectorAll('.alias')].map((e) => e.textContent)).toContain('Autora');
        expect(r.querySelector('img.avatar')).not.toBeNull();
      }
    } finally { cleanups.forEach((cleanup) => cleanup?.()); }
  });
});

describe('perfiles en vivo', () => {
  const fakeSub = () => {
    const subs: { authors: string[]; onevent: (event: any) => void; closed: boolean }[] = [];
    const subscribe = vi.fn((authors: string[], onevent: (event: any) => void) => {
      const sub = { authors: [...authors], onevent, closed: false }; subs.push(sub);
      return { close: () => { sub.closed = true; } };
    });
    return { subs, subscribe };
  };
  it('agrupa autores en una suscripción y la reabre solo si aparecen nuevos', async () => {
    const a = keys(), b = keys(), c = keys(), { subs, subscribe } = fakeSub();
    const pc = new ProfileCache({ query: async () => [], subscribe, subscribeDebounceMs: 3000 });
    pc.get(a.pk); pc.get(b.pk);
    await vi.advanceTimersByTimeAsync(2000);
    expect(subscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(subs).toHaveLength(1);
    expect(subs[0].authors.sort()).toEqual([a.pk, b.pk].sort());
    pc.get(a.pk); await vi.advanceTimersByTimeAsync(3100);
    expect(subs).toHaveLength(1);
    pc.get(c.pk); await vi.advanceTimersByTimeAsync(3100);
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[1].closed).toBe(false);
    expect(subs[1].authors.sort()).toEqual([a.pk, b.pk, c.pk].sort());
  });
  it('actualiza y persiste eventos nuevos; ignora antiguos, ajenos, repetidos o falsificados', async () => {
    const a = keys(), x = keys(), storage = mem(), { subs, subscribe } = fakeSub();
    const pc = new ProfileCache({ query: async () => [meta(a.sk, { name: 'Ana' }, 100)], subscribe, storage, batchMs: 10, subscribeDebounceMs: 100 });
    const fn = vi.fn(); pc.onChange(fn); pc.get(a.pk);
    await vi.advanceTimersByTimeAsync(200);
    expect(pc.get(a.pk)).toEqual({ name: 'Ana' });
    fn.mockClear();
    const push = subs[0].onevent;
    push(meta(a.sk, { name: 'Vieja' }, 50));
    push(meta(x.sk, { name: 'Intrusa' }, 500));
    push({ ...meta(a.sk, { name: 'Falsa' }, 600), content: '{"name":"Cambiada"}' });
    expect(pc.get(a.pk)).toEqual({ name: 'Ana' });
    expect(fn).not.toHaveBeenCalled();
    const fresh = meta(a.sk, { name: 'Ana Nueva', picture: 'https://img/n.png' }, 200);
    push(fresh); push(fresh);
    expect(pc.get(a.pk)).toEqual({ name: 'Ana Nueva', picture: 'https://img/n.png' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.m.get('totemcillo:profiles:v1')!)[a.pk]).toMatchObject({ name: 'Ana Nueva', picture: 'https://img/n.png' });
  });
  it('recargar conserva el timestamp y no permite reemplazar por un perfil viejo', async () => {
    const a = keys(), storage = mem(), { subs, subscribe } = fakeSub();
    const pc1 = new ProfileCache({ query: async () => [meta(a.sk, { name: 'Ana' }, 100)], storage, batchMs: 10 });
    pc1.get(a.pk); await vi.advanceTimersByTimeAsync(50);
    const pc2 = new ProfileCache({ storage, subscribe, subscribeDebounceMs: 10 });
    expect(pc2.get(a.pk)).toEqual({ name: 'Ana' });
    await vi.advanceTimersByTimeAsync(50);
    subs[0].onevent(meta(a.sk, { name: 'Vieja' }, 90));
    expect(pc2.get(a.pk)).toEqual({ name: 'Ana' });
  });
  it.each(['older', 'empty'])('una consulta %s que termina después de un evento en vivo no lo pisa', async (result) => {
    const a = keys();
    let resolve!: (events: ReturnType<typeof meta>[]) => void;
    const query = vi.fn(() => new Promise<ReturnType<typeof meta>[]>((done) => { resolve = done; }));
    const pc = new ProfileCache({ query, batchMs: 10 });
    pc.get(a.pk); await vi.advanceTimersByTimeAsync(20);
    expect(query).toHaveBeenCalledOnce();
    expect(pc.ingest(meta(a.sk, { name: 'Live' }, 200))).toBe(true);
    resolve(result === 'older' ? [meta(a.sk, { name: 'Old' }, 100)] : []);
    await vi.advanceTimersByTimeAsync(1);
    expect(pc.get(a.pk)).toEqual({ name: 'Live' });
  });
  it('la configuración compartida consulta y suscribe usando el mismo pool y relays', async () => {
    const a = keys(), event = meta(a.sk, { name: 'Initial' });
    const pool = { querySync: vi.fn(async () => [event]), subscribeMany: vi.fn(() => ({ close: vi.fn() })) };
    configureProfiles(pool, ['wss://example.com'], mem(), document);
    profiles.get(a.pk); await vi.advanceTimersByTimeAsync(3100);
    expect(pool.querySync).toHaveBeenCalledWith(['wss://example.com'], { kinds: [0], authors: [a.pk] }, { maxWait: 4000 });
    expect(pool.subscribeMany).toHaveBeenCalledWith(['wss://example.com'], { kinds: [0], authors: [a.pk] }, { onevent: expect.any(Function) });
    expect(profiles.get(a.pk)).toEqual({ name: 'Initial' });
  });
});
