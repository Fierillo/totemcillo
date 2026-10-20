// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderMobile, isMobileViewport } from '../src/mobile';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';
import { feedFor } from '../src/livefeed';
import { zapFx } from '../src/zap-fx';
import { decode } from 'nostr-tools/nip19';
import { noteUri } from '../src/nostr/link';
import { openZapDialog, type InvoiceRequester } from '../src/zap-dialog';

afterEach(() => document.querySelectorAll('svg.strike').forEach((e) => e.remove()));
afterEach(() => localStorage.clear()); // pending invoices persist across mounts
import { profiles } from '../src/nostr/profiles';

const hex = (n: number) => n.toString(16).padStart(64, '0');
const store = () => {
  const s = new ZapStore();
  for (let i = 1; i <= 3; i++) s.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post <i>${i}</i>`, created_at: Math.floor(Date.now() / 1000) - i * 60 });
  s.addZap({ id: 'z', postId: hex(1), sender: 'b'.repeat(64), msats: 21000, comment: 'genial', created_at: Math.floor(Date.now() / 1000) });
  s.setReady();
  profiles.set('a'.repeat(64), null);
  return s;
};

describe('vista móvil (misma ruta, layout scrolleable)', () => {
  /** Abre el diálogo y genera la factura de prueba. */
  const walletInvoice = async (invoice: InvoiceRequester) => {
    const root = document.createElement('div');
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), invoice);
    root.querySelector<HTMLButtonElement>('.zap-btn')!.click();
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    dialog.querySelector<HTMLButtonElement>('[data-wallet]')!.click();
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[data-open-wallet]')).not.toBeNull());
    return { dialog, off };
  };

  // Redraw coalescing itself is covered by `live` in scenes.test.ts; here we only check the final DOM.
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
  it('conserva todas las secciones en pestañas, sin QR ni ajuste de fuente de kiosko', () => {
    const root = document.createElement('div');
    renderMobile(root, store(), defaultConfig, new Announcement('Sorteo a las 18'));
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['📣 Anuncio', 'Posts', '⚡ Últimos zaps', 'Top 10 zaps · histórico', `Top 10 zaps · últimas ${defaultConfig.topRecentHours} horas`]);
    expect(root.querySelector('.qr')).toBeNull();
    expect(root.querySelector('[data-fit]')).toBeNull();
    expect(root.textContent).toContain('Sorteo a las 18');
  });
  it('los Top muestran cada post como en Posts, con su puesto y ordenados por sats', () => {
    const root = document.createElement('div'), s = store();
    s.addZap({ id: 'z2', postId: hex(2), sender: 'b'.repeat(64), msats: 50_000, comment: '', created_at: Math.floor(Date.now() / 1000) });
    const off = renderMobile(root, s, defaultConfig, new Announcement(''));
    try {
      for (const id of ['#mobile-top', '#mobile-recent']) {
        const cards = root.querySelectorAll(`${id} .m-post`);
        expect([...cards].map((c) => c.querySelector('.m-rank')!.textContent)).toEqual(['#1', '#2']);
        expect(cards[0].querySelector('.m-excerpt')!.textContent).toBe('post <i>2</i>');
        expect(cards[0].querySelector('.m-meta .author')!.textContent).toBe('aaaaaaaa…aaaa');
        expect(cards[0].querySelector('.m-meta')!.textContent).toContain('hace');
        expect(cards[0].querySelector('.m-total')!.textContent).toContain('50 sats');
        expect(cards[0].querySelector('.zap-btn')).not.toBeNull();
      }
      expect(root.querySelector('#mobile-posts .m-rank')).toBeNull();
    } finally { off(); }
  });
  it('abre Posts por defecto, cambia de pestaña y conserva la selección al actualizar datos', () => {
    const root = document.createElement('div'), s = store(), ann = new Announcement('Sorteo a las 18');
    const off = renderMobile(root, s, defaultConfig, ann);
    try {
      const active = () => root.querySelector<HTMLElement>('[role="tabpanel"]:not([hidden])');
      expect(root.querySelectorAll('[role="tab"]')).toHaveLength(4);
      expect(active()?.querySelectorAll('.m-post')).toHaveLength(3);
      expect(root.querySelector('.m-announcement')?.closest('[role="tabpanel"]')).toBeNull();
      const tab = () => [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === 'Zaps')!;
      tab().click();
      expect(active()?.textContent).toContain('Últimos zaps');
      expect(root.querySelector('.m-announcement')?.textContent).toContain('Sorteo a las 18');
      expect(root.querySelectorAll('[role="tabpanel"]:not([hidden])')).toHaveLength(1);
      expect(tab().getAttribute('aria-selected')).toBe('true');
      ann.set('Cambio de horario');
      s.addPost({ id: hex(8), pubkey: 'a'.repeat(64), content: 'nuevo post', created_at: Math.floor(Date.now() / 1000) });
      expect(tab().getAttribute('aria-selected')).toBe('true');
      expect(active()?.textContent).toContain('Últimos zaps');
      expect(root.querySelector('.m-announcement')?.textContent).toContain('Cambio de horario');
      [...root.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find((t) => t.textContent === 'Posts')!.click();
      expect(active()?.querySelectorAll('.m-post')).toHaveLength(4);
      off();
      tab().click();
      expect(active()?.querySelector('.m-post')).not.toBeNull();
    } finally { off(); }
  });
  it('Zapear ofrece cliente Nostr o wallet anónima y conserva la alternativa njump', () => {
    const root = document.createElement('div');
    const invoice = vi.fn();
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), invoice);
    try {
    // Card content (excerpt, author, total) is covered by the Top test above.
    const posts = root.querySelectorAll('#mobile-posts .m-post');
    expect(posts[0].querySelector('.m-zaps')).toBeNull();
    expect(posts[0].textContent).not.toContain('genial');
    const btn = posts[0].querySelector<HTMLButtonElement>('.zap-btn')!;
    expect(btn.textContent).toContain('Zapear');
    expect(btn.tagName).toBe('BUTTON');
    btn.click();
    const dialog = document.querySelector<HTMLDialogElement>('dialog')!;
    expect(dialog.open).toBe(true);
    expect(dialog.querySelector('[data-nostr-client]')?.getAttribute('href')).toMatch(/^nostr:nevent1/);
    expect(dialog.textContent).toContain('Zapear desde cliente de Nostr');
    expect(dialog.textContent).toContain('Zapear desde wallet');
    expect(dialog.textContent).toContain('Pago anónimo en Nostr');
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
      expect(current().textContent).toBe('Zaps');
      key('End');
      expect(current().textContent).toBe(`Top ${defaultConfig.topRecentHours}h`);
      key('ArrowRight');
      expect(current().textContent).toBe('Posts');
      key('ArrowLeft');
      expect(current().textContent).toBe(`Top ${defaultConfig.topRecentHours}h`);
      key('Home');
      expect(current().textContent).toBe('Posts');
      expect(root.querySelectorAll('[role="tab"][tabindex="0"]')).toHaveLength(1);
    } finally { off(); }
  });
  it('genera la factura anónima solo al confirmar el monto y mantiene el diálogo durante actualizaciones', async () => {
    const root = document.createElement('div'), s = store(), ann = new Announcement('');
    let finish!: (invoice: string) => void;
    const invoice = vi.fn(() => new Promise<string>((resolve) => { finish = resolve; }));
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    const off = renderMobile(root, s, defaultConfig, ann, invoice);
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
      expect(dialog.textContent).toContain('No es una confirmación de pago');
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
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), invoice);
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
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), invoice);
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

describe('enlaces Nostr', () => {
  const post = { id: 'd'.repeat(64), pubkey: 'e'.repeat(64), content: 'x', created_at: 1 };
  const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
  const nevent = (uri: string) => uri.match(/nevent1[02-9ac-hj-np-z]+/)![0];
  it('incluye id, autor, kind y dos hints; admite nostr y njump', () => {
    const uri = noteUri(post, relays, 'nostr:{nevent}')!;
    expect(uri).toMatch(/^nostr:nevent1/);
    const decoded = decode(nevent(uri));
    expect(decoded.type).toBe('nevent');
    expect(decoded.data).toMatchObject({ id: post.id, author: post.pubkey, kind: 1, relays: relays.slice(0, 2) });
    expect(noteUri(post, relays, 'https://njump.me/{nevent}')).toMatch(/^https:\/\/njump\.me\/nevent1[a-z0-9]+$/);
  });
  it('omite autores inválidos y rechaza ids inválidos', () => {
    const decoded = decode(nevent(noteUri({ ...post, pubkey: '<img>' }, [], 'nostr:{nevent}')!));
    expect((decoded.data as any).author).toBeUndefined();
    expect(noteUri({ ...post, id: 'zz' }, relays, 'nostr:{nevent}')).toBeNull();
  });
});

describe('animaciones móviles', () => {
  const NOW = 1_800_000_000;
  const post = (n: number, created_at = NOW - 3600) => ({ id: hex(n), pubkey: 'a'.repeat(64), content: `post ${n}`, created_at });
  const zap = (created_at = NOW) => ({ id: hex(1001), postId: hex(1), sender: 'b'.repeat(64), msats: 210_000, comment: '', created_at });
  const setup = () => {
    const s = new ZapStore(undefined, { clock: () => NOW }); s.addPost(post(1)); s.addPost(post(2)); s.setReady();
    const root = document.createElement('div'), off = renderMobile(root, s, defaultConfig, new Announcement(''));
    return { s, root, off };
  };
  it('zap con otra pestaña abierta: ráfaga de abajo, sin rayo; en Posts: rayo, sin ráfaga', () => {
    vi.useFakeTimers();
    const { s, root, off } = setup();
    document.body.append(root);
    const stop = zapFx(s);
    try {
      root.querySelector<HTMLButtonElement>('[data-tab="zaps"]')!.click();
      s.addZap(zap());
      expect(document.querySelector('.zap-fx')).not.toBeNull();
      expect(document.querySelector('svg.strike')).toBeNull();
      document.querySelector('.zap-fx')!.remove();
      root.querySelector<HTMLButtonElement>('[data-tab="posts"]')!.click();
      s.addZap({ ...zap(), id: hex(1002) });
      vi.advanceTimersByTime(100); // redraws are coalesced
      expect(document.querySelector('svg.strike')).not.toBeNull();
      expect(document.querySelector('.zap-fx')).toBeNull();
    } finally { stop(); off(); root.remove(); vi.useRealTimers(); }
  });
  it('muestra los totales acumulados con mini ruedita y skeletons en textos hasta que el backfill termina', () => {
    vi.useFakeTimers();
    const s = new ZapStore(undefined, { clock: () => NOW });
    s.addPost(post(1));
    s.addZap(zap());
    const root = document.createElement('div'), off = renderMobile(root, s, defaultConfig, new Announcement(''));
    const s2 = new ZapStore(undefined, { clock: () => NOW });
    s2.addPost(post(2));
    const root2 = document.createElement('div'), off2 = renderMobile(root2, s2, defaultConfig, new Announcement(''));
    const s3 = new ZapStore(undefined, { clock: () => NOW });
    const root3 = document.createElement('div'), off3 = renderMobile(root3, s3, defaultConfig, new Announcement(''));
    try {
      expect(root.querySelector('.m-total .pending')!.textContent).toBe('210 sats'); // total parcial: el número parpadea
      expect(root.querySelector('.m-total')!.textContent).toContain('210');
      expect(root.querySelector('#mobile-top .pending')).not.toBeNull();
      expect(root.querySelector('#mobile-recent .pending')).not.toBeNull();
      expect(root.querySelector('#mobile-zaps .pending')).toBeNull(); // un zap suelto ya es definitivo
      expect(root2.querySelector('#mobile-zaps .skel')).not.toBeNull(); // textos pendientes: skeletons
      expect(root2.querySelector('#mobile-top .skel')).not.toBeNull();
      expect(root2.querySelector('#mobile-recent .skel')).not.toBeNull();
      expect(root3.querySelector('#mobile-posts .skel')).not.toBeNull();
      expect(root3.textContent).not.toContain('Todavía no hay posts'); // nunca afirmar vacío antes de tiempo
      s.setReady(); s2.setReady(); s3.setReady();
      vi.advanceTimersByTime(100);
      expect(root.querySelectorAll('.pending')).toHaveLength(0);
      expect(root.querySelector('.m-total')!.textContent).toContain('210');
      expect(root.querySelector('#mobile-zaps')!.textContent).toContain('210');
      expect(root2.querySelectorAll('.m-skel-post, .m-skel-rows')).toHaveLength(0);
      expect(root2.textContent).toContain('Todavía no hay zaps');
      expect(root3.textContent).toContain('Todavía no hay posts');
    } finally { off(); off2(); off3(); vi.useRealTimers(); }
  });
  it('anima posts recientes una vez, nunca historial', () => {
    vi.useFakeTimers();
    const { s, root, off } = setup();
    try {
      expect(root.querySelector('.is-new')).toBeNull();
      s.addPost(post(3, NOW - 5));
      expect(root.querySelector(`.m-post[data-id="${hex(3)}"]`)!.classList.contains('is-new')).toBe(true);
      expect(root.querySelectorAll('.is-new')).toHaveLength(1);
      s.addPost(post(4));
      vi.advanceTimersByTime(100);
      expect(root.querySelector('.is-new')).toBeNull();
    } finally { off(); vi.useRealTimers(); }
  });
  it('marca el post zapeado y actualiza el total con un rayo', () => {
    const { s, root, off } = setup();
    try {
      s.addZap(zap());
      const card = root.querySelector(`.m-post[data-id="${hex(1)}"]`)!;
      expect(card.classList.contains('is-zapped')).toBe(true);
      expect(document.querySelector('svg.strike')).not.toBeNull();
      expect(card.querySelector('.m-total')!.textContent).toContain('210');
      expect(root.querySelectorAll('.is-zapped')).toHaveLength(1);
    } finally { off(); }
  });
  it('no anima zaps históricos', () => {
    const { s, root, off } = setup();
    try { s.addZap(zap(NOW - 3600)); expect(root.querySelector('.is-zapped')).toBeNull(); }
    finally { off(); }
  });
  it('consume eventos visibles sin pendientes y deja de consumirlos al cerrar', () => {
    const { s, off } = setup();
    let indicators = 0; feedFor(s).onMiss(() => indicators++);
    s.addZap(zap()); s.addPost(post(9, NOW - 1));
    expect(indicators).toBe(0);
    expect(feedFor(s).pending).toHaveLength(0);
    off(); s.addZap({ ...zap(), id: hex(1002) });
    expect(indicators).toBe(1);
  });
});

describe('pago confirmado desde el modal móvil', () => {
  const now = () => Math.floor(Date.now() / 1000);
  const receipt = (n: number, postId: string) => ({ id: hex(n), postId, sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now() });
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
    root.querySelector<HTMLButtonElement>(`#mobile-${tab} [data-zap="${postId}"]`)!.click();
    return showInvoice();
  };
  // Same wiring order as main.ts: zapFx (and so the shared LiveFeed) subscribes to the store before the mobile view and the dialog.
  const mount = (s: ZapStore) => {
    const root = document.createElement('div');
    document.body.append(root);
    const stop = zapFx(s);
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), vi.fn().mockResolvedValue('lnbc210n1ptestinvoice'));
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
    s.addZap({ id: hex(70), postId: hex(1), sender: 'c'.repeat(64), msats: 21_000, comment: '', created_at: now() });
    expect(onPaid).toHaveBeenCalledTimes(1);
    expect(document.querySelector('dialog')).toBeNull();
  });
  it('salir a la wallet y volver (visibilidad, foco, resize, pagehide/pageshow) no lo cierra', async () => {
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), vi.fn().mockResolvedValue('lnbc210n1ptestinvoice'));
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
