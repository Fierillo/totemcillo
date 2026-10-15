import { afterEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from '@scure/base';
import { LnurlResolver, lnurlFromProfile } from '../src/nostr/lnurl';
import { validateZapReceipt } from '../src/nostr/verify';
import { makeZap } from './helpers';

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
  it('guarda en el zap el dominio normalizado del LNURL que lo firmó', async () => {
    const z = makeZap();
    const resolver = new LnurlResolver(async () => prof({ lud16: 'yo@Pay.GetAlby.com' }), async () => ({ ok: true, json: async () => ({ allowsNostr: true, nostrPubkey: z.server.pk }) }));
    expect((await validateZapReceipt(z.receipt, resolver))?.domain).toBe('pay.getalby.com');
  });
  it('resuelve nostrPubkey si allowsNostr', async () => {
    const load = vi.fn(async () => prof({ lud16: 'a@b.com' }));
    const f = okFetch({ allowsNostr: true, nostrPubkey: NPK });
    expect(await new LnurlResolver(load, f).resolve('pk')).toBe(NPK);
    expect(load).toHaveBeenCalledWith('pk');
    expect(f).toHaveBeenCalledWith('https://b.com/.well-known/lnurlp/a');
  });
  it('null si no hay allowsNostr, pubkey inválido, error HTTP, sin perfil o sin lud', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = async () => prof({ lud16: 'a@b.com' });
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
    expect(await new LnurlResolver(async () => prof({ lud16: 'a@b.com' }), f).resolve('pk')).toBeNull();
  });
  it('cachea por destinatario, incluso en paralelo', async () => {
    const load = vi.fn(async () => prof({ lud16: 'a@b.com' }));
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
    const r = new LnurlResolver(async () => prof({ lud16: 'a@b.com' }), f, 1000);
    expect(await r.resolve('pk')).toBeNull();
    expect(await r.resolve('pk')).toBeNull();
    vi.setSystemTime(1000);
    expect(await r.resolve('pk')).toBe(NPK);
    expect(f).toHaveBeenCalledTimes(2);
  });
});
