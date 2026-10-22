import { describe, expect, it, vi } from 'vitest';
import { handle, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import { DEFAULT_SETTINGS, DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS, LIMITS } from '../shared/settings';
import { clientIp, nodeHandler } from '../server/node';

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
    expect(c).not.toContain('Secure'); // localhost over HTTP
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
  it('flechas cambian la agenda sin persistir comandos ni secuencias antiguas', async () => {
    const d = deps();
    const { cookie } = await login(d);
    await d.storage.set('totem:settings', { ...DEFAULT_SETTINGS, command: { seq: 8, action: 'prev' } });
    const before = (await handle(req('GET', '/api/kiosk'), d)).body as { epoch: number };
    const next = await handle(req('PUT', '/api/settings', { command: 'next' }, { cookie }), d);
    expect(next.status).toBe(200);
    expect(next.body).not.toHaveProperty('command');
    expect((next.body as { epoch: number }).epoch).not.toBe(before.epoch);
    await handle(req('PUT', '/api/settings', { command: 'prev' }, { cookie }), d);
    expect(await d.storage.get('totem:settings')).not.toHaveProperty('command');
  });
});

it('ruta desconocida → 404', async () => {
  expect((await handle(req('GET', '/api/nada'), deps())).status).toBe(404);
});

describe('ajustes de inicio y proveedores', () => {
  it('settings y kiosk comparten los defaults', async () => {
    const d = deps();
    expect(Number.isFinite(Date.parse(DEFAULT_START_LINE))).toBe(true);
    for (const path of ['/api/settings', '/api/kiosk']) {
      expect((await handle(req('GET', path), d)).body).toMatchObject({ startLine: DEFAULT_START_LINE, zapProviders: DEFAULT_ZAP_PROVIDERS });
    }
  });
  it('valida y guarda inicio ISO con zona, incrementando versión sin mover la agenda', async () => {
    const d = deps({ now: () => Date.parse('2026-10-15T05:00:00Z') }), { cookie } = await login(d);
    const put = (startLine: unknown) => handle(req('PUT', '/api/settings', { startLine }, { cookie }), d);
    const startLine = '2026-10-14T21:30:00-03:00', r = await put(startLine);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ startLine, version: 1 });
    expect(r.body).not.toHaveProperty('epoch');
    expect((await handle(req('GET', '/api/kiosk'), d)).body).toMatchObject({ startLine });
    expect((await put('2026-10-14T21:30:00Z')).status).toBe(200);
    for (const bad of [5, '', 'mañana', '2026-10-13', '2026-10-13T21:00', '2026-13-40T99:00:00-03:00', '2027-12-01T00:00:00-03:00', '2019-01-01T00:00:00Z']) {
      expect((await put(bad)).status, String(bad)).toBe(400);
    }
  });
  it('normaliza y deduplica hostnames, valida el límite y acepta una lista vacía', async () => {
    const d = deps(), { cookie } = await login(d);
    const put = (zapProviders: unknown) => handle(req('PUT', '/api/settings', { zapProviders }, { cookie }), d);
    const r = await put(['GetAlby.com', 'getalby.com', ' mi.wallet.ar ']);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ zapProviders: ['getalby.com', 'mi.wallet.ar'], version: 1 });
    expect(r.body).not.toHaveProperty('epoch');
    for (const bad of ['getalby.com', [1], ['https://x.com'], ['a@b.com'], ['sin-punto'], ['-x.com'], ['x..com'], ['a'.repeat(64) + '.com'], Array.from({ length: LIMITS.maxZapProviders + 1 }, (_, i) => `p${i}.com`)]) {
      expect((await put(bad)).status).toBe(400);
    }
    expect((await put([])).body).toMatchObject({ zapProviders: [] });
    expect((await handle(req('GET', '/api/kiosk'), d)).body).toMatchObject({ zapProviders: [] });
  });
});

