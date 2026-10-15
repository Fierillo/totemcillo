import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handle, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import { DEFAULT_START_LINE } from '../server/settings';
import { ZapStore } from '../src/nostr/store';
import { followCutoff } from '../src/nostr/pool';
import { moderationOf } from '../src/moderation-lists';
import { fromArInput, toArInput } from '../src/startline';

const PASS = 'clave-de-prueba';
const NOW = Date.parse('2026-10-15T05:00:00Z');
const deps = (): Deps => ({ storage: memoryStorage(), env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: 's'.repeat(32) }, now: () => NOW });
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): ApiRequest =>
  ({ method, path, body, ip: '1.1.1.1', headers: { 'content-type': 'application/json', ...headers } });
const login = async (d: Deps) => String((await handle(req('POST', '/api/login', { password: PASS }), d)).headers['set-cookie']).split(';')[0];
const sec = (iso: string) => Date.parse(iso) / 1000;

describe('startLine en el servidor', () => {
  it('por defecto la de config.json, en /api/settings y /api/kiosk', async () => {
    expect(DEFAULT_START_LINE).toBe(JSON.parse(readFileSync('public/config.json', 'utf8')).startLine);
    const d = deps();
    expect((await handle(req('GET', '/api/settings'), d)).body).toMatchObject({ startLine: DEFAULT_START_LINE });
    expect((await handle(req('GET', '/api/kiosk'), d)).body).toMatchObject({ startLine: DEFAULT_START_LINE });
  });
  it('el admin la cambia: ISO con hora y zona, no muy en el futuro; sube versión sin mover la agenda', async () => {
    const d = deps(); const c = await login(d);
    const put = (startLine: unknown) => handle(req('PUT', '/api/settings', { startLine }, { cookie: c }), d);
    const r = await put('2026-10-14T21:30:00-03:00');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ startLine: '2026-10-14T21:30:00-03:00', version: 1 });
    expect((r.body as any).epoch).toBeUndefined();
    expect((await handle(req('GET', '/api/kiosk'), d)).body).toMatchObject({ startLine: '2026-10-14T21:30:00-03:00' });
    expect((await put('2026-10-14T21:30:00Z')).status).toBe(200);
    for (const bad of [5, '', 'mañana', '2026-10-13', '2026-10-13T21:00', '2026-13-40T99:00:00-03:00', '2027-12-01T00:00:00-03:00', '2019-01-01T00:00:00Z'])
      expect((await put(bad)).status, String(bad)).toBe(400);
  });
});

describe('ZapStore con startLine del servidor', () => {
  it('posts y zaps anteriores no cuentan; mover la línea aplica en vivo', () => {
    const s = new ZapStore(undefined, { cutoff: 100 });
    s.addPost({ id: 'p', pubkey: 'a', content: 'x', created_at: 150 });
    s.addZap({ id: 'z1', postId: 'p', msats: 1000, comment: '', created_at: 120 });
    s.addZap({ id: 'z2', postId: 'p', msats: 5000, comment: '', created_at: 220 });
    s.setModeration({ hiddenPosts: [], bannedPubkeys: [], startLine: new Date(200_000).toISOString() });
    expect(s.top(10)).toEqual([]); // el post es anterior a la línea
    expect(s.latestZaps(10).map((z) => z.id)).toEqual([]);
    s.setModeration({ hiddenPosts: [], bannedPubkeys: [], startLine: new Date(140_000).toISOString() });
    expect(s.top(10).map((x) => x.msats)).toEqual([5000]); // z1 es anterior a la línea
    s.setModeration({ hiddenPosts: [], bannedPubkeys: [], startLine: new Date(50_000).toISOString() });
    s.addPost({ id: 'viejo', pubkey: 'a', content: 'y', created_at: 60 }); // ahora entra
    expect(s.latestPosts(10).map((p) => p.id)).toEqual(['p', 'viejo']);
  });
  it('llega por el mismo flujo; si falta, la de por defecto', () => {
    expect(moderationOf({ startLine: '2026-10-14T21:30:00-03:00' }).startLine).toBe('2026-10-14T21:30:00-03:00');
    expect(moderationOf({}).startLine).toBe(DEFAULT_START_LINE);
  });
});

describe('followCutoff: vuelve a pedir a los relays si la línea se adelanta', () => {
  it('sólo reinicia la suscripción si el nuevo corte es anterior a lo cargado', () => {
    const handles: { close: ReturnType<typeof vi.fn> }[] = [];
    const start = vi.fn((_c?: number) => { const h = { close: vi.fn() }; handles.push(h); return h; });
    const f = followCutoff(start, sec('2026-10-13T00:00:00-03:00'));
    expect(start).toHaveBeenLastCalledWith(sec('2026-10-13T00:00:00-03:00'));
    f.setCutoff(sec('2026-10-14T00:00:00-03:00')); // más tarde: ya está cargado
    expect(start).toHaveBeenCalledTimes(1);
    f.setCutoff(sec('2026-10-12T00:00:00-03:00')); // antes: hay que traer lo que falta
    expect(start).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenLastCalledWith(sec('2026-10-12T00:00:00-03:00'));
    expect(handles[0].close).toHaveBeenCalledWith(true); // conserva las conexiones del pool
    f.setCutoff(sec('2026-10-12T12:00:00-03:00'));
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe('admin: fecha y hora de Argentina', () => {
  it('convierte ISO ↔ datetime-local en UTC-3', () => {
    expect(toArInput('2026-10-13T00:00:00-03:00')).toBe('2026-10-13T00:00');
    expect(toArInput('2026-10-14T00:30:00Z')).toBe('2026-10-13T21:30');
    expect(toArInput('basura')).toBe('');
    expect(fromArInput('2026-10-14T21:30')).toBe('2026-10-14T21:30:00-03:00');
    expect(fromArInput('')).toBeNull();
  });
  it('el campo vive en la pestaña Config y se guarda con Guardar', () => {
    const src = readFileSync('src/admin.ts', 'utf8');
    const cfg = src.slice(src.indexOf('data-pane="config"'), src.indexOf('data-pane="mod"'));
    expect(cfg).toMatch(/class="card card-start"[\s\S]*type="datetime-local" name="startLine"/);
    expect(src).toMatch(/startLine: fromArInput\(/);
  });
});
