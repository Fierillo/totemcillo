import { describe, expect, it, vi } from 'vitest';
import { handle, PUBLIC_SNAPSHOT_MS, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import vercelAvatar from '../server/avatar';

// Rule: an open phone must never make the server read Redis; only the snapshot refresh (bounded in time) does.
const PASS = 'clave-de-prueba';
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): ApiRequest =>
  ({ method, path, body, ip: '9.9.9.9', headers: { 'content-type': 'application/json', ...headers } });
const PUBLIC = ['/api/settings', '/api/kiosk', '/api/version'];

const redisMock = () => {
  const storage = memoryStorage();
  const calls = { get: vi.spyOn(storage, 'get'), set: vi.spyOn(storage, 'set'), incr: vi.spyOn(storage, 'incr'), cas: vi.spyOn(storage, 'compareAndSet') };
  const total = () => Object.values(calls).reduce((n, c) => n + c.mock.calls.length, 0);
  return { storage, total };
};

describe('visitantes (móvil / público) no consumen Redis', () => {
  it('cientos de GETs públicos dentro de la ventana del snapshot no tocan Redis, con o sin cookie de admin', async () => {
    let t = 1_000_000;
    const { storage, total } = redisMock();
    const d: Deps = { storage, env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: 's'.repeat(32) }, now: () => t };
    const login = await handle(req('POST', '/api/login', { password: PASS }), d);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    await handle(req('GET', '/api/kiosk'), d); // central refresh: the only read in the window
    const before = total();
    for (let i = 0; i < 300; i++) {
      t += 50;
      const r = await handle(req('GET', PUBLIC[i % 3], undefined, i % 2 ? { cookie } : {}), d);
      expect(r.status).toBe(200);
      expect(r.headers['cache-control']).toMatch(/^public/);
    }
    expect(t - 1_000_000).toBeLessThan(PUBLIC_SNAPSHOT_MS);
    expect(total()).toBe(before);
    // After the window, one refresh per instance (not per visitor).
    t += PUBLIC_SNAPSHOT_MS;
    for (let i = 0; i < 50; i++) await handle(req('GET', PUBLIC[i % 3]), d);
    expect(total()).toBe(before + 1);
  });

  it('un cambio del admin se ve enseguida en la misma instancia (sin leer Redis)', async () => {
    const { storage, total } = redisMock();
    const d: Deps = { storage, env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: 's'.repeat(32) }, now: () => 5_000_000 };
    const cookie = String((await handle(req('POST', '/api/login', { password: PASS }), d)).headers['set-cookie']).split(';')[0];
    await handle(req('GET', '/api/settings'), d);
    expect((await handle(req('PUT', '/api/settings', { announcement: 'nuevo' }, { cookie }), d)).status).toBe(200);
    const n = total();
    expect((await handle(req('GET', '/api/settings'), d)).body).toMatchObject({ announcement: 'nuevo' });
    expect(total()).toBe(n);
  });

  it('el proxy de avatares en producción no usa Redis (límite por instancia): sin credenciales de Redis no da 503', async () => {
    const saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (/UPSTASH|KV_REST/.test(k)) delete process.env[k];
    try {
      const res: any = { statusCode: 0, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, end() {} };
      await vercelAvatar({ method: 'GET', url: '/api/avatar?url=nope', headers: {}, socket: {} } as any, res);
      expect(res.statusCode).toBe(400);
    } finally { Object.assign(process.env, saved); }
  });
});
