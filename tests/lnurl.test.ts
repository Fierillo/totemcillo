import { afterEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from '@scure/base';
import { LnurlResolver, lnurlFromProfile } from '../src/nostr/lnurl';
import { validateZapReceipt } from '../src/nostr/verify';
import { makeZap } from './helpers';
import { verifyEvent } from 'nostr-tools/pure';

const NPK = 'f'.repeat(64);
const prof = (c: object) => ({ id: 'x', pubkey: 'p', created_at: 1, kind: 0, tags: [], content: JSON.stringify(c) });
const okFetch = (body: object, ok = true) => vi.fn(async (_u: string) => ({ ok, json: async () => body }));
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('lnurlFromProfile', () => {
  it('lud16 -> .well-known/lnurlp', () => {
    expect(lnurlFromProfile(JSON.stringify({ lud16: 'Fieri@getalby.com' }))).toBe('https://getalby.com/.well-known/lnurlp/Fieri');
  });
  it('lud06 bech32 -> URL', () => {
    const enc = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode('https://x.com/lnurlp/abc')), 2000);
    expect(lnurlFromProfile(JSON.stringify({ lud06: enc.toUpperCase() }))).toBe('https://x.com/lnurlp/abc');
  });
  it('null para datos inválidos', () => {
    for (const c of ['nojson', 'null', '{}', '{"lud16":"sinarroba"}', '{"lud16":"a@evil.com/x?"}', '{"lud06":"lnurl1basura"}'])
      expect(lnurlFromProfile(c)).toBeNull();
  });
});

