// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderMobile, SPLASH_MS } from '../src/mobile';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';

afterEach(() => document.querySelectorAll('svg.strike, .strike-gain, .m-live').forEach((e) => e.remove()));
afterEach(() => { localStorage.clear(); sessionStorage.clear(); }); // pending invoices and the view state persist across mounts
import { hex, store } from './mobile-helpers';
beforeEach(() => Object.assign(SPLASH_MS, { min: 0, max: 0 })); // behavior after loading; the loading screen has its own tests


describe('vista móvil: pantalla de carga, zapeabilidad y redibujos', () => {
  beforeEach(() => Object.assign(SPLASH_MS, { min: 0, max: 0 }));
  it('pantalla de carga: espera los rayos definitivos (canZap de los autores del feed) y una ventana quieta; no espera relays ni perfiles', async () => {
    vi.useFakeTimers();
    Object.assign(SPLASH_MS, { min: 700, max: 8000 });
    const s = store(); // posts by 'a' from the saved copy
    let resolve!: (ok: boolean) => void;
    const canZap = vi.fn(() => new Promise<boolean>((r) => { resolve = r; }));
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), { canZap: canZap });
    try {
      const splash = () => document.querySelector('.m-splash');
      expect(splash()?.getAttribute('role')).toBe('status');
      s.addZap({ id: 'zl', postId: hex(1), sender: 'b'.repeat(64), msats: 5000, comment: '', created_at: Math.floor(Date.now() / 1000) });
      await vi.advanceTimersByTimeAsync(1500);
      expect(splash()!.classList.contains('is-out')).toBe(false); // bolts not final yet
      expect(document.querySelector('.strike, .live-ind, .is-zapped')).toBeNull(); // no effects while it is up
      resolve(false);
      await vi.advanceTimersByTimeAsync(150);
      expect(splash()!.classList.contains('is-out')).toBe(false); // the red bolts just landed: wait for a quiet window
      await vi.advanceTimersByTimeAsync(500);
      expect(splash()!.classList.contains('is-out')).toBe(true);
      expect(root.querySelector('.is-unzappable')).not.toBeNull(); // final state under the fade
      await vi.advanceTimersByTimeAsync(500);
      expect(splash()).toBeNull();
    } finally { off(); root.remove(); vi.useRealTimers(); }
  });
  it('pantalla de carga: el observador de tareas largas se desconecta al terminar y al desmontar', async () => {
    vi.useFakeTimers();
    Object.assign(SPLASH_MS, { min: 0, max: 200 });
    const disconnect = vi.fn();
    const orig = globalThis.PerformanceObserver;
    (globalThis as any).PerformanceObserver = class { observe() {} disconnect() { disconnect(); } };
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''));
    try {
      await vi.advanceTimersByTimeAsync(400);
      expect(disconnect).toHaveBeenCalled();
      disconnect.mockClear();
      off();
      expect(disconnect).toHaveBeenCalled();
    } finally { (globalThis as any).PerformanceObserver = orig; root.remove(); vi.useRealTimers(); }
  });
  it('pantalla de carga: si canZap o las fuentes nunca terminan, se va igual a los 8 s', async () => {
    vi.useFakeTimers();
    Object.assign(SPLASH_MS, { min: 700, max: 8000 });
    Object.defineProperty(document, 'fonts', { configurable: true, value: { ready: new Promise(() => {}) } });
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), { canZap: () => new Promise<boolean>(() => {}) });
    try {
      await vi.advanceTimersByTimeAsync(7000);
      expect(document.querySelector('.m-splash:not(.is-out)')).not.toBeNull();
      expect(document.querySelector(".m-splash-title")?.textContent).toBe("Totemcillo");
      await vi.advanceTimersByTimeAsync(1600);
      expect(document.querySelector('.m-splash')).toBeNull();
    } finally { off(); root.remove(); vi.useRealTimers(); delete (document as { fonts?: unknown }).fonts; }
  });
  it('sin tirones: varios canZap que resuelven juntos redibujan una sola vez y un redibujo no mueve el scroll en curso', async () => {
    vi.useFakeTimers();
    const s = store();
    s.addPost({ id: hex(4), pubkey: 'c'.repeat(64), content: 'otro', created_at: Math.floor(Date.now() / 1000) - 400 });
    s.addPost({ id: hex(6), pubkey: 'd'.repeat(64), content: 'otro más', created_at: Math.floor(Date.now() / 1000) - 500 });
    const done: ((ok: boolean) => void)[] = [];
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), { canZap: () => new Promise<boolean>((r) => done.push(r)) });
    try {
      await vi.advanceTimersByTimeAsync(200);
      const reel = root.querySelector<HTMLElement>('.m-reel')!;
      reel.scrollTop = 37; // mid-gesture, between two snaps
      let rebuilt = 0;
      new MutationObserver((ms) => { rebuilt += ms.filter((m) => [...m.addedNodes].some((n) => (n as Element).classList?.contains('m-tabs'))).length; }).observe(root, { childList: true });
      done.forEach((r) => r(false));
      await vi.advanceTimersByTimeAsync(300);
      expect(rebuilt).toBe(1);
      expect(root.querySelector<HTMLElement>('.m-reel')!.scrollTop).toBe(37);
    } finally { off(); root.remove(); vi.useRealTimers(); }
  });
  it('canZap cacheado: muestra lo guardado al instante y, si la revalidación cambia, el rayo se actualiza', async () => {
    let upd!: (ok: boolean) => void;
    const canZap = vi.fn((_pk: string, update?: (ok: boolean) => void) => { upd = update!; return Promise.resolve(true); });
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, store(), defaultConfig, new Announcement(''), { canZap: canZap });
    try {
      await vi.waitFor(() => expect(canZap).toHaveBeenCalled());
      expect(root.querySelector('.is-unzappable')).toBeNull();
      upd(false);
      await vi.waitFor(() => expect(root.querySelector(`.m-post[data-id="${hex(1)}"] .zap-btn.is-unzappable`)).not.toBeNull());
    } finally { off(); root.remove(); }
  });
  it('Top: solo autores confirmados zapeables; mientras se resuelve no aparece (sin parpadeo) y el no zapeable nunca entra', async () => {
    const s = store(); // hex(1) by 'a' has 21 sats
    s.addPost({ id: hex(4), pubkey: 'c'.repeat(64), content: 'zapeable', created_at: Math.floor(Date.now() / 1000) - 10 });
    s.addZap({ id: 'z4', postId: hex(4), sender: 'b'.repeat(64), msats: 5000, comment: '', created_at: Math.floor(Date.now() / 1000) });
    const done: Record<string, (ok: boolean) => void> = {};
    const canZap = (pk: string) => new Promise<boolean>((r) => { done[pk] = r; });
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), { canZap: canZap });
    try {
      expect(root.querySelectorAll('.m-top-row').length).toBe(0); // pending: hidden
      done['a'.repeat(64)](false);
      done['c'.repeat(64)](true);
      await vi.waitFor(() => expect(root.querySelector(`.m-top-row[data-id="${hex(4)}"]`)).not.toBeNull());
      expect(root.querySelector(`.m-top-row[data-id="${hex(1)}"]`)).toBeNull();
    } finally { off(); root.remove(); }
  });
  it('post no zapeable (el autor no tiene wallet que acepte zaps): rayo rojo cancelado y deshabilitado, en el feed y en Top', async () => {
    const s = store();
    s.addPost({ id: hex(4), pubkey: 'c'.repeat(64), content: 'zapeable', created_at: Math.floor(Date.now() / 1000) - 10 });
    const canZap = vi.fn(async (pk: string) => pk === 'c'.repeat(64));
    const root = document.createElement('div');
    document.body.append(root);
    const off = renderMobile(root, s, defaultConfig, new Announcement(''), { canZap: canZap });
    try {
      await vi.waitFor(() => expect(root.querySelector(`.m-post[data-id="${hex(1)}"] .zap-btn.is-unzappable`)).not.toBeNull());
      expect(canZap).toHaveBeenCalledTimes(2); // once per author
      const off1 = root.querySelector<HTMLButtonElement>(`.m-post[data-id="${hex(1)}"] .zap-btn`)!;
      expect(off1.getAttribute('aria-disabled')).toBe('true');
      expect(off1.hasAttribute('data-zap')).toBe(false);
      expect(off1.getAttribute('aria-label')).toContain('No se puede zapear');
      expect(off1.getAttribute('aria-label')).not.toMatch(/sats/);
      expect(off1.textContent!.trim()).toBe(''); // only the red bolt, no sats
      expect(off1.querySelector('svg.m-bolt .m-bolt-x')).not.toBeNull();
      off1.click();
      expect(document.querySelector('dialog')).toBeNull();
      const ok = root.querySelector<HTMLButtonElement>(`.m-post[data-id="${hex(4)}"] .zap-btn`)!;
      expect(ok.classList.contains('is-unzappable')).toBe(false);
      expect(ok.dataset.zap).toBe(hex(4));
      expect(root.querySelector(`.m-top-row[data-id="${hex(1)}"]`)).toBeNull(); // not zappable: out of the Top ranking
    } finally { off(); root.remove(); }
  });
  // Redraw coalescing itself is covered by `live` in scenes.test.ts; here we only check the final DOM.
});
