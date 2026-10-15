import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handle, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import { readSession, signSession } from '../server/auth';

const PASS = 'clave-de-prueba';
const SECRET = 's'.repeat(32);
let t = 1_000_000;
const deps = (storage = memoryStorage(() => t)): Deps => ({ storage, env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: SECRET }, now: () => t });
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): ApiRequest =>
  ({ method, path, body, ip: '1.1.1.1', headers: { 'content-type': 'application/json', ...headers } });
const login = async (d: Deps) => String((await handle(req('POST', '/api/login', { password: PASS }), d)).headers['set-cookie']).split(';')[0];
const authed = async (d: Deps, cookie: string) => ((await handle(req('GET', '/api/session', undefined, { cookie }), d)).body as any).authed;

describe('sesión con id (jti) revocable', () => {
  it('cada token lleva un jti distinto y su vencimiento', () => {
    const a = readSession(signSession(SECRET, t, 3600), SECRET, t)!, b = readSession(signSession(SECRET, t, 3600), SECRET, t)!;
    expect(a.jti).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(a.jti).not.toBe(b.jti);
    expect(a.exp).toBe(t + 3600_000);
    expect(readSession(signSession(SECRET, t, 3600), 'x'.repeat(32), t)).toBeNull();
  });
  it('un token viejo sin jti ya no vale', async () => {
    const payload = Buffer.from(JSON.stringify({ exp: t + 3600_000 })).toString('base64url');
    const { createHmac } = await import('node:crypto');
    const tok = `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
    expect(readSession(tok, SECRET, t)).toBeNull();
  });
});

describe('logout invalida la sesión en el servidor', () => {
  it('la cookie robada deja de funcionar tras logout (settings, moderación, session)', async () => {
    const d = deps();
    const cookie = await login(d);
    const other = await login(d); // another admin device stays logged in
    expect(await authed(d, cookie)).toBe(true);
    const out = await handle(req('POST', '/api/logout', undefined, { cookie }), d);
    expect(out.status).toBe(200);
    expect(String(out.headers['set-cookie'])).toMatch(/^totem_session=;.*Max-Age=0/);
    expect(await authed(d, cookie)).toBe(false);
    expect((await handle(req('PUT', '/api/settings', { announcement: 'x' }, { cookie }), d)).status).toBe(401);
    expect((await handle(req('POST', '/api/moderation', { action: 'hide', id: 'a'.repeat(64) }, { cookie }), d)).status).toBe(401);
    expect((await handle(req('GET', '/api/settings', undefined, { cookie }), d)).headers['cache-control']).not.toBe('private, no-store');
    expect(await authed(d, other)).toBe(true);
  });
  it('la revocación vence con la sesión (TTL = vida restante)', async () => {
    const storage = memoryStorage(() => t);
    const set = vi.spyOn(storage, 'set');
    const d = deps(storage);
    const cookie = await login(d);
    t += 600_000;
    await handle(req('POST', '/api/logout', undefined, { cookie }), d);
    const call = set.mock.calls.find(([k]) => String(k).startsWith('totem:revoked:'))!;
    expect(call[2]).toBe(3000);
  });
  it('sin cookie válida no toca Redis (ni en logout ni en lecturas públicas)', async () => {
    const storage = memoryStorage(() => t);
    const get = vi.spyOn(storage, 'get'), set = vi.spyOn(storage, 'set');
    const d = deps(storage);
    await handle(req('POST', '/api/logout', undefined, { cookie: 'totem_session=a.b' }), d);
    await handle(req('GET', '/api/session', undefined, { cookie: 'totem_session=a.b' }), d);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});

describe('memoryStorage: set con TTL', () => {
  it('la clave expira', async () => {
    let now = 0;
    const s = memoryStorage(() => now);
    await s.set('k', 1, 10);
    expect(await s.get('k')).toBe(1);
    now = 10_001;
    expect(await s.get('k')).toBeNull();
  });
});

describe('admin: «Salir» vuelve a la raíz', () => {
  it('tras el logout navega a /', () => {
    const src = readFileSync('src/admin.ts', 'utf8');
    expect(src).toMatch(/\.logout'\)!\.addEventListener\('click', async \(\) => \{[^\n]*api\('\/api\/logout'[^\n]*if \(r\??\.ok\) location\.assign\('\/'\)/);
  });
});
