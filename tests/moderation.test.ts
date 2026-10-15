// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { handle, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import { LIMITS } from '../server/settings';
import { ZapStore } from '../src/nostr/store';
import { recentPosts } from '../src/scenes/post';
import { Follower } from '../src/follow';
import { createRemote } from '../src/remote';
import { Announcement } from '../src/announcement';
import { renderModeration } from '../src/moderation';

const PASS = 'clave-de-prueba';
const H = (c: string) => c.repeat(64);
const deps = (): Deps => ({ storage: memoryStorage(), env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: 's'.repeat(32) }, now: () => 1_000_000 });
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): ApiRequest =>
  ({ method, path, body, ip: '1.1.1.1', headers: { 'content-type': 'application/json', ...headers } });
const login = async (d: Deps) => String((await handle(req('POST', '/api/login', { password: PASS }), d)).headers['set-cookie']).split(';')[0];
const mod = async (d: Deps, cookie: string, body: unknown) => handle(req('POST', '/api/moderation', body, { cookie }), d);

describe('POST /api/moderation (admin)', () => {
  it('sin sesión → 401; sin JSON → 415; GET → 405', async () => {
    const d = deps();
    expect((await mod(d, '', { action: 'hide', id: H('a') })).status).toBe(401);
    const c = await login(d);
    expect((await handle(req('POST', '/api/moderation', { action: 'hide', id: H('a') }, { cookie: c, 'content-type': 'text/plain' }), d)).status).toBe(415);
    expect((await handle(req('GET', '/api/moderation'), d)).status).toBe(405);
  });
  it('valida acción e id (64 hex)', async () => {
    const d = deps(); const c = await login(d);
    for (const b of [{ action: 'hide', id: 'abc' }, { action: 'borrar', id: H('a') }, { action: 'ban', id: H('g') }, null, { action: 'ban' }])
      expect((await mod(d, c, b)).status).toBe(400);
  });
  it('ocultar/banear y deshacer; sube la versión; idempotente; normaliza a minúscula', async () => {
    const d = deps(); const c = await login(d);
    let r = await mod(d, c, { action: 'hide', id: H('A') });
    expect(r.status).toBe(200);
    expect((r.body as any).hiddenPosts).toEqual([H('a')]);
    expect((r.body as any).version).toBe(1);
    await mod(d, c, { action: 'hide', id: H('a') });
    r = await mod(d, c, { action: 'ban', id: H('b') });
    expect((r.body as any)).toMatchObject({ hiddenPosts: [H('a')], bannedPubkeys: [H('b')], version: 3 });
    r = await mod(d, c, { action: 'unhide', id: H('a') });
    r = await mod(d, c, { action: 'unban', id: H('b') });
    expect((r.body as any)).toMatchObject({ hiddenPosts: [], bannedPubkeys: [] });
  });
  it('las listas tienen tope', async () => {
    const d = deps(); const c = await login(d);
    const full = Array.from({ length: LIMITS.maxModeration }, (_, i) => i.toString(16).padStart(64, '0'));
    await d.storage.set('totem:settings', { announcement: '', sceneDurations: {}, command: { seq: 0, action: null }, bannedPubkeys: full });
    expect((await mod(d, c, { action: 'ban', id: H('f') })).status).toBe(400);
    expect((await mod(d, c, { action: 'ban', id: full[0] })).status).toBe(200); // ya estaba: no falla
  });
  it('/api/kiosk (público) trae las listas y otros cambios de settings las conservan', async () => {
    const d = deps(); const c = await login(d);
    await mod(d, c, { action: 'hide', id: H('a') });
    await mod(d, c, { action: 'ban', id: H('b') });
    await handle(req('PUT', '/api/settings', { announcement: 'hola', command: 'next' }, { cookie: c }), d);
    const k = (await handle(req('GET', '/api/kiosk'), d)).body as any;
    expect(k).toMatchObject({ hiddenPosts: [H('a')], bannedPubkeys: [H('b')] });
  });
  it('existe la Function de Vercel', () => {
    expect(readFileSync('api/moderation.ts', 'utf8')).toContain("from '../server/node.js'");
  });
});

