// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { renderMobile, isMobileViewport } from '../src/mobile';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';
import { feedFor } from '../src/livefeed';
import { decode } from 'nostr-tools/nip19';
import { noteUri } from '../src/nostr/link';
import { profiles } from '../src/nostr/profiles';

const hex = (n: number) => n.toString(16).padStart(64, '0');
const store = () => {
  const s = new ZapStore();
  for (let i = 1; i <= 3; i++) s.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post <i>${i}</i>`, created_at: Math.floor(Date.now() / 1000) - i * 60 });
  s.addZap({ id: 'z', postId: hex(1), sender: 'b'.repeat(64), msats: 21000, comment: 'genial', created_at: Math.floor(Date.now() / 1000) });
  profiles.set('a'.repeat(64), null);
  return s;
};

describe('vista móvil (misma ruta, layout scrolleable)', () => {
  it('agrupa los redibujos de una ráfaga conservando todos los posts visibles', () => {
    vi.useFakeTimers();
    const root = document.createElement('div'), s = new ZapStore();
    const writes = vi.spyOn(root, 'innerHTML', 'set');
    const off = renderMobile(root, s, defaultConfig, new Announcement(''));
    try {
      for (let i = 0; i < 30; i++) s.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post ${i}`, created_at: i });
      expect(writes).toHaveBeenCalledTimes(2);
      vi.advanceTimersByTime(100);
      expect(writes).toHaveBeenCalledTimes(3);
      expect(root.querySelectorAll('.m-post')).toHaveLength(30);
    } finally { off(); writes.mockRestore(); vi.useRealTimers(); }
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
  it('cada post tiene botón Zapear (nostr:) y alternativa njump', () => {
    const root = document.createElement('div');
    renderMobile(root, store(), defaultConfig, new Announcement(''));
    const posts = root.querySelectorAll('.m-post');
    expect(posts).toHaveLength(3);
    expect(posts[0].querySelector('.m-excerpt')!.textContent).toBe('post <i>1</i>');
    expect(posts[0].querySelector('.m-total')!.textContent).toContain('21');
    expect(posts[0].querySelector('.m-meta .author')!.textContent).toBe('aaaaaaaa…aaaa');
    expect(posts[0].querySelector('.m-meta')!.textContent).toContain('hace');
    expect(posts[0].querySelector('.m-zaps')).toBeNull();
    expect(posts[0].textContent).not.toContain('genial');
    const btn = posts[0].querySelector<HTMLAnchorElement>('a.zap-btn')!;
    expect(btn.textContent).toContain('Zapear');
    expect(btn.getAttribute('href')).toMatch(/^nostr:nevent1/);
    const alt = posts[0].querySelector<HTMLAnchorElement>('a.zap-alt')!;
    expect(alt.getAttribute('href')).toMatch(/^https:\/\/njump\.me\/nevent1/);
    expect(alt.getAttribute('target')).toBe('_blank');
    expect(alt.getAttribute('rel')).toContain('noopener');
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
    renderMobile(root, new ZapStore(), defaultConfig, new Announcement(''));
    expect(root.textContent).toContain('Todavía no hay posts con #lacrypta / #labitconf');
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
    const s = new ZapStore(undefined, { clock: () => NOW }); s.addPost(post(1)); s.addPost(post(2));
    const root = document.createElement('div'), off = renderMobile(root, s, defaultConfig, new Announcement(''));
    return { s, root, off };
  };
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
      expect(card.querySelector('.m-total svg.bolt')).not.toBeNull();
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
    let indicators = 0; feedFor(s).setIndicator(() => indicators++);
    s.addZap(zap()); s.addPost(post(9, NOW - 1));
    expect(indicators).toBe(0);
    expect(feedFor(s).pending).toHaveLength(0);
    off(); s.addZap({ ...zap(), id: hex(1002) });
    expect(indicators).toBe(1);
  });
});