describe('LnurlResolver', () => {
  it('pide una factura para el post con una identidad nueva y anónima, sin publicar la request', async () => {
    const post = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64) };
    const requests: any[] = [];
    const fetcher = vi.fn(async (url: string) => {
      const u = new URL(url);
      if (u.pathname.includes('.well-known')) return { ok: true, json: async () => ({ allowsNostr: true, nostrPubkey: NPK, callback: 'https://lnurl.blink.sv/pay', minSendable: 1000, maxSendable: 1000000 }) };
      expect(u.origin).toBe('https://lnurl.blink.sv');
      expect(u.searchParams.get('amount')).toBe('21000');
      const request = JSON.parse(u.searchParams.get('nostr')!);
      expect(verifyEvent(request)).toBe(true);
      expect(request.kind).toBe(9734);
      expect(request.content).toBe('');
      expect(request.tags).toEqual(expect.arrayContaining([['p', post.pubkey], ['e', post.id], ['amount', '21000'], ['anon'], ['relays', 'wss://relay.example']]));
      requests.push(request);
      return { ok: true, json: async () => ({ pr: 'lnbc210n1ptestinvoice' }) };
    });
    const resolver = new LnurlResolver(async () => prof({ lud16: 'recipient@blink.sv' }), fetcher);
    expect(await resolver.requestInvoice(post, 21, ['wss://relay.example'])).toBe('lnbc210n1ptestinvoice');
    await resolver.requestInvoice(post, 21, ['wss://relay.example']);
    expect(requests[0].pubkey).not.toBe(requests[1].pubkey);
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('no contacta callbacks inseguros ni pide montos fuera del rango del proveedor', async () => {
    const post = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64) };
    const metadata = { allowsNostr: true, nostrPubkey: NPK, callback: 'https://getalby.com/pay', minSendable: 1000, maxSendable: 100000 };
    for (const change of [
      { callback: 'https://evil.example/pay' }, { callback: 'http://getalby.com/pay' },
      { callback: 'https://user:pass@getalby.com/pay' }, { callback: 'https://getalby.com:8443/pay' },
      { minSendable: 22000 }, { maxSendable: 20000 }, { minSendable: undefined },
    ]) {
      const fetcher = okFetch({ ...metadata, ...change });
      const resolver = new LnurlResolver(async () => prof({ lud16: 'a@getalby.com' }), fetcher);
      await expect(resolver.requestInvoice(post, 21, ['wss://relay.example'])).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('rechaza montos inválidos antes de consultar al proveedor y facturas con un monto distinto', async () => {
    const post = { id: 'a'.repeat(64), pubkey: 'b'.repeat(64) };
    const fetcher = vi.fn(async (url: string) => ({ ok: true, json: async () => url.includes('.well-known')
      ? { allowsNostr: true, nostrPubkey: NPK, callback: 'https://getalby.com/pay', minSendable: 1000, maxSendable: 100000 }
      : { pr: 'lnbc1000n1ptestinvoice' } }));
    const resolver = new LnurlResolver(async () => prof({ lud16: 'a@getalby.com' }), fetcher);
    for (const sats of [0, -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER])
      await expect(resolver.requestInvoice(post, sats, ['wss://relay.example'])).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
    await expect(resolver.requestInvoice(post, 21, ['wss://relay.example'])).rejects.toThrow('factura válida');
  });
  it('no devuelve como autorizado un proveedor retirado mientras su consulta estaba en vuelo', async () => {
    let providers = ['custom.example'];
    let finish!: () => void;
    const f = vi.fn(async () => {
      await new Promise<void>((done) => { finish = done; });
      return { ok: true, json: async () => ({ allowsNostr: true, nostrPubkey: NPK }) };
    });
    const resolver = new LnurlResolver(async () => prof({ lud16: 'a@custom.example' }), f, undefined, () => providers);
    const pending = resolver.resolve('pk');
    const cached = resolver.resolve('pk');
    await Promise.resolve();
    expect(f).toHaveBeenCalledTimes(1);
    providers = [];
    finish();
    expect(await pending).toBeNull();
    expect(await cached).toBeNull();
  });
  it('el filtro también cubre lud06 y rechaza credenciales, puertos alternativos y dominios engañosos', async () => {
    const f = okFetch({ allowsNostr: true, nostrPubkey: NPK });
    for (const url of ['https://getalby.com@evil.example/pay', 'https://user:pass@getalby.com/pay', 'https://getalby.com:8443/pay', 'http://getalby.com/pay']) {
      const lud06 = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(url)), 2000);
      expect(await new LnurlResolver(async () => prof({ lud06 }), f).resolve('pk')).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
    const lud06 = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode('https://Pay.GetAlby.com:443/pay')), 2000);
    expect(await new LnurlResolver(async () => prof({ lud06 }), f).resolve('pk')).toBe(NPK);
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('pide al navegador rechazar redirecciones para no contactar destinos fuera de la lista', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetcher = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('redirect blocked'));
    const resolver = new LnurlResolver(async () => prof({ lud16: 'a@getalby.com' }));
    expect(await resolver.resolve('pk')).toBeNull();
    expect(fetcher).toHaveBeenCalledWith('https://getalby.com/.well-known/lnurlp/a', expect.objectContaining({ redirect: 'error' }));
  });
  it('aplica cambios del panel sin esperar el vencimiento de caché ni reutilizar un proveedor retirado', async () => {
    let providers: string[] = [];
    const f = okFetch({ allowsNostr: true, nostrPubkey: NPK });
    const resolver = new LnurlResolver(async () => prof({ lud16: 'a@custom.example' }), f, undefined, () => providers);
    expect(await resolver.resolve('pk')).toBeNull();
    expect(f).not.toHaveBeenCalled();
    providers = ['custom.example'];
    expect(await resolver.resolve('pk')).toBe(NPK);
    expect(f).toHaveBeenCalledTimes(1);
    providers = [];
    expect(await resolver.resolve('pk')).toBeNull();
    expect(f).toHaveBeenCalledTimes(1);
  });
  it('rechaza dominios no autorizados antes de hacer cualquier petición LNURL', async () => {
    const f = okFetch({ allowsNostr: true, nostrPubkey: NPK });
    for (const domain of ['untrusted.example', 'evilgetalby.com', 'getalby.com.evil.example']) {
      const resolver = new LnurlResolver(async () => prof({ lud16: `a@${domain}` }), f);
      expect(await resolver.resolve('pk')).toBeNull();
    }
    expect(f).not.toHaveBeenCalled();
  });
  it('aborta una consulta lenta para liberar el cupo de validación', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    let signal: AbortSignal | null | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      signal = init?.signal;
      signal?.addEventListener('abort', () => reject(new Error('timeout')), { once: true });
    }));
    const resolver = new LnurlResolver(async () => prof({ lud16: 'a@getalby.com' }));
    const pending = resolver.resolve('pk');
    await vi.advanceTimersByTimeAsync(5000);
    expect(signal?.aborted).toBe(true);
    expect(await pending).toBeNull();
  });
  it('guarda en el zap el dominio normalizado del LNURL que lo firmó', async () => {
    const z = makeZap();
    const resolver = new LnurlResolver(async () => prof({ lud16: 'yo@Pay.GetAlby.com' }), async () => ({ ok: true, json: async () => ({ allowsNostr: true, nostrPubkey: z.server.pk }) }));
    expect((await validateZapReceipt(z.receipt, resolver))?.domain).toBe('pay.getalby.com');
  });
  it('resuelve nostrPubkey si allowsNostr', async () => {
    const load = vi.fn(async () => prof({ lud16: 'a@getalby.com' }));
    const f = okFetch({ allowsNostr: true, nostrPubkey: NPK });
    expect(await new LnurlResolver(load, f).resolve('pk')).toBe(NPK);
    expect(load).toHaveBeenCalledWith('pk');
    expect(f).toHaveBeenCalledWith('https://getalby.com/.well-known/lnurlp/a');
  });
  it('null si no hay allowsNostr, pubkey inválido, error HTTP, sin perfil o sin lud', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = async () => prof({ lud16: 'a@getalby.com' });
    const cases: [() => Promise<any>, ReturnType<typeof okFetch>][] = [
      [p, okFetch({ allowsNostr: false, nostrPubkey: NPK })],
      [p, okFetch({ allowsNostr: true, nostrPubkey: 'zz' })],
      [p, okFetch({}, false)],
      [async () => null, okFetch({ allowsNostr: true, nostrPubkey: NPK })],
      [async () => prof({}), okFetch({ allowsNostr: true, nostrPubkey: NPK })],
    ];
    for (const [load, f] of cases) expect(await new LnurlResolver(load, f).resolve('pk')).toBeNull();
  });
  it('falla de red/CORS -> null sin tirar', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const f = vi.fn(async (_u: string) => { throw new TypeError('Failed to fetch'); });
    expect(await new LnurlResolver(async () => prof({ lud16: 'a@getalby.com' }), f).resolve('pk')).toBeNull();
  });
  it('cachea por destinatario, incluso en paralelo', async () => {
    const load = vi.fn(async () => prof({ lud16: 'a@getalby.com' }));
    const f = okFetch({ allowsNostr: true, nostrPubkey: NPK });
    const r = new LnurlResolver(load, f);
    await Promise.all([r.resolve('pk'), r.resolve('pk')]);
    await r.resolve('pk');
    expect(f).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('reintenta las fallas después de retryMs', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    vi.useFakeTimers();
    vi.setSystemTime(0);
    const f = vi.fn(async (_u: string) => ({ ok: true, json: async () => ({ allowsNostr: true, nostrPubkey: NPK }) }));
    f.mockRejectedValueOnce(new Error('caído'));
    const r = new LnurlResolver(async () => prof({ lud16: 'a@getalby.com' }), f, 1000);
    expect(await r.resolve('pk')).toBeNull();
    expect(await r.resolve('pk')).toBeNull();
    vi.setSystemTime(1000);
    expect(await r.resolve('pk')).toBe(NPK);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
