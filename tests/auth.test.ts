import { describe, expect, it, vi } from 'vitest';
import { passwordMatches, signSession, verifySession, parseCookies, readSession } from '../server/auth';
import { memoryStorage, upstashStorage } from '../server/storage';
import { handle, type ApiRequest, type Deps } from '../server/api';

describe('passwordMatches (comparación en tiempo constante)', () => {
  it('acepta sólo la clave exacta', () => {
    expect(passwordMatches('s3creta', 's3creta')).toBe(true);
    expect(passwordMatches('s3cret', 's3creta')).toBe(false);
    expect(passwordMatches('s3cretaX', 's3creta')).toBe(false);
    expect(passwordMatches('', 's3creta')).toBe(false);
  });
  it('rechaza tipos raros y una clave configurada vacía', () => {
    expect(passwordMatches(undefined, 'x')).toBe(false);
    expect(passwordMatches({ a: 1 }, 'x')).toBe(false);
    expect(passwordMatches('', '')).toBe(false);
  });
});

describe('sesión firmada con HMAC', () => {
  const secret = 'a'.repeat(32);
  it('firma y verifica antes de vencer', () => {
    const t = signSession(secret, 1_000_000, 3600);
    expect(verifySession(t, secret, 1_000_000 + 3599_000)).toBe(true);
  });
  it('rechaza vencida, adulterada, con otro secreto o basura', () => {
    const t = signSession(secret, 1_000_000, 3600);
    expect(verifySession(t, secret, 1_000_000 + 3601_000)).toBe(false);
    const [p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ exp: 9e12 })).toString('base64url');
    expect(verifySession(`${forged}.${s}`, secret, 1_000_000)).toBe(false);
    expect(verifySession(`${p}.${s.slice(0, -2)}xx`, secret, 1_000_000)).toBe(false);
    expect(verifySession(t, 'b'.repeat(32), 1_000_000)).toBe(false);
    for (const junk of ['', '.', 'abc', undefined]) expect(verifySession(junk as string, secret, 1_000_000)).toBe(false);
  });
  it('parsea cookies', () => {
    expect(parseCookies('a=1; totem_session=xyz.abc; b=2')).toEqual({ a: '1', totem_session: 'xyz.abc', b: '2' });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('memoryStorage', () => {
  it('solo guarda si coincide la versión, incluyendo datos antiguos sin versión', async () => {
    const s = memoryStorage();
    expect(await s.compareAndSet('k', null, { version: 1 })).toBe(true);
    expect(await s.compareAndSet('k', null, { version: 2 })).toBe(false);
    expect(await s.compareAndSet('k', 0, { version: 2 })).toBe(false);
    expect(await s.compareAndSet('k', 1, { version: 2 })).toBe(true);
    expect(await s.get('k')).toEqual({ version: 2 });
    await s.set('legacy', { announcement: 'anterior' });
    expect(await s.compareAndSet('legacy', 0, { version: 1, announcement: 'nuevo' })).toBe(true);
    expect(await s.get('legacy')).toEqual({ version: 1, announcement: 'nuevo' });
  });
  it('guarda JSON y cuenta con vencimiento', async () => {
    let now = 0;
    const s = memoryStorage(() => now);
    expect(await s.get('k')).toBeNull();
    await s.set('k', { a: 1 });
    expect(await s.get('k')).toEqual({ a: 1 });
    expect(await s.incr('c', 10)).toBe(1);
    expect(await s.incr('c', 10)).toBe(2);
    now = 11_000;
    expect(await s.incr('c', 10)).toBe(1);
  });
  it('expira valores con TTL', async () => {
    let now = 0;
    const s = memoryStorage(() => now);
    await s.set('k', 1, 10);
    expect(await s.get('k')).toBe(1);
    now = 10_001;
    expect(await s.get('k')).toBeNull();
  });
});

// Argument contract only: Redis is mocked, so the Lua script never runs here.
it('Upstash: compareAndSet envía clave, versión esperada (-1 si no hay) y JSON al script, y traduce 1/0 a true/false', async () => {
  const evaluate = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(0).mockResolvedValueOnce(1);
  vi.doMock('@upstash/redis', () => ({ Redis: class { eval = evaluate; } }));
  try {
    const s = upstashStorage('https://redis.example.invalid', 'test-token');
    const next = { version: 1, hiddenPosts: ['a'.repeat(64)] };
    expect(await s.compareAndSet('totem:settings', null, next)).toBe(true);
    expect(await s.compareAndSet('totem:settings', 0, next)).toBe(false);
    expect(await s.compareAndSet('totem:settings', 2, { ...next, version: 3 })).toBe(true);
    expect(evaluate.mock.calls.map(([, keys, args]) => [keys, args])).toEqual([
      [['totem:settings'], [-1, JSON.stringify(next)]],
      [['totem:settings'], [0, JSON.stringify(next)]],
      [['totem:settings'], [2, JSON.stringify({ ...next, version: 3 })]],
    ]);
  } finally { vi.doUnmock('@upstash/redis'); }
});

describe('sesiones revocables', () => {
  const PASS = 'clave-de-prueba', SECRET = 's'.repeat(32);
  const req = (method: string, path: string, body?: unknown, cookie?: string): ApiRequest =>
    ({ method, path, body, ip: '1.1.1.1', headers: { 'content-type': 'application/json', cookie } });
  const setup = () => {
    let now = 1_000_000;
    const storage = memoryStorage(() => now);
    const d: Deps = { storage, env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: SECRET }, now: () => now };
    const login = async () => String((await handle(req('POST', '/api/login', { password: PASS }), d)).headers['set-cookie']).split(';')[0];
    const authed = async (cookie: string) => ((await handle(req('GET', '/api/session', undefined, cookie), d)).body as any).authed;
    return { d, storage, login, authed, advance: (ms: number) => { now += ms; } };
  };
  it('cada token lleva un jti distinto y su vencimiento', () => {
    const now = 1_000_000;
    const a = readSession(signSession(SECRET, now, 3600), SECRET, now)!, b = readSession(signSession(SECRET, now, 3600), SECRET, now)!;
    expect(a.jti).toMatch(/^[A-Za-z0-9_-]{16,}$/);
    expect(a.jti).not.toBe(b.jti);
    expect(a.exp).toBe(now + 3600_000);
    expect(readSession(signSession(SECRET, now, 3600), 'x'.repeat(32), now)).toBeNull();
  });
  it('rechaza tokens firmados del formato antiguo sin jti', async () => {
    const payload = Buffer.from(JSON.stringify({ exp: 4_600_000 })).toString('base64url');
    const { createHmac } = await import('node:crypto');
    const tok = `${payload}.${createHmac('sha256', SECRET).update(payload).digest('base64url')}`;
    expect(readSession(tok, SECRET, 1_000_000)).toBeNull();
  });
  it('logout invalida la cookie copiada para settings, moderación y sesión, sin afectar otro dispositivo', async () => {
    const { d, login, authed } = setup();
    const cookie = await login(), other = await login();
    expect(await authed(cookie)).toBe(true);
    const out = await handle(req('POST', '/api/logout', undefined, cookie), d);
    expect(out.status).toBe(200);
    expect(String(out.headers['set-cookie'])).toMatch(/^totem_session=;.*Max-Age=0/);
    expect(await authed(cookie)).toBe(false);
    expect((await handle(req('PUT', '/api/settings', { announcement: 'x' }, cookie), d)).status).toBe(401);
    expect((await handle(req('POST', '/api/moderation', { action: 'hide', id: 'a'.repeat(64) }, cookie), d)).status).toBe(401);
    expect((await handle(req('GET', '/api/settings', undefined, cookie), d)).headers['cache-control']).not.toBe('private, no-store');
    expect(await authed(other)).toBe(true);
  });
  it('la revocación expira al vencer la sesión, no antes', async () => {
    const { d, storage, login, advance } = setup();
    const cookie = await login();
    const set = vi.spyOn(storage, 'set');
    advance(600_000);
    await handle(req('POST', '/api/logout', undefined, cookie), d);
    const [key, , ttl] = set.mock.calls.find(([k]) => k.startsWith('totem:revoked:'))!;
    expect(ttl).toBe(3000);
    expect(await storage.get(key)).toBe(1);
    advance(3000_000);
    expect(await storage.get(key)).toBeNull();
  });
  it('cookies inválidas no provocan lecturas ni escrituras de revocación', async () => {
    const { d, storage } = setup();
    const get = vi.spyOn(storage, 'get'), set = vi.spyOn(storage, 'set');
    await handle(req('POST', '/api/logout', undefined, 'totem_session=a.b'), d);
    await handle(req('GET', '/api/session', undefined, 'totem_session=a.b'), d);
    expect(get).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
  });
});
