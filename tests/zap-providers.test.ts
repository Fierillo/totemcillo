// @vitest-environment happy-dom
import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { handle, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import { DEFAULT_ZAP_PROVIDERS, LIMITS } from '../shared/settings';
import { LnurlResolver } from '../src/nostr/lnurl';
import { validateZapReceipt } from '../src/nostr/verify';
import { ZapStore, providerAllowed } from '../src/nostr/store';
import { moderationOf } from '../src/moderation-lists';
import { renderProviders } from '../src/providers';
import { makeZap } from './helpers';

const PASS = 'clave-de-prueba';
const deps = (): Deps => ({ storage: memoryStorage(), env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: 's'.repeat(32) }, now: () => 1_000_000 });
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): ApiRequest =>
  ({ method, path, body, ip: '1.1.1.1', headers: { 'content-type': 'application/json', ...headers } });
const login = async (d: Deps) => String((await handle(req('POST', '/api/login', { password: PASS }), d)).headers['set-cookie']).split(';')[0];

describe('lista de proveedores en el servidor', () => {
  it('por defecto: los proveedores conocidos, en /api/settings y /api/kiosk', async () => {
    expect(DEFAULT_ZAP_PROVIDERS).toEqual(['getalby.com', 'primal.net', 'walletofsatoshi.com', 'lawallet.ar', 'lawallet.io', 'blink.sv', 'coinos.io', 'strike.me']);
    const d = deps();
    expect((await handle(req('GET', '/api/settings'), d)).body).toMatchObject({ zapProviders: DEFAULT_ZAP_PROVIDERS });
    expect((await handle(req('GET', '/api/kiosk'), d)).body).toMatchObject({ zapProviders: DEFAULT_ZAP_PROVIDERS });
  });
  it('el admin la edita: valida hostnames, normaliza, deduplica, tope y sube versión sin mover la agenda', async () => {
    const d = deps(); const c = await login(d);
    const put = (zapProviders: unknown) => handle(req('PUT', '/api/settings', { zapProviders }, { cookie: c }), d);
    let r = await put(['GetAlby.com', 'getalby.com', ' mi.wallet.ar ']);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ zapProviders: ['getalby.com', 'mi.wallet.ar'], version: 1 });
    expect((r.body as any).epoch).toBeUndefined();
    for (const bad of ['getalby.com', [1], ['https://x.com'], ['a@b.com'], ['sin-punto'], ['-x.com'], ['x..com'], ['a'.repeat(64) + '.com'], Array.from({ length: LIMITS.maxZapProviders + 1 }, (_, i) => `p${i}.com`)])
      expect((await put(bad)).status).toBe(400);
    r = await put([]);
    expect(r.body).toMatchObject({ zapProviders: [] });
    expect((await handle(req('GET', '/api/kiosk'), d)).body).toMatchObject({ zapProviders: [] });
  });
});

describe('dominio del LNURL en el zap', () => {
  const prof = (c: object) => ({ id: 'x', pubkey: 'p', created_at: 1, kind: 0, tags: [], content: JSON.stringify(c) });
  it('el resolver informa el dominio que firmó y el zap lo guarda', async () => {
    const z = makeZap();
    const r = new LnurlResolver(async () => prof({ lud16: 'yo@Pay.GetAlby.com' }), async () => ({ ok: true, json: async () => ({ allowsNostr: true, nostrPubkey: z.server.pk }) }));
    const zap = await validateZapReceipt(z.receipt, r);
    expect(zap?.domain).toBe('pay.getalby.com');
  });
  it('coincide dominio exacto o subdominio', () => {
    const list = ['getalby.com'];
    expect(providerAllowed('getalby.com', list)).toBe(true);
    expect(providerAllowed('pay.getalby.com', list)).toBe(true);
    expect(providerAllowed('evilgetalby.com', list)).toBe(false);
    expect(providerAllowed('getalby.com.evil.io', list)).toBe(false);
    expect(providerAllowed(undefined, list)).toBe(false);
  });
});

