import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { avatarHandler, AVATAR_RATE, fetchAvatar, isBlockedIp, parseAvatarUrl, readLimited, renderAvatar, safeLookup, devAvatarFetcher, type Fetcher } from '../server/avatar';
import { memoryStorage } from '../server/storage';

const png = (w: number, h: number) => sharp({ create: { width: w, height: h, channels: 3, background: '#f00' } }).png().toBuffer();
async function* chunks(...bs: Uint8Array[]) { for (const b of bs) yield b; }
const okFetcher = (body: Uint8Array, type = 'image/png'): Fetcher => async () => ({ status: 200, headers: { 'content-type': type }, body: chunks(body) });

describe('parseAvatarUrl', () => {
  it.each(['https://img.example/a.png', 'https://img.example/a?x=1'])('acepta %s', (u) => expect(parseAvatarUrl(u)).not.toBeNull());
  it.each(['http://img.example/a.png', 'javascript:alert(1)', 'file:///etc/passwd', 'https://u:p@img.example/a', 'https://img.example:8443/a', 'no-url', '', undefined])(
    'rechaza %s', (u) => expect(parseAvatarUrl(u as any)).toBeNull());
  it('rechaza IPs literales privadas', () => {
    expect(parseAvatarUrl('https://127.0.0.1/a')).toBeNull();
    expect(parseAvatarUrl('https://[::1]/a')).toBeNull();
    expect(parseAvatarUrl('https://169.254.169.254/latest')).toBeNull();
  });
});

describe('isBlockedIp', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '0.0.0.0', '100.64.0.1', '::1', '::', 'fe80::1', 'fc00::1', 'fd12::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', '224.0.0.1', 'garbage'])(
    'bloquea %s', (ip) => expect(isBlockedIp(ip)).toBe(true));
  it.each(['1.1.1.1', '93.184.216.34', '2606:4700:4700::1111'])('permite %s', (ip) => expect(isBlockedIp(ip)).toBe(false));
});

describe('safeLookup (después de resolver DNS)', () => {
  const stub = (address: string, family = 4) => ((_h: string, _o: any, cb: any) => cb(null, [{ address, family }])) as any;
  const run = (lookup: any) => new Promise<{ err: any; addr: any }>((r) => safeLookup(lookup)('evil.example', { all: false }, (err: any, addr: any) => r({ err, addr })));
  it('bloquea un host que resuelve a loopback/metadata', async () => {
    expect((await run(stub('127.0.0.1'))).err).toBeTruthy();
    expect((await run(stub('169.254.169.254'))).err).toBeTruthy();
  });
  it('deja pasar una IP pública', async () => {
    const r = await run(stub('93.184.216.34'));
    expect(r.err).toBeFalsy();
    expect(r.addr).toBe('93.184.216.34');
  });
});

describe('readLimited', () => {
  it('corta al pasar el máximo', async () => {
    await expect(readLimited(chunks(new Uint8Array(600), new Uint8Array(600)), 1000)).rejects.toThrow(/large/);
  });
  it('junta lo que entra', async () => {
    expect((await readLimited(chunks(new Uint8Array(3), new Uint8Array(4)), 10)).length).toBe(7);
  });
});

describe('fetchAvatar', () => {
  it('rechaza content-type que no es imagen', async () => {
    await expect(fetchAvatar(new URL('https://a.example/x'), { fetcher: okFetcher(new Uint8Array(10), 'text/html') })).rejects.toThrow();
  });
  it('rechaza un content-length mayor al límite sin leer', async () => {
    const f: Fetcher = async () => ({ status: 200, headers: { 'content-type': 'image/png', 'content-length': '99999999' }, body: chunks() });
    await expect(fetchAvatar(new URL('https://a.example/x'), { fetcher: f })).rejects.toThrow(/large/);
  });
  it('sigue redirects https (máx.) y revalida cada salto', async () => {
    const seen: string[] = [];
    const img = await png(4, 4);
    const f: Fetcher = async (u) => {
      seen.push(u.href);
      if (u.pathname === '/a') return { status: 302, headers: { location: '/b' }, body: chunks() };
      return { status: 200, headers: { 'content-type': 'image/png' }, body: chunks(img) };
    };
    expect((await fetchAvatar(new URL('https://a.example/a'), { fetcher: f })).length).toBe(img.length);
    expect(seen).toEqual(['https://a.example/a', 'https://a.example/b']);
    const toHttp: Fetcher = async () => ({ status: 302, headers: { location: 'http://a.example/' }, body: chunks() });
    await expect(fetchAvatar(new URL('https://a.example/a'), { fetcher: toHttp })).rejects.toThrow();
    const toLocal: Fetcher = async () => ({ status: 302, headers: { location: 'https://127.0.0.1/' }, body: chunks() });
    await expect(fetchAvatar(new URL('https://a.example/a'), { fetcher: toLocal })).rejects.toThrow();
    const loop: Fetcher = async (u) => ({ status: 302, headers: { location: u.href + 'x' }, body: chunks() });
    await expect(fetchAvatar(new URL('https://a.example/a'), { fetcher: loop })).rejects.toThrow(/redirect/);
  });
});

