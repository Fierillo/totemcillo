// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMobile, SPLASH_MS } from '../src/mobile';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';
import { feedFor } from '../src/livefeed';
import { zapFx } from '../src/zap-fx';
import { openZapDialog, PAID_CLOSE_MS } from '../src/zap-dialog';

afterEach(() => document.querySelectorAll('svg.strike, .strike-gain, .m-live').forEach((e) => e.remove()));
afterEach(() => { localStorage.clear(); sessionStorage.clear(); }); // pending invoices and the view state persist across mounts
import { profiles } from '../src/nostr/profiles';
import { hex, store } from './mobile-helpers';
beforeEach(() => Object.assign(SPLASH_MS, { min: 0, max: 0 }));
beforeEach(() => { PAID_CLOSE_MS.ms = 0; }); // closes at once; the 3 s success pause has its own tests // behavior after loading; the loading screen has its own tests


describe('pago confirmado desde el modal móvil', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const receipt = (n: number, postId: string) => ({ id: hex(n), postId, sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now(), bolt11: 'lnbc210n1ptestinvoice' });
  /** Shows the wallet invoice in an already open zap dialog. */
  const showInvoice = async () => {
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
    return dialog;
  };
  /** Opens the zap dialog from a card in `tab` and generates the invoice. */
  const payFrom = async (root: HTMLElement, tab: string, postId: string) => {
    root.querySelector<HTMLButtonElement>(`[data-tab="${tab}"]`)!.click();
    root.querySelector<HTMLButtonElement>(`#mobile-${tab} .m-top-row[data-id="${postId}"] .m-top-head`)?.click(); // Top: expand the row first
    root.querySelector<HTMLButtonElement>(`#mobile-${tab} [data-zap="${postId}"]`)!.click();
    return showInvoice();
  };
  // Same wiring order as main.ts: zapFx (and so the shared LiveFeed) subscribes to the store before the mobile view and the dialog.
  const mount = (s: ZapStore) => {
    const root = document.createElement('div');
    document.body.append(root);
    const stop = zapFx(s);
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), { requestInvoice: vi.fn().mockResolvedValue('lnbc210n1ptestinvoice') });
    const scrollTo = vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
    const reveal = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => {});
    const selected = () => root.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute('data-tab');
    const cleanup = () => { off(); stop(); root.remove(); scrollTo.mockRestore(); reveal.mockRestore(); document.querySelectorAll('dialog, .zap-fx').forEach((e) => e.remove()); };
    return { root, scrollTo, reveal, selected, cleanup };
  };

  it('pagado desde Top histórico: cierra el modal, vuelve a Posts, muestra la tarjeta y el rayo cae sobre ella (sin ráfaga)', async () => {
    const s = store();
    s.addZap({ ...receipt(50, hex(3)), created_at: now() - 3600 }); // hex(3) also ranks in Top (old zap, not live)
    const { root, scrollTo, reveal, selected, cleanup } = mount(s);
    try {
      await payFrom(root, 'top', hex(3));
      scrollTo.mockClear();
      s.addZap(receipt(51, hex(3)));
      expect(document.querySelector('dialog')).toBeNull();
      expect(selected()).toBe('posts');
      expect(root.querySelector('#mobile-posts')!.hasAttribute('hidden')).toBe(false);
      const card = root.querySelector<HTMLElement>(`#mobile-posts .m-post[data-id="${hex(3)}"]`)!;
      expect(card.classList.contains('is-zapped')).toBe(true);
      expect(document.querySelector('svg.strike')).not.toBeNull();
      expect(document.querySelector('.zap-fx')).toBeNull();
      expect(feedFor(s).pending).toHaveLength(0);
      expect(reveal).toHaveBeenCalledTimes(1);
      const revealed = reveal.mock.contexts[0] as HTMLElement;
      expect(revealed.dataset.id).toBe(hex(3));
      expect(revealed.closest('#mobile-posts')).not.toBeNull();
      expect(scrollTo).not.toHaveBeenCalled();
    } finally { cleanup(); }
  });
  it('pagado un post que no está entre los recientes: Posts arriba de todo y la ráfaga de abajo', async () => {
    const s = new ZapStore();
    s.addPost({ id: hex(100), pubkey: 'a'.repeat(64), content: 'viejo', created_at: now() - 86_400 });
    s.addZap({ ...receipt(150, hex(100)), created_at: now() - 3600 });
    for (let i = 1; i <= 50; i++) s.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post ${i}`, created_at: now() - i });
    s.setReady();
    profiles.set('a'.repeat(64), null);
    const { root, scrollTo, reveal, selected, cleanup } = mount(s);
    try {
      await payFrom(root, 'top', hex(100));
      scrollTo.mockClear();
      s.addZap(receipt(151, hex(100)));
      expect(document.querySelector('dialog')).toBeNull();
      expect(selected()).toBe('posts');
      expect(root.querySelector(`#mobile-posts [data-id="${hex(100)}"]`)).toBeNull();
      expect(scrollTo).toHaveBeenCalledWith(0, 0);
      expect(reveal).not.toHaveBeenCalled();
      expect(document.querySelector('.zap-fx')).not.toBeNull();
      expect(document.querySelector('svg.strike')).toBeNull();
    } finally { cleanup(); }
  });
  it('pagado desde Posts: sigue en Posts y el rayo cae sobre la tarjeta', async () => {
    const s = store();
    const { root, reveal, selected, cleanup } = mount(s);
    try {
      await payFrom(root, 'posts', hex(2));
      s.addZap(receipt(52, hex(2)));
      expect(document.querySelector('dialog')).toBeNull();
      expect(selected()).toBe('posts');
      expect(root.querySelector(`#mobile-posts .m-post[data-id="${hex(2)}"]`)!.classList.contains('is-zapped')).toBe(true);
      expect(document.querySelector('.zap-fx')).toBeNull();
      expect((reveal.mock.contexts[0] as HTMLElement).dataset.id).toBe(hex(2));
    } finally { cleanup(); }
  });
  it('cerrar el modal a mano no cambia de pestaña, ni aunque después llegue el recibo', async () => {
    const s = store();
    const { root, selected, cleanup } = mount(s);
    try {
      const dialog = await payFrom(root, 'top', hex(1));
      dialog.querySelector<HTMLButtonElement>('[data-close]')!.click();
      expect(document.querySelector('dialog')).toBeNull();
      expect(selected()).toBe('top');
      s.addZap(receipt(53, hex(1)));
      expect(selected()).toBe('top');
    } finally { cleanup(); }
  });
  it('openZapDialog avisa onPaid una sola vez, solo con el recibo de su post y nunca al cerrar a mano', async () => {
    const s = store(), onPaid = vi.fn(), invoice = vi.fn().mockResolvedValue('lnbc210n1ptestinvoice');
    openZapDialog(s.posts.get(hex(1))!, defaultConfig.relays, invoice, s, { onPaid });
    await showInvoice();
    s.addZap(receipt(60, hex(2)));
    expect(onPaid).not.toHaveBeenCalled();
    expect(document.querySelector('dialog')).not.toBeNull();
    s.addZap(receipt(61, hex(1)));
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')).toBeNull();
    s.addZap(receipt(62, hex(1)));
    expect(onPaid).toHaveBeenCalledTimes(1);
    const manual = vi.fn();
    openZapDialog(s.posts.get(hex(1))!, defaultConfig.relays, invoice, s, { onPaid: manual });
    const dialog = await showInvoice();
    dialog.querySelector<HTMLButtonElement>('[data-close]')!.click();
    s.addZap(receipt(63, hex(1)));
    expect(manual).not.toHaveBeenCalled();
  });
});

