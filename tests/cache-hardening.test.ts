import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handle, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import { clientIp, nodeHandler } from '../server/node';
import { avatarHandler, AVATAR_RATE, type Fetcher } from '../server/avatar';

const PASS = 'clave-de-prueba';
const deps = (): Deps & { get: ReturnType<typeof vi.fn> } => {
  const storage = memoryStorage();
  const get = vi.fn(storage.get.bind(storage));
  return { storage: { ...storage, get }, env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: 's'.repeat(32) }, now: () => 1_000_000, get } as any;
};
const req = (method: string, path: string, o: Partial<ApiRequest> = {}): ApiRequest =>
  ({ method, path, body: undefined, ip: '1.1.1.1', headers: { 'content-type': 'application/json' }, ...o });
const login = async (d: Deps) => String((await handle({ ...req('POST', '/api/login'), body: { password: PASS } }, d)).headers['set-cookie']).split(';')[0];

describe('endpoints públicos cacheables: la query no rompe la caché del CDN', () => {
  it.each(['/api/kiosk', '/api/version', '/api/settings'])('%s?x → 308 a la ruta canónica, sin leer Redis', async (path) => {
    const d = deps();
    for (const query of ['v=123', 'x=1&y=2', '']) {
      const r = await handle(req('GET', path, { query: query || '?' }), d);
      expect(r.status).toBe(308);
      expect(r.headers.location).toBe(path);
      expect(r.headers['cache-control']).toMatch(/public/);
      expect(r.headers['cache-control']).toMatch(/s-maxage=\d{4,}/);
    }
    expect(d.get).not.toHaveBeenCalled();
  });
  it.each(['/api/kiosk', '/api/version', '/api/settings'])('%s sin query → caché corta del CDN', async (path) => {
    const r = await handle(req('GET', path), deps());
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=0, s-maxage=5, stale-while-revalidate=5');
    expect(r.headers.vary ?? '').not.toMatch(/cookie/i);
  });
  it('/api/time no lee Redis y nunca se cachea (con o sin query)', async () => {
    const d = deps();
    const r = await handle(req('GET', '/api/time', { query: 'v=1' }), d);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
    expect(d.get).not.toHaveBeenCalled();
  });
  it('nodeHandler pasa la query y responde la redirección', async () => {
    const headers: Record<string, string> = {};
    const res: any = { statusCode: 0, setHeader: (k: string, v: string) => { headers[k] = v; }, end: vi.fn() };
    await nodeHandler({ method: 'GET', url: '/api/kiosk?v=9', headers: {}, socket: {}, body: null } as any, res, deps());
    expect(res.statusCode).toBe(308);
    expect(headers.location).toBe('/api/kiosk');
  });
});

describe('/api/settings: público cacheable, admin privado', () => {
  it('con sesión válida → private, no-store', async () => {
    const d = deps();
    const cookie = await login(d);
    const r = await handle(req('GET', '/api/settings', { headers: { cookie } }), d);
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('private, no-store');
  });
  it('/api/session con sesión trae los settings frescos (private, no-store); sin sesión no', async () => {
    const d = deps();
    const cookie = await login(d);
    const r = await handle(req('GET', '/api/session', { headers: { cookie } }), d);
    expect(r.body).toMatchObject({ authed: true, settings: { announcement: expect.any(String) } });
    expect(r.headers['cache-control']).toBe('private, no-store');
    const anon = await handle(req('GET', '/api/session'), d);
    expect(anon.body).toEqual({ authed: false });
    expect(anon.headers['cache-control']).toMatch(/no-store/);
  });
  it('ninguna respuesta con set-cookie es cacheable públicamente', async () => {
    const d = deps();
    for (const r of [await handle({ ...req('POST', '/api/login'), body: { password: PASS } }, d), await handle(req('POST', '/api/logout'), d)]) {
      expect(r.headers['set-cookie']).toBeDefined();
      expect(r.headers['cache-control']).toMatch(/no-store/);
      expect(r.headers['cache-control']).not.toMatch(/public|s-maxage/);
    }
  });
  it('el admin lee los settings por /api/session (no por el GET cacheado)', () => {
    const src = readFileSync('src/admin.ts', 'utf8');
    expect(src).not.toMatch(/api\('\/api\/settings'\)\)/);
    expect(src).toMatch(/api\('\/api\/session'\)/);
  });
  it('el tótem pide /api/kiosk sin query', () => {
    expect(readFileSync('src/follow.ts', 'utf8')).not.toMatch(/\/api\/kiosk\?/);
  });
});

describe('clientIp (misma lógica para login y avatar)', () => {
  it('prefiere x-vercel-forwarded-for, luego x-real-ip, luego x-forwarded-for, luego el socket', () => {
    expect(clientIp({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7' }, '1.1.1.1')).toBe('9.9.9.9');
    expect(clientIp({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7, 6.6.6.6' }, '1.1.1.1')).toBe('8.8.8.8');
    expect(clientIp({ 'x-forwarded-for': '7.7.7.7, 6.6.6.6' }, '1.1.1.1')).toBe('7.7.7.7');
    expect(clientIp({}, '1.1.1.1')).toBe('1.1.1.1');
    expect(clientIp({}, undefined)).toBe('desconocida');
  });
});

describe('/api/avatar: límite por IP', () => {
  const run = async (storage: any, ip: string, fetcher: Fetcher) => {
    const headers: Record<string, string> = {};
    const res: any = { statusCode: 0, setHeader: (k: string, v: string) => { headers[k] = v; }, end: vi.fn() };
    await avatarHandler({ method: 'GET', url: '/api/avatar?url=' + encodeURIComponent('https://img.example/a.png'), headers: { 'x-vercel-forwarded-for': ip }, socket: {} } as any, res, { fetcher, storage });
    return { status: res.statusCode, headers };
  };
  it(`pasado el límite (${'60'}/10 min) → 429 no-store sin descargar nada`, async () => {
    expect(AVATAR_RATE).toEqual({ max: 60, windowSec: 600 });
    const storage = memoryStorage();
    const fetcher = vi.fn<Fetcher>(async () => { throw new Error('offline'); });
    for (let i = 0; i < 60; i++) expect((await run(storage, '5.5.5.5', fetcher)).status).toBe(502);
    const over = await run(storage, '5.5.5.5', fetcher);
    expect(over.status).toBe(429);
    expect(over.headers['cache-control']).toBe('no-store');
    expect(fetcher).toHaveBeenCalledTimes(60);
    expect((await run(storage, '6.6.6.6', fetcher)).status).toBe(502); // other IPs unaffected
  });
  it('URL inválida → 400 sin gastar cupo ni tocar Redis', async () => {
    const storage = { ...memoryStorage(), incr: vi.fn() };
    const res: any = { statusCode: 0, setHeader() {}, end() {} };
    await avatarHandler({ method: 'GET', url: '/api/avatar?url=http%3A%2F%2Fx', headers: {}, socket: {} } as any, res, { storage });
    expect(res.statusCode).toBe(400);
    expect(storage.incr).not.toHaveBeenCalled();
  });
});