describe('renderAvatar', () => {
  it('reduce a 128x128 WebP (cover)', async () => {
    const out = await renderAvatar(await png(1200, 800));
    const m = await sharp(out).metadata();
    expect(m.format).toBe('webp');
    expect([m.width, m.height]).toEqual([128, 128]);
  });
  it('GIF animado → un solo cuadro', async () => {
    const gif = await sharp({ create: { width: 20, height: 20, channels: 3, background: '#0f0' } }).gif().toBuffer();
    const m = await sharp(await renderAvatar(gif)).metadata();
    expect(m.format).toBe('webp');
    expect(m.pages ?? 1).toBe(1);
  });
  it('rechaza bytes que no son imagen', async () => {
    await expect(renderAvatar(Buffer.from('hola'))).rejects.toThrow();
  });
});

describe('límite de descargas por IP', () => {
  // The production 503 without Redis config is covered by the table test in api.test.ts.
  const run = async (storage: ReturnType<typeof memoryStorage>, ip: string, fetcher: Fetcher, method = 'GET') => {
    const headers: Record<string, string> = {};
    const res: any = { statusCode: 0, setHeader: (k: string, v: string) => { headers[k] = v; }, end: vi.fn() };
    await avatarHandler({ method, url: '/api/avatar?url=' + encodeURIComponent('https://img.example/a.png'), headers: { 'x-vercel-forwarded-for': ip }, socket: {} } as any, res, { fetcher, storage });
    return { status: res.statusCode, headers };
  };
  it('si falla Redis responde 503 sin caché ni descargar imágenes, tanto en GET como en HEAD', async () => {
    const storage = { ...memoryStorage(), incr: vi.fn().mockRejectedValue(new Error('Redis unavailable')) };
    const fetcher = vi.fn<Fetcher>(async () => { throw new Error('must not download'); });
    for (const method of ['GET', 'HEAD']) {
      const response = await run(storage, '5.5.5.5', fetcher, method);
      expect(response.status).toBe(503);
      expect(response.headers['cache-control']).toBe('no-store');
      expect(fetcher).not.toHaveBeenCalled();
    }
  });
  it('vuelve a servir imágenes en una petición posterior cuando Redis se recupera', async () => {
    const storage = { ...memoryStorage(), incr: vi.fn().mockRejectedValueOnce(new Error('Redis unavailable')).mockResolvedValue(1) };
    const fetcher = vi.fn<Fetcher>(okFetcher(await png(2, 2)));
    expect((await run(storage, '5.5.5.5', fetcher)).status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
    const recovered = await run(storage, '5.5.5.5', fetcher);
    expect(recovered.status).toBe(200);
    expect(recovered.headers['content-type']).toBe('image/webp');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('superado el cupo responde 429 sin descargar ni cachear; otras IPs conservan su cupo', async () => {
    const storage = memoryStorage(), fetcher = vi.fn<Fetcher>(async () => { throw new Error('offline'); });
    for (let i = 0; i < AVATAR_RATE.max; i++) expect((await run(storage, '5.5.5.5', fetcher)).status).toBe(502);
    const over = await run(storage, '5.5.5.5', fetcher);
    expect(over.status).toBe(429);
    expect(over.headers['cache-control']).toBe('no-store');
    expect(fetcher).toHaveBeenCalledTimes(AVATAR_RATE.max);
    expect((await run(storage, '6.6.6.6', fetcher)).status).toBe(502);
  });
  it('URLs inválidas no gastan cupo ni tocan almacenamiento', async () => {
    const storage = { ...memoryStorage(), incr: vi.fn() };
    const res: any = { statusCode: 0, setHeader() {}, end() {} };
    await avatarHandler({ method: 'GET', url: '/api/avatar?url=http%3A%2F%2Fx', headers: {}, socket: {} } as any, res, { storage });
    expect(res.statusCode).toBe(400);
    expect(storage.incr).not.toHaveBeenCalled();
  });
});

describe('devAvatarFetcher (solo pnpm dev, opt-in)', () => {
  it('solo con TOTEM_DEV_AVATAR_ANY_IP=1 reemplaza el fetcher seguro por defecto', () => {
    for (const env of [{}, { TOTEM_DEV_AVATAR_ANY_IP: '0' }, { TOTEM_DEV_AVATAR_ANY_IP: 'true' }]) expect(devAvatarFetcher(env)).toBeUndefined();
    expect(devAvatarFetcher({ TOTEM_DEV_AVATAR_ANY_IP: '1' })).toBeInstanceOf(Function);
  });
});