const filled = () => {
  const s = new ZapStore();
  s.addPost({ id: 'p1', pubkey: 'malo', content: 'feo', created_at: 1 });
  s.addPost({ id: 'p2', pubkey: 'bueno', content: 'ok', created_at: 2 });
  s.addPost({ id: 'p3', pubkey: 'bueno', content: 'oculto', created_at: 3 });
  s.addZap({ id: 'z1', postId: 'p1', sender: 'x', msats: 9000, comment: '', created_at: 10 });
  s.addZap({ id: 'z2', postId: 'p2', sender: 'malo', msats: 7000, comment: 'spam', created_at: 11 });
  s.addZap({ id: 'z3', postId: 'p2', sender: 'x', msats: 1000, comment: '', created_at: 12 });
  s.addZap({ id: 'z4', postId: 'p3', sender: 'x', msats: 5000, comment: '', created_at: 13 });
  return s;
};

describe('ZapStore con moderación', () => {
  it('saca posts ocultos y de baneados, sus zaps y los zaps enviados por baneados', () => {
    const s = filled();
    const fn = vi.fn();
    s.onChange(fn);
    s.setModeration({ hiddenPosts: ['p3'], bannedPubkeys: ['malo'] });
    expect(fn).toHaveBeenCalled();
    expect(recentPosts(s, 10).map((x) => x.postId)).toEqual(['p2']);
    expect(s.top(10).map((x) => [x.postId, x.msats])).toEqual([['p2', 1000]]);
    expect(s.latestZaps(10).map((z) => z.id)).toEqual(['z3']);
    expect(s.latestPosts(10).map((p) => p.id)).toEqual(['p2']);
  });
  it('también filtra lo que llega después de banear; deshacer lo devuelve', () => {
    const s = filled();
    s.setModeration({ hiddenPosts: [], bannedPubkeys: ['malo'] });
    s.addPost({ id: 'p4', pubkey: 'malo', content: 'otra', created_at: 4 });
    expect(recentPosts(s, 10).map((x) => x.postId)).not.toContain('p4');
    s.setModeration({ hiddenPosts: [], bannedPubkeys: [] });
    expect(recentPosts(s, 10).map((x) => x.postId)).toContain('p4');
  });
  it('mismas listas no redibujan', () => {
    const s = filled();
    s.setModeration({ hiddenPosts: ['p3'], bannedPubkeys: [] });
    const fn = vi.fn(); s.onChange(fn);
    s.setModeration({ hiddenPosts: ['p3'], bannedPubkeys: [] });
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('las listas llegan al tótem y al celular por el flujo existente', () => {
  afterEach(() => vi.useRealTimers());
  it('Follower pasa hiddenPosts/bannedPubkeys de /api/kiosk', async () => {
    const k = { epoch: 0, sceneDurations: { post: 5000, latestZaps: 5000, top10Historico: 5000, top10Ultimas3h: 5000, anuncio: 5000 }, videoEveryCycles: 2, videoMode: 'full', videoClipSeconds: 21, videoDurationSec: 10, announcement: '', version: 1, hiddenPosts: [H('a')], bannedPubkeys: [H('b')] };
    const f = vi.fn(async (url: string) => ({ ok: true, json: async () => (url.startsWith('/api/kiosk') ? k : url === '/api/time' ? { now: 500 } : { version: 1 }) }));
    const onModeration = vi.fn();
    await new Follower(document.createElement('div'), [], { fetchFn: f as any, clock: () => 500, pollMs: 30_000, onModeration }).start();
    expect(onModeration).toHaveBeenCalledWith(expect.objectContaining({ hiddenPosts: [H('a')], bannedPubkeys: [H('b')] }));
    expect(f.mock.calls.map((c) => c[0])).not.toContain('/api/moderation');
  });
  it('createRemote (móvil) las pasa desde /api/settings; si faltan, listas vacías', async () => {
    const res = [{ announcement: '', sceneDurations: {}, command: { seq: 0, action: null }, hiddenPosts: ['h'], bannedPubkeys: ['b'] }, { announcement: '', sceneDurations: {}, command: { seq: 0, action: null } }];
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => res.shift() }));
    const onModeration = vi.fn();
    const nav = { next() {}, prev() {}, setDuration() {}, setEveryCycles() {}, setVideoMode() {}, setClipSeconds() {} };
    const r = createRemote({ fetchFn: fetchFn as any, nav, announcement: new Announcement(''), baseDurations: {}, baseVideoEveryCycles: 2, baseVideoMode: 'full', baseVideoClipSeconds: 21, onModeration });
    await r.poll();
    expect(onModeration).toHaveBeenLastCalledWith(expect.objectContaining({ hiddenPosts: ['h'], bannedPubkeys: ['b'] }));
    await r.poll();
    expect(onModeration).toHaveBeenLastCalledWith(expect.objectContaining({ hiddenPosts: [], bannedPubkeys: [] }));
  });
});

describe('panel de moderación en /admin', () => {
  const setup = () => {
    const s = new ZapStore();
    s.addPost({ id: H('1'), pubkey: H('a'), content: 'viejo <b>x</b>', created_at: Math.floor(Date.now() / 1000) - 600 });
    s.addPost({ id: H('2'), pubkey: H('c'), content: 'nuevo', created_at: Math.floor(Date.now() / 1000) - 60 });
    s.addZap({ id: 'z', postId: H('1'), sender: H('d'), msats: 21000, comment: '', created_at: 1 });
    const root = document.createElement('div');
    const act = vi.fn(async () => true);
    const confirmFn = vi.fn(() => true);
    const ui = renderModeration(root, { store: s, act, confirm: confirmFn });
    return { s, root, act, confirmFn, ui };
  };
  it('lista los posts más nuevos primero con autor, hora, texto escapado y sats', () => {
    const { root } = setup();
    const rows = [...root.querySelectorAll('.mod-post')];
    expect(rows.map((r) => r.getAttribute('data-id'))).toEqual([H('2'), H('1')]);
    expect(rows[1].querySelector('.author')).not.toBeNull();
    expect(rows[1].textContent).toContain('hace');
    expect(rows[1].innerHTML).toContain('&lt;b&gt;');
    expect(rows[1].textContent).toContain('21 sats');
    expect(rows[0].querySelector('button.hide')!.textContent).toBe('Eliminar');
    expect(rows[0].querySelector('button.ban')!.textContent).toBe('Banear autor');
  });
  it('Eliminar oculta; Banear pide confirmación', async () => {
    const { root, act, confirmFn } = setup();
    (root.querySelector(`.mod-post[data-id="${H('2')}"] button.hide`) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(act).toHaveBeenCalledWith('hide', H('2')));
    confirmFn.mockReturnValueOnce(false);
    (root.querySelector(`.mod-post[data-id="${H('1')}"] button.ban`) as HTMLButtonElement).click();
    expect(confirmFn).toHaveBeenCalled();
    expect(act).not.toHaveBeenCalledWith('ban', H('a'));
    (root.querySelector(`.mod-post[data-id="${H('1')}"] button.ban`) as HTMLButtonElement).click();
    await vi.waitFor(() => expect(act).toHaveBeenCalledWith('ban', H('a')));
  });
  it('con moderación aplicada: ocultos fuera de la lista y baneados con Desbanear', async () => {
    const { s, root, act } = setup();
    s.setModeration({ hiddenPosts: [H('2')], bannedPubkeys: [H('a')] });
    expect(root.querySelectorAll('.mod-post').length).toBe(0);
    const b = root.querySelector(`.mod-banned [data-pk="${H('a')}"]`)!;
    expect(b).not.toBeNull();
    (b.querySelector('button.unban') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(act).toHaveBeenCalledWith('unban', H('a')));
  });
});

describe('estilos de /admin', () => {
  const css = readFileSync('src/admin.css', 'utf8');
  it('pestañas pegajosas en celular y ocultas en escritorio', () => {
    expect(css).toMatch(/\.tabs\s*\{[^}]*position:\s*sticky/);
    expect(css).toMatch(/\.tabs\s*\{[^}]*top:\s*0/);
    expect(css).toMatch(/@media \(min-width: 701px\)[^@]*\.tabs\s*\{[^}]*display:\s*none/);
  });
});
