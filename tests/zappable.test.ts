import { describe, expect, it, vi } from 'vitest';
import { checkZappable, zappableHandler, ZAPPABLE_TTL } from '../server/zappable';
import { memoryStorage } from '../server/storage';

const pk = 'a'.repeat(64), npk = 'b'.repeat(64);
const profile = (lud16: string) => ({ content: JSON.stringify({ lud16 }) });
const ok = (body: unknown) => async () => ({ status: 200, text: async () => JSON.stringify(body) });

function call(url: string, o: Parameters<typeof zappableHandler>[2]) {
  const res: any = { statusCode: 0, headers: {} as Record<string, string>, setHeader(k: string, v: string) { this.headers[k] = v; }, end: vi.fn() };
  return zappableHandler({ method: 'GET', url, headers: {}, socket: {} } as any, res, o).then(() => ({ ...res, body: res.end.mock.calls[0]?.[0] && JSON.parse(res.end.mock.calls[0][0]) }));
}

describe('checkZappable (servidor)', () => {
  it('sí con allowsNostr y nostrPubkey de un proveedor permitido', async () => {
    const fetchText = vi.fn(ok({ allowsNostr: true, nostrPubkey: npk }));
    expect(await checkZappable(pk, { loadProfile: async () => profile('yo@getalby.com'), fetchText, providers: ['getalby.com'] })).toBe(true);
    expect(fetchText).toHaveBeenCalledWith('https://getalby.com/.well-known/lnurlp/yo');
  });
  it('no: dominio fuera de la lista, sin lud16 o sin allowsNostr (sin pedir nada a dominios no permitidos)', async () => {
    const fetchText = vi.fn(ok({ allowsNostr: true, nostrPubkey: npk }));
    expect(await checkZappable(pk, { loadProfile: async () => profile('yo@evil.example'), fetchText, providers: ['getalby.com'] })).toBe(false);
    expect(fetchText).not.toHaveBeenCalled();
    expect(await checkZappable(pk, { loadProfile: async () => null, fetchText, providers: ['getalby.com'] })).toBe(false);
    expect(await checkZappable(pk, { loadProfile: async () => profile('yo@getalby.com'), fetchText: ok({ allowsNostr: false }), providers: ['getalby.com'] })).toBe(false);
  });
  it('errores de red / 5xx se propagan (no son un "no")', async () => {
    await expect(checkZappable(pk, { loadProfile: async () => profile('yo@getalby.com'), fetchText: async () => { throw new Error('x'); }, providers: ['getalby.com'] })).rejects.toThrow();
    await expect(checkZappable(pk, { loadProfile: async () => profile('yo@getalby.com'), fetchText: async () => ({ status: 503, text: async () => '' }), providers: ['getalby.com'] })).rejects.toThrow();
  });
});

describe('GET /api/zappable', () => {
  it('valida el pubkey', async () => {
    expect((await call('/api/zappable?pubkey=zz', { storage: memoryStorage() })).statusCode).toBe(400);
  });
  it('cachea en Redis: sí 3 h, no 30 min; la segunda vez no consulta', async () => {
    const storage = memoryStorage(), check = vi.fn(async () => true);
    const set = vi.spyOn(storage, 'set');
    expect((await call(`/api/zappable?pubkey=${pk}`, { storage, check })).body).toEqual({ zappable: true });
    expect(set).toHaveBeenCalledWith(`totem:zappable:${pk}`, 1, ZAPPABLE_TTL.yes);
    expect((await call(`/api/zappable?pubkey=${pk}`, { storage, check })).body).toEqual({ zappable: true });
    expect(check).toHaveBeenCalledTimes(1);
    expect(ZAPPABLE_TTL).toEqual({ yes: 3 * 3600, no: 1800 });
  });
  it('un error responde 502 y no se cachea', async () => {
    const storage = memoryStorage(), set = vi.spyOn(storage, 'set');
    const r = await call(`/api/zappable?pubkey=${pk}`, { storage, check: async () => { throw new Error('x'); } });
    expect(r.statusCode).toBe(502);
    expect(set).not.toHaveBeenCalled();
  });
  it('rate limit por IP solo en las consultas no cacheadas', async () => {
    const storage = memoryStorage();
    vi.spyOn(storage, 'incr').mockResolvedValue(999);
    expect((await call(`/api/zappable?pubkey=${pk}`, { storage, check: async () => true })).statusCode).toBe(429);
  });
});
