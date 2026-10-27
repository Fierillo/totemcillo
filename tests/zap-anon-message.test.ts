// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LnurlResolver } from '../src/nostr/lnurl';
import { ZapStore, MAX_COMMENT } from '../src/nostr/store';
import { openZapDialog } from '../src/zap-dialog';
import { defaultConfig } from '../src/config';
import { LONG_COMMENT, postScene } from '../src/scenes/post';
import { batallaScene } from '../src/scenes/batalla';
import { profiles } from '../src/nostr/profiles';

const hex = (n: number) => n.toString(16).padStart(64, '0');
const NPK = 'f'.repeat(64);
const prof = (c: object) => ({ id: 'x', pubkey: 'p', created_at: 1, kind: 0, tags: [], content: JSON.stringify(c) });
const post = { id: hex(1), pubkey: 'a'.repeat(64), content: 'post 1', created_at: Math.floor(Date.now() / 1000) - 60 };

afterEach(() => { document.querySelectorAll('dialog').forEach((d) => d.remove()); localStorage.clear(); });

describe('mensaje de zap anónimo: pedido de factura', () => {
  const resolver = (requests: any[], urls: URL[] = []) => new LnurlResolver(async () => prof({ lud16: 'recipient@blink.sv' }), vi.fn(async (url: string) => {
    const u = new URL(url);
    if (u.pathname.includes('.well-known')) return { ok: true, json: async () => ({ allowsNostr: true, nostrPubkey: NPK, callback: 'https://lnurl.blink.sv/pay', minSendable: 1000, maxSendable: 1000000 }) };
    urls.push(u);
    requests.push(JSON.parse(u.searchParams.get('nostr')!));
    return { ok: true, json: async () => ({ pr: 'lnbc210n1ptestinvoice' }) };
  }) as any);
  it('va en el content del 9734 (NIP-57), recortado; sin mensaje queda vacío', async () => {
    const reqs: any[] = [], urls: URL[] = [];
    const r = resolver(reqs, urls);
    await r.requestInvoice(post, 21, ['wss://relay.example'], '  ¡Grande!  ');
    await r.requestInvoice(post, 21, ['wss://relay.example']);
    expect(reqs[0].content).toBe('¡Grande!');
    expect(reqs[0].tags).toContainEqual(['anon']);
    expect(reqs[1].content).toBe('');
    expect(urls[0].searchParams.has('comment')).toBe(false); // LUD-12 comment not used: NIP-57 carries it in the request
  });
  it('nunca supera MAX_COMMENT', async () => {
    const reqs: any[] = [];
    await resolver(reqs).requestInvoice(post, 21, ['wss://relay.example'], 'x'.repeat(MAX_COMMENT + 50));
    expect(reqs[0].content).toHaveLength(MAX_COMMENT);
  });
});

describe('mensaje de zap anónimo: formulario', () => {
  it('campo «Mensaje (opcional)» con maxlength MAX_COMMENT; se pasa al pedir la factura', async () => {
    const s = new ZapStore(); s.addPost(post);
    const invoice = vi.fn().mockResolvedValue('lnbc210n1ptestinvoice');
    openZapDialog(post, defaultConfig.relays, invoice, s);
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
    const field = dialog.querySelector<HTMLInputElement>('form [name="message"]')!;
    expect(field).not.toBeNull();
    expect(field.closest('label')!.textContent).toContain('Mensaje (opcional)');
    expect(field.maxLength).toBe(MAX_COMMENT);
    expect(field.required).toBe(false);
    field.value = 'Hola totem';
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
    expect(invoice).toHaveBeenCalledWith(post, 21, 'Hola totem');
  });
});

describe('mensaje de zap anónimo: dónde se muestra', () => {
  const store = () => {
    const s = new ZapStore(); s.addPost(post);
    s.addZap({ id: hex(50), postId: post.id, msats: 21_000, comment: 'mensaje secreto', created_at: Math.floor(Date.now() / 1000) });
    profiles.set('a'.repeat(64), null);
    return s;
  };
  it('comentario largo: en Mensajes como «anónimo», con el comentario completo', () => {
    const long = 'x'.repeat(LONG_COMMENT);
    const s = new ZapStore(); s.addPost(post); profiles.set('a'.repeat(64), null);
    s.addZap({ id: hex(51), postId: post.id, msats: 21_000, comment: long, created_at: Math.floor(Date.now() / 1000) });
    const root = document.createElement('div'), off = postScene(s).render(root);
    const row = root.querySelector('.msg-zap')!;
    expect(row.textContent).toContain('anónimo');
    expect(row.querySelector('.excerpt')!.textContent).toBe(long);
    off?.();
  });
  it('comentario corto: no aparece en Mensajes ni en la batalla (fuera de vivo)', () => {
    for (const scene of [postScene(store()), batallaScene(store())]) {
      const root = document.createElement('div'), off = scene.render(root);
      expect(root.textContent).not.toContain('mensaje secreto');
      off?.();
    }
  });
});
