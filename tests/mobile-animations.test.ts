// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMobile, SPLASH_MS, MOBILE_VIEW_KEY } from '../src/mobile';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';
import { feedFor } from '../src/livefeed';
import { zapFx } from '../src/zap-fx';
import { decode } from 'nostr-tools/nip19';
import { noteUri } from '../src/nostr/link';

afterEach(() => document.querySelectorAll('svg.strike, .strike-gain, .m-live').forEach((e) => e.remove()));
afterEach(() => { localStorage.clear(); sessionStorage.clear(); }); // pending invoices and the view state persist across mounts
import { hex } from './mobile-helpers';
beforeEach(() => Object.assign(SPLASH_MS, { min: 0, max: 0 })); // behavior after loading; the loading screen has its own tests


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
  it('Top: zap = rayo real sobre la fila (sin ícono simbólico) y la fila que entra al Top anima como en el tótem', () => {
    vi.useFakeTimers();
    const { s, root, off } = setup();
    document.body.append(root);
    const stop = zapFx(s);
    try {
      root.querySelector<HTMLButtonElement>('[data-tab="top"]')!.click();
      s.addZap(zap());
      vi.advanceTimersByTime(100);
      const row = root.querySelector<HTMLElement>(`.m-top-row[data-id="${hex(1)}"]`)!;
      expect(row.classList.contains('is-zapped')).toBe(true);
      expect(row.classList.contains('is-new')).toBe(true); // entered the Top list
      expect(document.querySelector('svg.strike')).not.toBeNull();
      expect(document.querySelector('.zap-fx')).toBeNull();
      expect(document.querySelector('.m-live .live-ind')).toBeNull();
      s.addZap({ ...zap(), id: hex(1003) });
      vi.advanceTimersByTime(100);
      expect(root.querySelector(`.m-top-row[data-id="${hex(1)}"]`)!.classList.contains('is-new')).toBe(false); // already listed
      expect(document.querySelector('.m-live .live-ind')).toBeNull();
      document.querySelectorAll('svg.strike').forEach((e) => e.remove());
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
      expect(root2.querySelector('#mobile-top .skel')).not.toBeNull(); // textos pendientes: skeletons
      expect(root3.querySelector('#mobile-posts .skel')).not.toBeNull();
      expect(root3.textContent).not.toContain('Todavía no hay posts'); // nunca afirmar vacío antes de tiempo
      s.setReady(); s2.setReady(); s3.setReady();
      vi.advanceTimersByTime(100);
      expect(root.querySelectorAll('.pending')).toHaveLength(0);
      expect(root.querySelector('.m-total')!.textContent).toContain('210');
      expect(root.querySelector('#mobile-top')!.textContent).toContain('210');
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
  it('post y zap nuevos: el ícono del tótem (globito / rayo) entra desde arriba y sale en una dirección al azar, sin mostrar el contenido', () => {
    const ids = (() => { const { root, off } = setup(); const r = [...root.querySelectorAll<HTMLElement>('.m-reel .m-post')].map((c) => c.dataset.id); off(); return r; })();
    sessionStorage.setItem(MOBILE_VIEW_KEY, JSON.stringify({ tab: 'posts', post: ids[1] })); // scrolled away from the newest
    const { s, off } = setup();
    try {
      s.addPost(post(3, NOW - 5));
      const ind = document.querySelector<HTMLElement>('.m-live .live-ind.post')!;
      expect(ind.querySelector('svg')).not.toBeNull();
      expect(ind.textContent).toBe('');
      expect(ind.style.getPropertyValue('--ex')).not.toBe('');
      s.addZap(zap());
      expect(document.querySelector('.m-live .live-ind.zap svg')).not.toBeNull();
      off();
      expect(document.querySelector('.m-live')).toBeNull();
    } finally { off(); }
  });
  it('en el último post sigue a los nuevos solo (sin flecha); al volver al último se reactiva', () => {
    vi.useFakeTimers();
    const { root, off } = setup();
    try {
      const newest = root.querySelector<HTMLElement>('.m-reel .m-post')!.dataset.id;
      sessionStorage.setItem(MOBILE_VIEW_KEY, JSON.stringify({ tab: 'posts', post: newest }));
      off();
      const v = setup();
      v.s.addPost(post(3, NOW - 5));
      vi.advanceTimersByTime(100);
      expect(v.root.querySelector('[data-newer]')).toBeNull();
      expect(document.querySelector('.m-live .live-ind.post')).toBeNull(); // following: just move, no icon
      expect(JSON.parse(sessionStorage.getItem(MOBILE_VIEW_KEY)!).post).toBe(hex(3));
      v.s.addPost(post(4, NOW - 4));
      vi.advanceTimersByTime(100);
      expect(JSON.parse(sessionStorage.getItem(MOBILE_VIEW_KEY)!).post).toBe(hex(4)); // still following
      v.off();
    } finally { off(); vi.useRealTimers(); }
  });
  it('flecha a lo último si llega un post mientras se lee otro; tocarla va al más nuevo y la oculta', () => {
    vi.useFakeTimers();
    const ids = (() => { const { root, off } = setup(); const r = [...root.querySelectorAll<HTMLElement>('.m-reel .m-post')].map((c) => c.dataset.id); off(); return r; })();
    sessionStorage.setItem(MOBILE_VIEW_KEY, JSON.stringify({ tab: 'posts', post: ids[1] })); // reading an older post
    const { s, root, off } = setup();
    try {
      expect(root.querySelector('[data-newer]')).toBeNull();
      s.addPost(post(3, NOW - 5));
      vi.advanceTimersByTime(100);
      const arrow = root.querySelector<HTMLButtonElement>('#mobile-posts [data-newer]')!;
      expect(document.querySelector('.m-live .live-ind.post')).not.toBeNull(); // scrolled away: icon drops in
      expect(arrow.textContent).toContain('Ver último post');
      arrow.click();
      expect(root.querySelector('[data-newer]')).toBeNull();
      expect(JSON.parse(sessionStorage.getItem(MOBILE_VIEW_KEY)!).post).toBe(hex(3));
    } finally { off(); vi.useRealTimers(); }
  });
  it('barra lateral: tocar o arrastrar salta a cualquier post, con indicador de posición y burbuja; el último reactiva el auto-follow', () => {
    vi.useFakeTimers();
    const { s, root, off } = setup();
    s.addPost(post(3, NOW - 5)); s.addPost(post(4, NOW - 4)); s.addPost(post(5, NOW - 3));
    vi.advanceTimersByTime(100);
    try {
      const ids = [...root.querySelectorAll<HTMLElement>('.m-reel .m-post')].map((c) => c.dataset.id);
      const bar = root.querySelector<HTMLElement>('#mobile-posts .m-scrub[role="slider"]')!;
      expect(bar.getAttribute('aria-valuemax')).toBe('5');
      expect(bar.getAttribute('aria-valuenow')).toBe('1');
      bar.getBoundingClientRect = () => ({ top: 100, height: 500, bottom: 600, left: 0, right: 20, width: 20, x: 0, y: 100 }) as DOMRect;
      bar.setPointerCapture = () => {};
      bar.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100 + 500 * 0.7, pointerId: 1, bubbles: true })); // 70%: 4th of 5
      expect(JSON.parse(sessionStorage.getItem(MOBILE_VIEW_KEY)!).post).toBe(ids[3]);
      expect(bar.getAttribute('aria-valuenow')).toBe('4');
      expect(bar.querySelector('.m-scrub-bubble')!.textContent).toBe('4 / 5');
      expect(bar.querySelector<HTMLElement>('.m-scrub-thumb')!.style.top).toBe('75%');
      s.addPost(post(6, NOW - 2)); // away from the newest: arrow, no follow
      vi.advanceTimersByTime(100);
      expect(root.querySelector('[data-newer]')).not.toBeNull();
      const bar2 = root.querySelector<HTMLElement>('.m-scrub')!;
      bar2.getBoundingClientRect = bar.getBoundingClientRect; bar2.setPointerCapture = () => {};
      bar2.dispatchEvent(new PointerEvent('pointerdown', { clientY: 100, pointerId: 1, bubbles: true }));
      bar2.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, bubbles: true }));
      expect(root.querySelector('[data-newer]')).toBeNull(); // newest again: following
      expect(JSON.parse(sessionStorage.getItem(MOBILE_VIEW_KEY)!).post).toBe(hex(6));
      expect(bar2.classList.contains('is-dragging')).toBe(false);
      bar2.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
      expect(bar2.getAttribute('aria-valuenow')).toBe('2');
    } finally { off(); vi.useRealTimers(); }
  });
  it('el rayo golpea el centro del box zapeado (Últimos y Top)', () => {
    vi.useFakeTimers();
    const rect = { left: 0, top: 300, width: 390, height: 100, right: 390, bottom: 400, x: 0, y: 300 } as DOMRect;
    const spy = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(rect);
    const { s, root, off } = setup();
    document.body.append(root);
    try {
      s.addZap(zap());
      expect(document.querySelector('circle.impact')!.getAttribute('cy')).toBe('350');
      document.querySelectorAll('svg.strike, .strike-gain').forEach((e) => e.remove());
      root.querySelector<HTMLButtonElement>('[data-tab="top"]')!.click();
      s.addZap({ ...zap(), id: hex(1005) });
      vi.advanceTimersByTime(100);
      expect(document.querySelector('circle.impact')!.getAttribute('cx')).toBe('195');
      expect(document.querySelector('circle.impact')!.getAttribute('cy')).toBe('350');
    } finally { spy.mockRestore(); off(); root.remove(); vi.useRealTimers(); }
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