describe('el modal de zap solo se cierra al pagar o con Cancelar', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const open = (s = store(), onPaid = vi.fn()) => {
    const close = openZapDialog(s.posts.get(hex(1))!, defaultConfig.relays, vi.fn().mockResolvedValue('lnbc210n1ptestinvoice'), s, { onPaid });
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    return { s, onPaid, close, dialog };
  };
  const toInvoice = async (dialog: HTMLDialogElement) => {
    dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
  };
  const cancelBtn = (dialog: HTMLDialogElement) => [...dialog.querySelectorAll<HTMLButtonElement>('button')].find((b) => b.textContent?.trim() === 'Cancelar');
  const stillOpen = (dialog: HTMLDialogElement) => { expect(dialog.isConnected).toBe(true); expect(dialog.open).toBe(true); };
  afterEach(() => document.querySelectorAll('dialog').forEach((d) => d.remove()));

  it('no tiene ✕: un botón rojo Cancelar abajo de todo, visible en elegir, monto y factura', async () => {
    const { dialog, onPaid } = open();
    expect(dialog.querySelector('[aria-label="Cerrar"]')).toBeNull();
    expect(dialog.querySelector('header button')).toBeNull();
    const visible = () => {
      const btn = cancelBtn(dialog)!;
      expect(btn).toBeDefined();
      expect(btn.closest('[hidden]')).toBeNull();
      expect(btn.classList.contains('zap-cancel')).toBe(true);
      expect(dialog.lastElementChild).toBe(btn);
    };
    visible(); // payment choices
    dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
    visible(); // amount form
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
    visible(); // invoice
    cancelBtn(dialog)!.click();
    expect(document.querySelector('dialog')).toBeNull();
    expect(onPaid).not.toHaveBeenCalled();
  });
  it('se cierra solo con el recibo de su propia factura (bolt11), no con zaps ajenos al mismo post', async () => {
    const { s, dialog, onPaid } = open();
    await toInvoice(dialog);
    s.addZap({ id: hex(80), postId: hex(1), sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now(), bolt11: 'lnbc210n1potherinvoice' });
    stillOpen(dialog);
    expect(onPaid).not.toHaveBeenCalled();
    s.addZap({ id: hex(82), postId: hex(1), sender: 'd'.repeat(64), msats: 21_000, comment: '', created_at: now() }); // receipt without bolt11
    stillOpen(dialog);
    expect(onPaid).not.toHaveBeenCalled();
    s.addZap({ id: hex(81), postId: hex(1), msats: 21_000, comment: '', created_at: now(), bolt11: 'LNBC210N1PTESTINVOICE' });
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('Escape / gesto atrás (evento cancel) no lo cierra', async () => {
    const { dialog } = open();
    await toInvoice(dialog);
    const cancel = new Event('cancel', { cancelable: true });
    dialog.dispatchEvent(cancel);
    expect(cancel.defaultPrevented).toBe(true);
    stillOpen(dialog);
  });
  it('si el navegador lo cierra igual (atrás sin activación del usuario), se vuelve a abrir y sigue esperando el pago', async () => {
    const { s, dialog, onPaid } = open();
    await toInvoice(dialog);
    dialog.close(); // what Chrome's CloseWatcher does when it skips the cancel event
    await vi.waitFor(() => stillOpen(dialog));
    expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull(); // same invoice, not reset
    s.addZap({ id: hex(70), postId: hex(1), sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now(), bolt11: 'lnbc210n1ptestinvoice' });
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('salir a la wallet y volver (visibilidad, foco, resize, pagehide/pageshow) no lo cierra', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), { requestInvoice: vi.fn().mockResolvedValue('lnbc210n1ptestinvoice') });
    try {
      root.querySelector<HTMLButtonElement>('.zap-btn')!.click();
      const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
      await toInvoice(dialog);
      dialog.querySelector<HTMLAnchorElement>('[data-open-wallet]')!.dispatchEvent(new Event('blur'));
      document.dispatchEvent(new Event('visibilitychange'));
      for (const type of ['blur', 'pagehide', 'pageshow', 'focus', 'resize']) window.dispatchEvent(new Event(type));
      document.dispatchEvent(new Event('visibilitychange'));
      await new Promise((r) => setTimeout(r, 150)); // let coalesced redraws run
      stillOpen(dialog);
      expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull();
    } finally { off(); root.remove(); }
  });
});

