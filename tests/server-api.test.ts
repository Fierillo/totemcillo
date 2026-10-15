import { describe, expect, it } from 'vitest';
import { handle, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import { DEFAULT_SETTINGS, LIMITS } from '../server/settings';

const PASS = 'clave-de-prueba';
const deps = (over: Partial<Deps> = {}): Deps => ({
  storage: memoryStorage(), env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: 's'.repeat(32) }, now: () => 1_000_000, ...over,
});
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}, ip = '1.1.1.1'): ApiRequest =>
  ({ method, path, body, ip, headers: { 'content-type': 'application/json', ...headers } });
const login = async (d: Deps) => {
  const r = await handle(req('POST', '/api/login', { password: PASS }), d);
  const cookie = String(r.headers['set-cookie']).split(';')[0];
  return { r, cookie };
};

describe('GET /api/settings (público)', () => {
  it('devuelve los valores por defecto', async () => {
    const r = await handle(req('GET', '/api/settings'), deps());
    expect(r.status).toBe(200);
    expect(r.body).toEqual(DEFAULT_SETTINGS);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});

describe('POST /api/login', () => {
  it('clave incorrecta → 401 sin cookie', async () => {
    const r = await handle(req('POST', '/api/login', { password: 'nop' }), deps());
    expect(r.status).toBe(401);
    expect(r.headers['set-cookie']).toBeUndefined();
  });
  it('clave correcta → cookie de sesión HttpOnly, SameSite=Strict y vencimiento corto', async () => {
    const { r } = await login(deps());
    expect(r.status).toBe(200);
    const c = String(r.headers['set-cookie']);
    expect(c).toMatch(/^totem_session=[^;]+\.[^;]+;/);
    for (const flag of ['HttpOnly', 'SameSite=Strict', 'Path=/', 'Max-Age=3600']) expect(c).toContain(flag);
    expect(c).not.toContain('Secure'); // localhost sobre HTTP
    expect(JSON.stringify(r.body)).not.toContain(PASS);
  });
  it('en HTTPS marca la cookie Secure', async () => {
    const r = await handle(req('POST', '/api/login', { password: PASS }, { 'x-forwarded-proto': 'https' }), deps());
    expect(String(r.headers['set-cookie'])).toContain('Secure');
  });
  it('sin ADMIN_PASSWORD o SESSION_SECRET (o secreto corto) responde 503: falla cerrado', async () => {
    for (const env of [{ SESSION_SECRET: 's'.repeat(32) }, { ADMIN_PASSWORD: PASS }, { ADMIN_PASSWORD: PASS, SESSION_SECRET: 'corto' }])
      expect((await handle(req('POST', '/api/login', { password: PASS }), deps({ env }))).status).toBe(503);
  });
  it('limita intentos por IP (10 cada 10 min) aunque después acierte', async () => {
    const d = deps();
    for (let i = 0; i < 10; i++) expect((await handle(req('POST', '/api/login', { password: 'mal' }), d)).status).toBe(401);
    const r = await handle(req('POST', '/api/login', { password: PASS }), d);
    expect(r.status).toBe(429);
    expect((await handle(req('POST', '/api/login', { password: PASS }, {}, '2.2.2.2'), d)).status).toBe(200);
  });
  it('sólo POST', async () => {
    expect((await handle(req('GET', '/api/login'), deps())).status).toBe(405);
  });
});

describe('sesión y logout', () => {
  it('GET /api/session dice si estás logueado; logout borra la cookie', async () => {
    const d = deps();
    expect((await handle(req('GET', '/api/session'), d)).body).toEqual({ authed: false });
    const { cookie } = await login(d);
    expect((await handle(req('GET', '/api/session', undefined, { cookie }), d)).body).toEqual({ authed: true });
    const out = await handle(req('POST', '/api/logout', undefined, { cookie }), d);
    expect(String(out.headers['set-cookie'])).toContain('Max-Age=0');
  });
  it('la sesión vence', async () => {
    let now = 1_000_000;
    const d = deps({ now: () => now });
    const { cookie } = await login(d);
    now += 3601_000;
    expect((await handle(req('PUT', '/api/settings', { announcement: 'x' }, { cookie }), d)).status).toBe(401);
  });
});

describe('PUT /api/settings (requiere sesión)', () => {
  it('sin cookie o con cookie falsa → 401', async () => {
    const d = deps();
    expect((await handle(req('PUT', '/api/settings', { announcement: 'x' }), d)).status).toBe(401);
    expect((await handle(req('PUT', '/api/settings', { announcement: 'x' }, { cookie: 'totem_session=a.b' }), d)).status).toBe(401);
  });
  it('exige JSON (defensa CSRF junto con SameSite=Strict)', async () => {
    const d = deps();
    const { cookie } = await login(d);
    expect((await handle(req('PUT', '/api/settings', 'announcement=x', { cookie, 'content-type': 'application/x-www-form-urlencoded' }), d)).status).toBe(415);
  });
  it('guarda anuncio (recortado) y duraciones; GET los devuelve', async () => {
    const d = deps();
    const { cookie } = await login(d);
    const r = await handle(req('PUT', '/api/settings', { announcement: '  <b>Hola</b> stand  ', sceneDurations: { post: 20000, anuncio: 3000 } }, { cookie }), d);
    expect(r.status).toBe(200);
    const g = (await handle(req('GET', '/api/settings'), d)).body as typeof DEFAULT_SETTINGS;
    expect(g.announcement).toBe('<b>Hola</b> stand');
    expect(g.sceneDurations).toEqual({ post: 20000, anuncio: 3000 });
  });
  it('valida: anuncio ≤ 280, duraciones entre 3 y 120 s, escenas conocidas', async () => {
    const d = deps();
    const { cookie } = await login(d);
    expect(LIMITS).toEqual({ maxAnnouncement: 280, minMs: 3000, maxMs: 120000, minEveryCycles: 1, maxEveryCycles: 10, minClipSeconds: 3, maxClipSeconds: 120, maxVideoSec: 3600, maxModeration: 1000 });
    for (const bad of [{ announcement: 'x'.repeat(281) }, { announcement: 5 }, { sceneDurations: { post: 2999 } }, { sceneDurations: { post: 120001 } },
      { sceneDurations: { post: '10000' } }, { sceneDurations: { hackeo: 5000 } }, { sceneDurations: { video: 30000 } }, { command: 'reboot' }, [], null])
      expect((await handle(req('PUT', '/api/settings', bad, { cookie }), d)).status, JSON.stringify(bad)).toBe(400);
    expect((await handle(req('GET', '/api/settings'), d)).body).toEqual(DEFAULT_SETTINGS);
  });
  it('videoEveryCycles: entero de 1 a 10, se guarda y se lee', async () => {
    const d = deps();
    const { cookie } = await login(d);
    for (const bad of [0, 11, 2.5, '3', null])
      expect((await handle(req('PUT', '/api/settings', { videoEveryCycles: bad }, { cookie }), d)).status, String(bad)).toBe(400);
    expect((await handle(req('PUT', '/api/settings', { videoEveryCycles: 3 }, { cookie }), d)).status).toBe(200);
    expect(((await handle(req('GET', '/api/settings'), d)).body as { videoEveryCycles?: number }).videoEveryCycles).toBe(3);
    await handle(req('PUT', '/api/settings', { announcement: 'x' }, { cookie }), d);
    expect(((await handle(req('GET', '/api/settings'), d)).body as { videoEveryCycles?: number }).videoEveryCycles).toBe(3);
  });
  it('videoMode: full o clip, se guarda y se lee', async () => {
    const d = deps();
    const { cookie } = await login(d);
    for (const bad of ['loop', '', 1, null])
      expect((await handle(req('PUT', '/api/settings', { videoMode: bad }, { cookie }), d)).status, String(bad)).toBe(400);
    expect((await handle(req('PUT', '/api/settings', { videoMode: 'clip' }, { cookie }), d)).status).toBe(200);
    await handle(req('PUT', '/api/settings', { announcement: 'x' }, { cookie }), d);
    expect(((await handle(req('GET', '/api/settings'), d)).body as { videoMode?: string }).videoMode).toBe('clip');
  });
  it('videoClipSeconds: entero de 3 a 120, se guarda y se lee', async () => {
    const d = deps();
    const { cookie } = await login(d);
    for (const bad of [2, 121, 10.5, '21', null])
      expect((await handle(req('PUT', '/api/settings', { videoClipSeconds: bad }, { cookie }), d)).status, String(bad)).toBe(400);
    expect((await handle(req('PUT', '/api/settings', { videoClipSeconds: 30 }, { cookie }), d)).status).toBe(200);
    await handle(req('PUT', '/api/settings', { announcement: 'x' }, { cookie }), d);
    expect(((await handle(req('GET', '/api/settings'), d)).body as { videoClipSeconds?: number }).videoClipSeconds).toBe(30);
  });
  it('comandos remotos ← → con secuencia creciente', async () => {
    const d = deps();
    const { cookie } = await login(d);
    await handle(req('PUT', '/api/settings', { command: 'next' }, { cookie }), d);
    await handle(req('PUT', '/api/settings', { command: 'prev' }, { cookie }), d);
    const g = (await handle(req('GET', '/api/settings'), d)).body as typeof DEFAULT_SETTINGS;
    expect(g.command).toEqual({ seq: 2, action: 'prev' });
  });
});

it('ruta desconocida → 404', async () => {
  expect((await handle(req('GET', '/api/nada'), deps())).status).toBe(404);
});
