// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bech32 } from '@scure/base';
import { renderMobile } from '../src/mobile';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';
import { profiles } from '../src/nostr/profiles';
import { openZapDialog, PENDING_ZAP_KEY, bolt11Expiry, loadPendingZap } from '../src/zap-dialog';

const hex = (n: number) => n.toString(16).padStart(64, '0');
const now = () => Math.floor(Date.now() / 1000);
const toWords = (n: number, len: number) => Array.from({ length: len }, (_, i) => Math.floor(n / 32 ** (len - 1 - i)) % 32);
/** Minimal well-formed bolt11 (fake signature): timestamp + optional expiry tag `x`. */
const bolt11 = (ts: number, expiry?: number) => {
  const words = [...toWords(ts, 7)];
  if (expiry !== undefined) words.push(6, ...toWords(2, 2), ...toWords(expiry, 2));
  words.push(...new Array(104).fill(0));
  return bech32.encode('lnbc210n', words, false);
};
const store = () => {
  const s = new ZapStore();
  for (let i = 1; i <= 3; i++) s.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post ${i}`, created_at: now() - i * 60 });
  s.setReady();
  profiles.set('a'.repeat(64), null);
  return s;
};
const toInvoice = async (dialog: HTMLDialogElement) => {
  dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
  dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
};
const mount = (s: ZapStore, requestInvoice = vi.fn().mockResolvedValue(bolt11(now(), 600))) => {
  const root = document.createElement('div');
  document.body.append(root);
  const off = renderMobile(root, s, defaultConfig, new Announcement(''), { requestInvoice: requestInvoice });
  const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  const reveal = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
  const selected = () => root.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute('data-tab');
  const cleanup = () => { off(); root.remove(); scrollTo.mockRestore(); reveal.mockRestore(); };
  return { root, requestInvoice, reveal, selected, cleanup };
};
const pending = (over: object = {}) => ({ postId: hex(2), pubkey: 'a'.repeat(64), sats: 21, invoice: bolt11(now(), 600), createdAt: now(), expiresAt: now() + 600, ...over });

beforeEach(() => localStorage.clear());
afterEach(() => { document.querySelectorAll('dialog').forEach((d) => d.remove()); localStorage.clear(); });

describe('bolt11Expiry', () => {
  it('lee timestamp + tag x, o 3600 s por defecto; null si no es bolt11', () => {
    expect(bolt11Expiry(bolt11(1_700_000_000, 900))).toBe(1_700_000_900);
    expect(bolt11Expiry(bolt11(1_700_000_000))).toBe(1_700_003_600);
    expect(bolt11Expiry('lnbc210n1ptestinvoice')).toBeNull();
  });
});

describe('la factura pendiente sobrevive a recargar la página', () => {
  it('al mostrar la factura la guarda; Cancelar la borra', async () => {
    const s = store();
    const { root, cleanup } = mount(s);
    try {
      root.querySelector<HTMLButtonElement>(`[data-zap="${hex(2)}"]`)!.click();
      const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
      await toInvoice(dialog);
      const saved = loadPendingZap()!;
      expect(saved).toMatchObject({ postId: hex(2), sats: 21 });
      expect(saved.invoice).toMatch(/^lnbc/);
      expect(saved.expiresAt).toBeGreaterThan(now());
      dialog.querySelector<HTMLButtonElement>('.zap-cancel')!.click();
      expect(localStorage.getItem(PENDING_ZAP_KEY)).toBeNull();
    } finally { cleanup(); }
  });
  it('al cargar reabre el modal con la misma factura (sin pedir otra) y al pagar va a Posts con la tarjeta', async () => {
    const p = pending();
    localStorage.setItem(PENDING_ZAP_KEY, JSON.stringify(p));
    const s = store();
    const { requestInvoice, reveal, selected, cleanup } = mount(s);
    try {
      const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
      expect(dialog.open).toBe(true);
      expect(dialog.querySelector('[data-open-wallet]')!.getAttribute('href')).toBe(`lightning:${p.invoice}`);
      expect(dialog.querySelector<HTMLElement>('.zap-choices')!.hidden).toBe(true);
      expect(dialog.textContent).toContain('21 sats');
      expect(requestInvoice).not.toHaveBeenCalled();
      s.addZap({ id: hex(90), postId: hex(2), sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now() });
      expect(document.querySelector('dialog')).toBeNull();
      expect(selected()).toBe('posts');
      expect((reveal.mock.contexts[0] as HTMLElement).dataset.id).toBe(hex(2));
      expect(localStorage.getItem(PENDING_ZAP_KEY)).toBeNull();
    } finally { cleanup(); }
  });
  it('factura vencida: se descarta y no se abre nada', () => {
    localStorage.setItem(PENDING_ZAP_KEY, JSON.stringify(pending({ createdAt: now() - 700, expiresAt: now() - 100 })));
    const { cleanup } = mount(store());
    try {
      expect(document.querySelector('dialog')).toBeNull();
      expect(localStorage.getItem(PENDING_ZAP_KEY)).toBeNull();
    } finally { cleanup(); }
  });
  it('datos corruptos: se descartan', () => {
    localStorage.setItem(PENDING_ZAP_KEY, '{nope');
    expect(loadPendingZap()).toBeNull();
    expect(localStorage.getItem(PENDING_ZAP_KEY)).toBeNull();
  });
  it('si el recibo llegó con la pestaña muerta (aparece en el backfill, no en vivo) cuenta como pagado', () => {
    const p = pending({ createdAt: now() - 300 });
    localStorage.setItem(PENDING_ZAP_KEY, JSON.stringify(p));
    const s = store();
    const { selected, cleanup } = mount(s);
    try {
      expect(document.querySelector('dialog')).not.toBeNull();
      s.addZap({ id: hex(91), postId: hex(3), sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now() - 200 }); // other post
      s.addZap({ id: hex(92), postId: hex(2), sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now() - 400 }); // older than the invoice
      expect(document.querySelector('dialog')).not.toBeNull();
      s.addZap({ id: hex(93), postId: hex(2), sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now() - 200 }); // too old to be "live"
      expect(document.querySelector('dialog')).toBeNull();
      expect(selected()).toBe('posts');
      expect(localStorage.getItem(PENDING_ZAP_KEY)).toBeNull();
    } finally { cleanup(); }
  });
  it('un zap viejo que ya estaba en el store no cuenta como pago', () => {
    localStorage.setItem(PENDING_ZAP_KEY, JSON.stringify(pending({ createdAt: now() - 300 })));
    const s = store();
    s.addZap({ id: hex(94), postId: hex(2), sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now() - 200 });
    const { cleanup } = mount(s);
    try {
      s.addPost({ id: hex(9), pubkey: 'a'.repeat(64), content: 'otro', created_at: now() }); // any store change
      expect(document.querySelector('dialog')).not.toBeNull();
      expect(localStorage.getItem(PENDING_ZAP_KEY)).not.toBeNull();
    } finally { cleanup(); }
  });
  it('openZapDialog con resume va directo a la factura', () => {
    const p = pending();
    openZapDialog({ id: p.postId, pubkey: p.pubkey, content: '', created_at: 0 }, defaultConfig.relays, undefined, store(), { resume: p });
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull();
    expect(dialog.querySelector('form')!.hidden).toBe(true);
  });
});