describe('pago confirmado: muestra el rayo 3 s (con la página visible) y después cierra', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const setVisibility = (v: 'visible' | 'hidden') => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); };
  beforeEach(() => { PAID_CLOSE_MS.ms = 3000; });
  afterEach(() => { vi.useRealTimers(); setVisibility('visible'); document.querySelectorAll('dialog').forEach((d) => d.remove()); });
  const paidDialog = async () => {
    const s = store(), onPaid = vi.fn();
    openZapDialog(s.posts.get(hex(1))!, defaultConfig.relays, vi.fn().mockResolvedValue('lnbc210n1ptestinvoice'), s, { onPaid });
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
    vi.useFakeTimers();
    return { s, onPaid, dialog, pay: () => s.addZap({ id: hex(90), postId: hex(1), msats: 21_000, comment: '', created_at: now(), bolt11: 'lnbc210n1ptestinvoice' }) };
  };
  it('visible: rayo de éxito en el modal, cierra a los 3 s', async () => {
    const { dialog, onPaid, pay } = await paidDialog();
    pay();
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(dialog.isConnected).toBe(true);
    expect(dialog.querySelector('.zap-paid svg.m-bolt')).not.toBeNull();
    expect(dialog.querySelector('[data-open-wallet]')).toBeNull();
    vi.advanceTimersByTime(2999);
    expect(dialog.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('oculta (en la wallet): los 3 s arrancan al volver a la pestaña', async () => {
    const { dialog, pay } = await paidDialog();
    setVisibility('hidden');
    pay();
    vi.advanceTimersByTime(10_000);
    expect(dialog.isConnected).toBe(true);
    setVisibility('visible');
    vi.advanceTimersByTime(2999);
    expect(dialog.isConnected).toBe(true);
    vi.advanceTimersByTime(1);
    expect(document.querySelector('dialog')).toBeNull();
  });
});
