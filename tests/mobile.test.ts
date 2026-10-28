// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMobile, isMobileViewport, MOBILE_FONT, MOBILE_POST_MAX_CHARS, SPLASH_MS, MOBILE_VIEW_KEY } from '../src/mobile';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';
import { PAID_CLOSE_MS, type InvoiceRequester } from '../src/zap-dialog';

afterEach(() => document.querySelectorAll('svg.strike, .strike-gain, .m-live').forEach((e) => e.remove()));
afterEach(() => { localStorage.clear(); sessionStorage.clear(); }); // pending invoices and the view state persist across mounts
import { hex, store } from './mobile-helpers';
beforeEach(() => { PAID_CLOSE_MS.ms = 0; }); // closes at once; the 3 s success pause has its own tests
beforeEach(() => Object.assign(SPLASH_MS, { min: 0, max: 0 })); // behavior after loading; the loading screen has its own tests


describe('vista móvil (misma ruta, layout scrolleable)', () => {
  beforeEach(() => Object.assign(SPLASH_MS, { min: 0, max: 0 })); // behavior after loading; the loading screen has its own tests
  it('mobile no corta el post en 210: guarda hasta MOBILE_POST_MAX_CHARS (tope para el localStorage) y muestra el texto completo', () => {
    expect(MOBILE_POST_MAX_CHARS).toBe(2000);
    const s = new ZapStore(undefined, { postMaxChars: MOBILE_POST_MAX_CHARS });
    const long = 'palabra '.repeat(75).trim(); // ~600 chars
    s.addPost({ id: hex(9), pubkey: 'a'.repeat(64), content: long, created_at: Math.floor(Date.now() / 1000) - 5 });
    s.addPost({ id: hex(8), pubkey: 'a'.repeat(64), content: 'x'.repeat(3000), created_at: Math.floor(Date.now() / 1000) - 50 });
    s.setReady();
    expect(s.posts.get(hex(8))!.content.length).toBeLessThanOrEqual(MOBILE_POST_MAX_CHARS);
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, s, defaultConfig, new Announcement(''));
    try { expect(root.querySelector(`.m-post[data-id="${hex(9)}"]`)!.textContent).toContain(long); } finally { off(); root.remove(); }
  });
  /** Abre el diálogo y genera la factura de prueba. */
  const walletInvoice = async (invoice: InvoiceRequester) => {
    const root = document.createElement('div');
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), { requestInvoice: invoice });
    root.querySelector<HTMLButtonElement>('.zap-btn')!.click();
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
    return { dialog, off };
  };
  it('agrupa los redibujos de una ráfaga conservando todos los posts visibles', () => {
    vi.useFakeTimers();
    const root = document.createElement('div'), s = new ZapStore();
    const off = renderMobile(root, s, defaultConfig, new Announcement(''));
    try {
      for (let i = 0; i < 30; i++) s.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post ${i}`, created_at: i });
      vi.advanceTimersByTime(100);
      expect(root.querySelectorAll('#mobile-posts .m-post')).toHaveLength(30);
    } finally { off(); vi.useRealTimers(); }
  });
  it('detecta viewport angosto', () => {
    expect(isMobileViewport({ matchMedia: (q: string) => ({ matches: q.includes('max-width: 700px') }) } as any)).toBe(true);
    expect(isMobileViewport({ matchMedia: () => ({ matches: false }) } as any)).toBe(false);
  });
  it('solo dos pestañas (Últimos posts y Top posts), sin QR ni ajuste de fuente de kiosko', () => {
    const root = document.createElement('div');
    renderMobile(root, store(), defaultConfig, new Announcement('Sorteo a las 18'));
    expect([...root.querySelectorAll('[role="tab"]')].map((h) => h.textContent)).toEqual(['Últimos posts', 'Top posts']);
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['📣 Anuncio', 'Últimos posts', 'Top posts']);
    expect(root.querySelector('.qr')).toBeNull();
    expect(root.querySelector('[data-fit]')).toBeNull();
    expect(root.textContent).toContain('Sorteo a las 18');
  });
  it('Últimos posts: feed vertical a pantalla completa con el zap en una columna lateral', () => {
    const root = document.createElement('div');
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''));
    try {
      expect(root.querySelector('#mobile-posts .m-reel')).not.toBeNull();
      const cards = root.querySelectorAll('#mobile-posts .m-reel > .m-post');
      expect(cards).toHaveLength(3);
      expect(cards[0].querySelector('.m-meta .author')).not.toBeNull();
      // a single bolt: the side zap button carries the total; no separate total line
      const zap = cards[0].querySelector<HTMLButtonElement>('.m-side button.zap-btn.m-total')!;
      expect(zap.textContent).toContain('21 sats');
      expect(cards[0].querySelectorAll('.m-total')).toHaveLength(1);
      expect(cards[0].textContent).not.toContain('⚡'); // neon SVG bolt instead of the emoji
      expect(zap.querySelectorAll('svg.m-bolt')).toHaveLength(1);
      // bolt, then the (larger) sats number, then «Zapear» below it
      expect(zap.querySelector('svg.m-bolt + .m-zap-sats')?.textContent).toBe('21 sats');
      expect(zap.textContent).not.toContain('Zapear'); // the bolt only shows the total
      // «Zapear» is its own button at the bottom of the card, opening the same modal
      const cta = cards[0].querySelector<HTMLButtonElement>('button.m-zap-cta')!;
      expect(cta.textContent!.trim()).toBe('Zapear');
      expect(cards[0].lastElementChild).toBe(cta);
      expect(cta.dataset.zap).toBe(zap.dataset.zap);
      expect(cta.disabled).toBe(false);
      cta.click();
      expect(document.querySelector('dialog.zap-dialog')?.hasAttribute('open')).toBe(true);
      document.querySelectorAll('dialog').forEach((d) => d.remove());
    } finally { off(); }
  });
  it('un redibujado justo después de scrollear (antes del evento scroll) no pierde la posición del feed', () => {
    // Like a browser: a detached element's scrollTop reads 0.
    const desc = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop')!;
    const at = new WeakMap<Element, number>();
    Object.defineProperty(Element.prototype, 'scrollTop', { configurable: true, get() { return this.isConnected ? at.get(this) ?? 0 : 0; }, set(v: number) { at.set(this, v); } });
    const root = document.createElement('div');
    document.body.append(root);
    const s = store();
    const off = renderMobile(root, s, defaultConfig, new Announcement(''));
    try {
      root.querySelector<HTMLElement>('.m-reel')!.scrollTop = 500; // no scroll event yet
      s.addZap({ id: 'z2', postId: hex(2), sender: 'b'.repeat(64), msats: 1000, comment: '', created_at: Math.floor(Date.now() / 1000) });
      expect(root.querySelector<HTMLElement>('.m-reel')!.scrollTop).toBe(500);
    } finally { off(); root.remove(); Object.defineProperty(Element.prototype, 'scrollTop', desc); }
  });
  it('un post sin zaps muestra sólo el rayo (sin "0 sats")', () => {
    const root = document.createElement('div');
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''));
    try {
      const zap = root.querySelectorAll('#mobile-posts .m-reel > .m-post')[1].querySelector('.m-total')!;
      expect(zap.querySelectorAll('svg.m-bolt')).toHaveLength(1);
      expect(zap.textContent!.trim()).toBe(''); // never "0 sats"
    } finally { off(); }
  });
  it('el anuncio se pliega al tocar su título y titila cuando llega uno nuevo hasta que lo abrís', () => {
    const root = document.createElement('div'), ann = new Announcement('Sorteo a las 18');
    const off = renderMobile(root, store(), defaultConfig, ann);
    try {
      const head = () => root.querySelector<HTMLButtonElement>('.m-announcement h2 button[data-ann]')!;
      const body = () => root.querySelector<HTMLElement>('.m-announcement .m-ann-body')!;
      expect(head().getAttribute('aria-expanded')).toBe('false');
      expect(body().hidden).toBe(true);
      expect(head().classList.contains('is-unread')).toBe(true); // never seen: blinks
      head().click();
      expect(head().getAttribute('aria-expanded')).toBe('true');
      expect(body().hidden).toBe(false);
      expect(body().textContent).toContain('Sorteo a las 18');
      expect(head().classList.contains('is-unread')).toBe(false);
      head().click();
      expect(body().hidden).toBe(true);
      ann.set('Sorteo a las 18'); // same text: still seen
      expect(head().classList.contains('is-unread')).toBe(false);
      ann.set('Cambio de horario');
      expect(head().classList.contains('is-unread')).toBe(true);
      // the last seen text survives a reload; an empty announcement never blinks
      const again = document.createElement('div'), off2 = renderMobile(again, store(), defaultConfig, new Announcement('Sorteo a las 18'));
      expect(again.querySelector('[data-ann]')!.classList.contains('is-unread')).toBe(false);
      off2();
      const none = document.createElement('div'), off3 = renderMobile(none, store(), defaultConfig, new Announcement(''));
      expect(none.querySelector('[data-ann]')!.classList.contains('is-unread')).toBe(false);
      off3();
    } finally { off(); }
  });
  it('vuelve a ajustar el texto cuando terminan de cargar las fuentes', async () => {
    const root = document.createElement('div'), s = store();
    s.addPost({ id: hex(7), pubkey: 'a'.repeat(64), content: 'mediano '.repeat(8).trim(), created_at: Math.floor(Date.now() / 1000) });
    let room = 3000, loaded!: () => void; // fake area: the real font is wider than the fallback
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise<void>((r) => { loaded = r; }) } });
    const m = { fits: (el: HTMLElement) => el.textContent!.length * parseFloat(el.style.fontSize) <= room, setSize: (el: HTMLElement, px: number) => { el.style.fontSize = `${px}px`; } };
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), { measure: m });
    try {
      const ex = () => root.querySelector<HTMLElement>(`#mobile-posts .m-post[data-id="${hex(7)}"] .m-excerpt`)!;
      expect(ex().style.fontSize).toBe(`${MOBILE_FONT.max}px`);
      room = 1200;
      loaded();
      await new Promise((r) => setTimeout(r, 0));
      expect(parseFloat(ex().style.fontSize)).toBeLessThan(MOBILE_FONT.max);
    } finally { off(); delete (document as { fonts?: unknown }).fonts; }
  });
  it('al desplazar el feed guarda qué post está en pantalla', () => {
    sessionStorage.setItem(MOBILE_VIEW_KEY, JSON.stringify({ tab: 'posts', post: hex(2) }));
    const root = document.createElement('div');
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''));
    try {
      const reel = root.querySelector<HTMLElement>('.m-reel')!;
      reel.scrollTop = 0;
      reel.dispatchEvent(new Event('scroll'));
      expect(JSON.parse(sessionStorage.getItem(MOBILE_VIEW_KEY)!).post).toBe(hex(1));
    } finally { off(); }
  });
  it('recuerda pestaña, fila expandida y posición de Top tras recargar', () => {
    sessionStorage.setItem(MOBILE_VIEW_KEY, JSON.stringify({ tab: 'top', open: [hex(1)], topScroll: 120 }));
    const root = document.createElement('div');
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''));
    try {
      expect(root.querySelector('[role="tab"][aria-selected="true"]')!.getAttribute('data-tab')).toBe('top');
      expect(root.querySelector(`#mobile-top .m-top-row[data-id="${hex(1)}"] .m-post`)).not.toBeNull();
      expect(root.querySelector<HTMLElement>('#mobile-top')!.scrollTop).toBe(120);
      root.querySelector<HTMLButtonElement>(`#mobile-top .m-top-row[data-id="${hex(1)}"] .m-top-head`)!.click(); // collapse
      root.querySelector<HTMLButtonElement>('[data-tab="posts"]')!.click();
      const saved = JSON.parse(sessionStorage.getItem(MOBILE_VIEW_KEY)!);
      expect(saved).toMatchObject({ tab: 'posts', open: [] });
      expect(saved.post).toBe(hex(1)); // post on screen in the feed
    } finally { off(); }
  });
  it('mensajes largos: achica la fuente hasta el mínimo y recién ahí trunca, sin scroll', () => {
    const root = document.createElement('div'), s = store();
    s.addPost({ id: hex(7), pubkey: 'a'.repeat(64), content: 'palabra '.repeat(40).trim(), created_at: Math.floor(Date.now() / 1000) });
    s.addPost({ id: hex(6), pubkey: 'a'.repeat(64), content: 'mediano '.repeat(8).trim(), created_at: Math.floor(Date.now() / 1000) - 1 });
    // fake layout: the box fits 1200 "px·chars"
    const m = { fits: (el: HTMLElement) => el.textContent!.length * parseFloat(el.style.fontSize) <= 1200, setSize: (el: HTMLElement, px: number) => { el.style.fontSize = `${px}px`; } };
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), { measure: m });
    try {
      const ex = (id: string) => root.querySelector<HTMLElement>(`#mobile-posts .m-post[data-id="${id}"] .m-excerpt`)!;
      expect(ex(hex(1)).style.fontSize).toBe(`${MOBILE_FONT.max}px`); // short: untouched max
      const mid = parseFloat(ex(hex(6)).style.fontSize);
      expect(mid).toBeLessThan(MOBILE_FONT.max);
      expect(mid).toBeGreaterThanOrEqual(MOBILE_FONT.min);
      expect(MOBILE_FONT).toEqual({ max: 32, min: 10 }); // shrink further before truncating
      expect(ex(hex(6)).textContent).not.toContain('…');
      expect(ex(hex(7)).style.fontSize).toBe(`${MOBILE_FONT.min}px`);
      expect(ex(hex(7)).textContent!.endsWith('…')).toBe(true);
    } finally { off(); }
  });
  it('Top posts: filas de una línea ordenadas por sats, monto primero; tocar expande y vuelve a tocar colapsa', () => {
    const root = document.createElement('div'), s = store();
    s.addZap({ id: 'z2', postId: hex(2), sender: 'b'.repeat(64), msats: 50_000, comment: '', created_at: Math.floor(Date.now() / 1000) });
    const off = renderMobile(root, s, defaultConfig, new Announcement(''));
    try {
      const rows = () => [...root.querySelectorAll<HTMLElement>('#mobile-top .m-top-row')];
      expect(rows().map((r) => r.dataset.id)).toEqual([hex(2), hex(1)]);
      const head = rows()[0].querySelector<HTMLButtonElement>('button.m-top-head')!;
      expect(head.firstElementChild!.classList.contains('m-top-sats')).toBe(true);
      expect(head.querySelector('.m-top-sats')!.textContent).toContain('50');
      expect(head.querySelector('.m-top-line')!.textContent).toBe('post <i>2</i>');
      expect(head.getAttribute('aria-expanded')).toBe('false');
      expect(rows()[0].querySelector('.m-post')).toBeNull();
      expect(head.querySelector('.m-top-sats svg.m-bolt')).not.toBeNull(); // same neon bolt as the side button
      expect(head.textContent).not.toContain('⚡');
      head.click();
      const card = rows()[0].querySelector('.m-post')!;
      expect(card.querySelector('.m-excerpt')!.textContent).toBe('post <i>2</i>');
      expect(card.querySelector('.m-meta')!.textContent).toContain('hace');
      expect(card.querySelectorAll('svg.m-bolt')).toHaveLength(1);
      expect(card.querySelectorAll('.m-side button.zap-btn.m-total[data-zap]')).toHaveLength(1); // one side zap button with the total
      expect(card.querySelector('.m-total')!.textContent).toContain('sats');
      expect(card.textContent).not.toContain('⚡');
      expect(rows()[0].querySelector('button.m-top-head')!.getAttribute('aria-expanded')).toBe('true');
      rows()[0].querySelector<HTMLButtonElement>('button.m-top-head')!.click();
      expect(rows()[0].querySelector('.m-post')).toBeNull();
    } finally { off(); }
  });
  it('botón flotante para escribir en ambas pestañas, que abre el editor', () => {
    const root = document.createElement('div');
    const compose = vi.fn();
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), { compose });
    try {
      expect(root.querySelector('.m-fab')!.closest('[role="tabpanel"]')).toBeNull();
      const fab = root.querySelector<HTMLButtonElement>('.m-fab')!;
      expect(fab.textContent!.trim()).toBe('Mandá mensaje anónimo');
      expect(fab.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
      expect(fab.hasAttribute('aria-label')).toBe(false); // the visible text is the name
      root.querySelector<HTMLButtonElement>('[data-tab="top"]')!.click();
      root.querySelector<HTMLButtonElement>('.m-fab')!.click();
      expect(compose).toHaveBeenCalledTimes(1);
    } finally { off(); }
  });
  it('abre Posts por defecto, cambia de pestaña y conserva la selección al actualizar datos', () => {
    const root = document.createElement('div'), s = store(), ann = new Announcement('Sorteo a las 18');
    const off = renderMobile(root, s, defaultConfig, ann);
    try {
      const active = () => root.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
      expect(root.querySelectorAll('[role="tab"]')).toHaveLength(2);
      expect(active()?.querySelectorAll('.m-post')).toHaveLength(3);
      expect(root.querySelector('.m-announcement')?.closest('[role="tabpanel"]')).toBeNull();
      const tab = () => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === 'Top posts')!;
      tab().click();
      expect(active()?.querySelector('.m-top-row')).not.toBeNull();
      expect(root.querySelector('.m-announcement')?.textContent).toContain('Sorteo a las 18');
      expect(root.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
      expect(tab().getAttribute('aria-selected')).toBe('true');
      ann.set('Cambio de horario');
      s.addPost({ id: hex(8), pubkey: 'a'.repeat(64), content: 'nuevo post', created_at: Math.floor(Date.now() / 1000) });
      expect(tab().getAttribute('aria-selected')).toBe('true');
      expect(active()?.querySelector('.m-top-row')).not.toBeNull();
      expect(root.querySelector('.m-announcement')?.textContent).toContain('Cambio de horario');
      [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === 'Últimos posts')!.click();
      expect(active()?.querySelectorAll('.m-post')).toHaveLength(4);
      off();
      tab().click();
      expect(active()?.querySelector('.m-post')).not.toBeNull();
    } finally { off(); }
  });
  it('Zapear ofrece cliente Nostr o wallet anónima y conserva la alternativa njump', () => {
    const root = document.createElement('div');
    const invoice = vi.fn();
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), { requestInvoice: invoice });
    try {
    // Card content (excerpt, author, total) is covered by the Top test above.
    const posts = root.querySelectorAll('#mobile-posts .m-post');
    expect(posts[0].querySelector('.m-zaps')).toBeNull();
    expect(posts[0].textContent).not.toContain('genial');
    const btn = posts[0].querySelector<HTMLButtonElement>('.zap-btn')!;
    expect(btn.getAttribute('aria-label')).toContain('Zapear');
    expect(btn.tagName).toBe('BUTTON');
    btn.click();
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-nostr-client]')?.getAttribute('href')).toMatch(/^nostr:nevent1/);
    // short labels, each with its icon; no repeated "Zapear" nor explanatory text
    expect(dialog.querySelector('h2')!.textContent).toBe('Zapear');
    expect(dialog.querySelector('[data-nostr-client]')!.textContent!.trim()).toBe('Cliente Nostr');
    expect(dialog.querySelector('[data-wallet]')!.textContent!.trim()).toBe('Wallet anónima');
    expect(dialog.querySelector('[data-nostr-client] svg.zap-icon')).not.toBeNull();
    expect(dialog.querySelector('[data-nostr-client] svg.zap-icon path[fill="#662482"]')).not.toBeNull(); // the community nostrich icon (CC0)
    expect(dialog.querySelector('[data-wallet] svg.zap-icon')).not.toBeNull();
    expect(dialog.querySelectorAll('.zap-choices small, img')).toHaveLength(0);
    expect(dialog.textContent!.match(/Zapear/g)).toHaveLength(1);
    expect(dialog.textContent).not.toContain('no se vinculará');
    expect(invoice).not.toHaveBeenCalled();
    const alt = posts[0].querySelector<HTMLAnchorElement>('a.zap-alt')!;
    expect(alt.getAttribute('href')).toMatch(/^https:\/\/njump\.me\/nevent1/);
    expect(alt.getAttribute('target')).toBe('_blank');
    expect(alt.getAttribute('rel')).toContain('noopener');
    } finally { off(); }
  });
  it('permite recorrer las pestañas con flechas, Inicio y Fin', () => {
    const root = document.createElement('div');
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''));
    try {
      const current = () => root.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')!;
      const key = (value: string) => current().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true }));
      key('ArrowRight');
      expect(current().textContent).toBe('Top posts');
      key('ArrowRight');
      expect(current().textContent).toBe('Últimos posts');
      key('End');
      expect(current().textContent).toBe('Top posts');
      key('Home');
      expect(current().textContent).toBe('Últimos posts');
      expect(root.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
    } finally { off(); }
  });
  it('genera la factura anónima solo al confirmar el monto y mantiene el diálogo durante actualizaciones', async () => {
    const root = document.createElement('div'), s = store(), ann = new Announcement('');
    let finish!: (invoice: string) => void;
    const invoice = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const off = renderMobile(root, s, defaultConfig, ann, { requestInvoice: invoice });
    try {
      root.querySelector<HTMLButtonElement>('.zap-btn')!.click();
      const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
      dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
      const form = dialog.querySelector<HTMLFormElement>('form')!;
      expect(form.hidden).toBe(false);
      expect(invoice).not.toHaveBeenCalled();
      form.querySelector<HTMLInputElement>('input[name="sats"]')!.value = '42';
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      expect(invoice).toHaveBeenCalledTimes(1);
      expect(invoice).toHaveBeenCalledWith(s.posts.get(hex(1)), 42);
      ann.set('Anuncio actualizado');
      expect(document.querySelector('dialog')).toBe(dialog);
      expect(dialog.open).toBe(true);
      finish('lnbc420n1ptestinvoice');
      await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')?.getAttribute('href')).toBe('lightning:lnbc420n1ptestinvoice'));
      expect(dialog.querySelector('.wallet-qr svg')).not.toBeNull();
      expect(dialog.querySelector('textarea')).toBeNull();
      const qr = dialog.querySelector<HTMLButtonElement>('button.wallet-qr')!;
      expect(qr.getAttribute('aria-label')).toBe('Copiar factura');
      qr.click();
      await vi.waitFor(() => expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Factura copiada'));
      expect(copy).toHaveBeenCalledWith('lnbc420n1ptestinvoice');
      expect(dialog.textContent).toContain('El total se actualiza al confirmarse el pago');
      expect(s.zaps.size).toBe(1);
    } finally { off(); copy.mockRestore(); }
  });
  it('copia con el método heredado si el portapapeles moderno está bloqueado', async () => {
    const invoice = vi.fn().mockResolvedValue('lnbc210n1ptestinvoice');
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('bloqueado'));
    const exec = vi.fn(() => true) as unknown as typeof document.execCommand;
    const original = document.execCommand;
    document.execCommand = exec;
    const { dialog, off } = await walletInvoice(invoice);
    try {
      dialog.querySelector<HTMLButtonElement>('button.wallet-qr')!.click();
      await vi.waitFor(() => expect(dialog.querySelector('[role="status"]')?.textContent).toBe('Factura copiada'));
      expect(exec).toHaveBeenCalled();
      expect(dialog.querySelector('[data-manual]')).toBeNull();
    } finally { off(); write.mockRestore(); document.execCommand = original; }
  });
  it('deja la factura seleccionable a mano si ningún método de copia funciona', async () => {
    const invoice = vi.fn().mockResolvedValue('lnbc210n1ptestinvoice');
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('bloqueado'));
    const original = document.execCommand;
    document.execCommand = (() => false) as unknown as typeof document.execCommand;
    const { dialog, off } = await walletInvoice(invoice);
    try {
      dialog.querySelector<HTMLButtonElement>('button.wallet-qr')!.click();
      await vi.waitFor(() => expect(dialog.querySelector('[data-manual]')).not.toBeNull());
      expect(dialog.querySelector<HTMLTextAreaElement>('[data-manual]')!.value).toBe('lnbc210n1ptestinvoice');
      expect(dialog.querySelector('[role="status"]')?.textContent).toContain('Seleccioná la factura');
    } finally { off(); write.mockRestore(); document.execCommand = original; }
  });
  it('muestra errores de generación sin declarar un pago y permite reintentar explícitamente', async () => {
    const root = document.createElement('div');
    const invoice = vi.fn().mockRejectedValueOnce(new Error('Proveedor no disponible')).mockResolvedValue('lnbc210n1ptestinvoice');
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), { requestInvoice: invoice });
    try {
      root.querySelector<HTMLButtonElement>('.zap-btn')!.click();
      const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
      dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
      const form = dialog.querySelector('form')!;
      const submit = () => form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      submit();
      await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')?.textContent).toBe('Proveedor no disponible'));
      expect(form.hidden).toBe(false);
      expect(dialog.querySelector<HTMLButtonElement>('[type="submit"]')?.disabled).toBe(false);
      expect(dialog.querySelector('[data-open-wallet]')).toBeNull();
      expect(invoice).toHaveBeenCalledTimes(1);
      submit();
      await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
      expect(invoice).toHaveBeenCalledTimes(2);
    } finally { off(); }
  });
  it('al llegar el recibo del pago cierra el modal y anima el comentario zapeado', async () => {
    const root = document.createElement('div');
    const s = store();
    const invoice = vi.fn().mockResolvedValue('lnbc210n1ptestinvoice');
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), { requestInvoice: invoice });
    try {
      root.querySelector<HTMLButtonElement>('.zap-btn')!.click();
      const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
      dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
      dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
      s.addZap({ id: hex(9), postId: hex(1), sender: hex(8), msats: 21_000, comment: '', created_at: Math.floor(Date.now() / 1000) });
      await vi.waitFor(() => expect(document.querySelector('dialog')).toBeNull());
      expect(root.querySelector('.m-post.is-zapped')).not.toBeNull();
      expect(document.querySelector('svg.strike')).not.toBeNull();
    } finally { off(); }
  });

  it('se actualiza en vivo y deja de hacerlo al limpiar', () => {
    const root = document.createElement('div');
    const s = store();
    const ann = new Announcement('');
    const cleanup = renderMobile(root, s, defaultConfig, ann);
    expect(root.textContent).toContain('Sin anuncios por ahora');
    ann.set('Nuevo anuncio');
    expect(root.textContent).toContain('Nuevo anuncio');
    s.addPost({ id: hex(9), pubkey: 'a'.repeat(64), content: 'recién', created_at: Math.floor(Date.now() / 1000) });
    expect(root.querySelector('.m-post .m-excerpt')!.textContent).toBe('recién');
    cleanup();
    ann.set('otro');
    expect(root.textContent).not.toContain('otro');
  });
  it('estados vacíos', () => {
    const root = document.createElement('div');
    const s = new ZapStore();
    s.setReady();
    renderMobile(root, s, defaultConfig, new Announcement(''));
    expect(root.textContent).toContain('Todavía no hay posts con #lacrypta');
    expect(root.textContent).toContain('Todavía no hay zaps');
  });
});