describe('caché pública y lecturas privadas', () => {
  const observed = () => {
    const d = deps(), get = vi.spyOn(d.storage, 'get');
    return { d, get };
  };
  it.each(['/api/kiosk', '/api/version', '/api/settings'])('%s canoniza cualquier query sin leer almacenamiento', async (path) => {
    const { d, get } = observed();
    for (const query of ['v=123', 'x=1&y=2', '?']) {
      const r = await handle({ ...req('GET', path), query }, d);
      expect(r.status).toBe(308);
      expect(r.headers.location).toBe(path);
      expect(r.headers['cache-control']).toMatch(/public/);
      expect(r.headers['cache-control']).toMatch(/s-maxage=\d{4,}/);
    }
    expect(get).not.toHaveBeenCalled();
  });
  it.each(['/api/kiosk', '/api/version', '/api/settings'])('%s sin query usa caché CDN corta sin Vary: Cookie', async (path) => {
    const r = await handle(req('GET', path), deps());
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('public, max-age=0, s-maxage=20, stale-while-revalidate=20');
    expect(r.headers.vary ?? '').not.toMatch(/cookie/i);
  });
  it.each([['GET', '/api/session'], ['POST', '/api/login'], ['POST', '/api/logout'], ['PUT', '/api/settings']])('endpoints de admin nunca se cachean: %s %s', async (method, path) => {
    expect((await handle(req(method, path, {}), deps())).headers['cache-control']).toBe('no-store');
  });
  it('/api/time nunca lee almacenamiento ni usa caché, con o sin query', async () => {
    const { d, get } = observed();
    for (const query of [undefined, 'v=1']) {
      const r = await handle({ ...req('GET', '/api/time'), query }, d);
      expect(r.status).toBe(200);
      expect(r.body).toEqual({ now: d.now() });
      expect(r.headers['cache-control']).toBe('no-store');
    }
    expect(get).not.toHaveBeenCalled();
  });
  it('el adaptador HTTP conserva la query y devuelve la redirección', async () => {
    const headers: Record<string, string> = {};
    const res: any = { statusCode: 0, setHeader: (k: string, v: string) => { headers[k] = v; }, end: vi.fn() };
    await nodeHandler({ method: 'GET', url: '/api/kiosk?v=9', headers: {}, socket: {}, body: null } as any, res, deps());
    expect(res.statusCode).toBe(308);
    expect(headers.location).toBe('/api/kiosk');
  });
  it('GET /api/settings es público aun con sesión; la sesión usa lecturas privadas y frescas', async () => {
    const d = deps(), { cookie } = await login(d);
    expect((await handle(req('GET', '/api/settings', undefined, { cookie }), d)).headers['cache-control']).toMatch(/^public, max-age=0, s-maxage=\d+/);
    const r = await handle(req('GET', '/api/session', undefined, { cookie }), d);
    expect(r.body).toMatchObject({ authed: true, settings: { announcement: expect.any(String) } });
    expect(r.headers['cache-control']).toBe('private, no-store');
    const anon = await handle(req('GET', '/api/session'), d);
    expect(anon.body).toEqual({ authed: false });
    expect(anon.headers['cache-control']).toMatch(/no-store/);
  });
  it('ninguna respuesta con Set-Cookie es cacheable públicamente', async () => {
    const d = deps();
    for (const r of [await handle(req('POST', '/api/login', { password: PASS }), d), await handle(req('POST', '/api/logout'), d)]) {
      expect(r.headers['set-cookie']).toBeDefined();
      expect(r.headers['cache-control']).toMatch(/no-store/);
      expect(r.headers['cache-control']).not.toMatch(/public|s-maxage/);
    }
  });
});