describe('ZapStore: sólo cuentan zaps de proveedores permitidos', () => {
  const filled = (opts = {}) => {
    const s = new ZapStore(undefined, { clock: () => 100, ...opts });
    s.addPost({ id: 'p1', pubkey: 'a', content: 'x', created_at: 1 });
    s.addZap({ id: 'ok', postId: 'p1', msats: 1000, comment: '', created_at: 10, domain: 'pay.getalby.com' });
    s.addZap({ id: 'trucho', postId: 'p1', msats: 9_000_000, comment: '', created_at: 11, domain: 'mi-lnurl.xyz' });
    s.addZap({ id: 'viejo', postId: 'p1', msats: 7000, comment: '', created_at: 12 });
    return s;
  };
  it('tops, últimos zaps y totales ignoran proveedores fuera de la lista', () => {
    const s = filled({ zapProviders: DEFAULT_ZAP_PROVIDERS });
    expect(s.top(10).map((x) => x.msats)).toEqual([1000]);
    expect(s.latestZaps(10).map((z) => z.id)).toEqual(['ok']);
  });
  it('cambiar la lista se aplica en vivo (incluye lo ya guardado)', () => {
    const s = filled({ zapProviders: DEFAULT_ZAP_PROVIDERS });
    s.setModeration({ hiddenPosts: [], bannedPubkeys: [], zapProviders: ['mi-lnurl.xyz'] });
    expect(s.latestZaps(10).map((z) => z.id)).toEqual(['trucho']);
  });
  it('no anima zaps de proveedores no permitidos', () => {
    const s = new ZapStore(undefined, { clock: () => 100, zapProviders: ['getalby.com'] });
    s.addPost({ id: 'p1', pubkey: 'a', content: 'x', created_at: 1 });
    const live = vi.fn(); s.onLive(live);
    s.addZap({ id: 't', postId: 'p1', msats: 1, comment: '', created_at: 99, domain: 'evil.xyz' });
    expect(live).not.toHaveBeenCalled();
    s.addZap({ id: 'o', postId: 'p1', msats: 1, comment: '', created_at: 99, domain: 'getalby.com' });
    expect(live).toHaveBeenCalledWith({ type: 'zap', postId: 'p1' });
  });
  it('la lista llega por el mismo flujo que la moderación; si falta, la de por defecto', () => {
    expect(moderationOf({ zapProviders: ['x.com'] }).zapProviders).toEqual(['x.com']);
    expect(moderationOf({}).zapProviders).toEqual(DEFAULT_ZAP_PROVIDERS);
  });
});

describe('tarjeta de proveedores en /admin', () => {
  it('lista, agrega y quita dominios guardando la lista completa', async () => {
    const root = document.createElement('div');
    const save = vi.fn(async (list: string[]) => list);
    renderProviders(root, { list: ['getalby.com', 'primal.net'], save });
    expect([...root.querySelectorAll('.prov-item')].map((li) => li.getAttribute('data-domain'))).toEqual(['getalby.com', 'primal.net']);
    (root.querySelector('.prov-item[data-domain="primal.net"] button.prov-del') as HTMLButtonElement).click();
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith(['getalby.com']));
    await vi.waitFor(() => expect(root.querySelectorAll('.prov-item').length).toBe(1));
    (root.querySelector('input[name="prov-new"]') as HTMLInputElement).value = 'Blink.sv';
    (root.querySelector('form.prov-add') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(save).toHaveBeenLastCalledWith(['getalby.com', 'blink.sv']));
  });
  it('si el servidor rechaza, muestra el error y no cambia la lista', async () => {
    const root = document.createElement('div');
    renderProviders(root, { list: ['getalby.com'], save: async () => { throw new Error('dominio inválido'); } });
    (root.querySelector('input[name="prov-new"]') as HTMLInputElement).value = 'nop';
    (root.querySelector('form.prov-add') as HTMLFormElement).dispatchEvent(new Event('submit', { cancelable: true }));
    await vi.waitFor(() => expect(root.querySelector('.prov-err')!.textContent).toContain('dominio inválido'));
    expect(root.querySelectorAll('.prov-item').length).toBe(1);
  });
  it('en el admin vive en la pestaña Config', () => {
    const src = readFileSync('src/admin.ts', 'utf8');
    expect(src).toMatch(/<section class="card card-prov"[^>]*>/);
    const cfg = src.slice(src.indexOf('data-pane="config"'), src.indexOf('data-pane="mod"'));
    expect(cfg).toContain('card-prov');
  });
});