it('identifica la IP del cliente usando cabeceras de plataforma, proxy y socket en orden', () => {
  expect(clientIp({ 'x-vercel-forwarded-for': '9.9.9.9', 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7' }, '1.1.1.1')).toBe('9.9.9.9');
  expect(clientIp({ 'x-real-ip': '8.8.8.8', 'x-forwarded-for': '7.7.7.7, 6.6.6.6' }, '1.1.1.1')).toBe('8.8.8.8');
  expect(clientIp({ 'x-forwarded-for': '7.7.7.7, 6.6.6.6' }, '1.1.1.1')).toBe('7.7.7.7');
  expect(clientIp({}, '1.1.1.1')).toBe('1.1.1.1');
  expect(clientIp({}, undefined)).toBe('desconocida');
});

it('dev permite la red local, preview usa loopback y ambos rechazan túneles no autorizados', async () => {
  const { createServer, preview } = await import('vite');
  const { get } = await import('node:http');
  for (const mode of ['dev', 'preview']) {
    const server = mode === 'dev'
      ? await createServer({ logLevel: 'silent', server: { port: 0 } })
      : await preview({ logLevel: 'silent', preview: { port: 0 } });
    try {
      if ('listen' in server) await server.listen();
      const address = server.httpServer!.address();
      expect(address && typeof address === 'object').toBe(true);
      if (!address || typeof address === 'string') throw new Error('missing listener');
      if (mode === 'dev') expect(address.address).toBe('0.0.0.0');
      else expect(['127.0.0.1', '::1']).toContain(address.address);
      const host = mode === 'dev' ? '127.0.0.1' : address.family === 'IPv6' ? `[${address.address}]` : address.address;
      const base = `http://${host}:${address.port}`;
      const response = await fetch(`${base}/api/session`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ authed: false });
      for (const host of ['demo.ngrok-free.app', 'demo.ngrok-free.dev', 'demo.ngrok.app', 'demo.ngrok.io']) {
        const status = await new Promise<number | undefined>((resolve, reject) => {
          get(`${base}/`, { headers: { host } }, (res) => { res.resume(); resolve(res.statusCode); }).on('error', reject);
        });
        expect(status).toBe(403);
      }
    } finally { await server.close(); }
  }
}, 15_000);

// Table: every production entry point (API and avatar proxy) fails closed without full Redis config.
const productionEntries = [
  ['API', () => import('../server/node'), '/api/session'],
  ['proxy de avatares', () => import('../server/avatar'), '/api/avatar'],
] as const;
const incompleteRedis = [['', ''], ['https://redis.example.invalid', ''], ['', 'test-token']] as const;
it.each(productionEntries.flatMap(([name, load, url]) => incompleteRedis.map(([redisUrl, token]) => [name, load, url, redisUrl, token] as const)))(
  'producción (%s) responde 503 sin caché ni memoria si falta URL o token de Redis', async (_name, load, url, redisUrl, token) => {
    try {
      vi.stubEnv('UPSTASH_REDIS_REST_URL', redisUrl);
      vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', token);
      vi.resetModules();
      const { default: production } = await load();
      const headers: Record<string, string> = {};
      const res: any = { statusCode: 0, setHeader: (k: string, v: string) => { headers[k] = v; }, end: vi.fn() };
      await production({ method: 'GET', url, headers: {}, socket: {}, body: null } as any, res);
      expect(res.statusCode).toBe(503);
      expect(headers['cache-control']).toBe('no-store');
      expect(JSON.parse(res.end.mock.calls[0][0])).toEqual({ error: 'servicio no disponible' });
    } finally { vi.unstubAllEnvs(); }
  });

it('producción vuelve a funcionar con ajustes de Redis cuando se completa la configuración', async () => {
  const get = vi.fn(async () => ({ announcement: 'ajuste compartido' }));
  vi.doMock('@upstash/redis', () => ({ Redis: class { get = get; } }));
  try {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.invalid');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.resetModules();
    const { default: production } = await import('../server/node');
    const request: any = { method: 'GET', url: '/api/settings', headers: {}, socket: {}, body: null };
    const res: any = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    // First request with incomplete config (the 503 itself is covered by the table test above).
    await production(request, res);
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'test-token');
    await production(request, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.end.mock.lastCall![0])).toMatchObject({ announcement: 'ajuste compartido' });
    expect(get).toHaveBeenCalledWith('totem:settings');
  } finally { vi.unstubAllEnvs(); vi.doUnmock('@upstash/redis'); }
});

it('producción carga la agenda con los nombres reales de la integración Upstash instalada en Vercel', async () => {
  const connect = vi.fn();
  const get = vi.fn(async () => ({ announcement: 'agenda de Redis', version: 7 }));
  vi.doMock('@upstash/redis', () => ({ Redis: class {
    constructor(options: unknown) { connect(options); }
    get = get;
  } }));
  try {
    vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
    vi.stubEnv('UPSTASH_REDIS_REST_KV_REST_API_URL', 'https://redis.example.invalid');
    vi.stubEnv('UPSTASH_REDIS_REST_KV_REST_API_TOKEN', 'integration-token');
    vi.resetModules();
    const { default: production } = await import('../server/node');
    const res: any = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() };
    await production({ method: 'GET', url: '/api/kiosk', headers: {}, socket: {}, body: null } as any, res);
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.end.mock.lastCall![0])).toMatchObject({ announcement: 'agenda de Redis', version: 7, epoch: expect.any(Number) });
    expect(connect).toHaveBeenCalledWith({ url: 'https://redis.example.invalid', token: 'integration-token' });
    expect(get).toHaveBeenCalledWith('totem:settings');
  } finally { vi.unstubAllEnvs(); vi.doUnmock('@upstash/redis'); }
});
