// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { demoButtons, installDemo, DEMO_TEXTS } from '../src/demo';
import { zapFx } from '../src/zap-fx';
import { Follower } from '../src/follow';
import { positionAt } from '../shared/schedule';
import type { Scene } from '../src/scenes/types';

const NOW = 1_800_000_000;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.demo-buttons button')].find((b) => b.textContent === label)!;

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('botones de simulación (solo desarrollo)', () => {
  it('post(text, pubkey) permite elegir el autor (e2e con un autor zapeable)', () => {
    const s = new ZapStore();
    const id = installDemo({}, s, () => NOW).post('hola', 'e'.repeat(64));
    expect(s.posts.get(id)!.pubkey).toBe('e'.repeat(64));
  });
  it('no existen si el flag de desarrollo está apagado', () => {
    const s = new ZapStore(undefined, { clock: () => NOW });
    expect(demoButtons(document, installDemo({}, s, () => NOW), false, new Follower(document.createElement('main'), []))).toBeNull();
    expect(document.querySelector('.demo-buttons')).toBeNull();
  });
  it('"+ post" publica un post en vivo por el mismo camino del store', () => {
    const s = new ZapStore(undefined, { clock: () => NOW });
    const live: string[] = [];
    s.onLive((e) => live.push(e.type));
    demoButtons(document, installDemo({}, s, () => NOW), true);
    button('+ post').click();
    expect(s.posts.size).toBe(1);
    expect(live).toEqual(['post']);
  });
  it('"splash" muestra la pantalla de carga hasta tocar el botón o la pantalla', () => {
    demoButtons(document, installDemo({}, new ZapStore(undefined, { clock: () => NOW }), () => NOW), true);
    const splash = () => document.querySelector<HTMLElement>('.m-splash');
    button('splash').click();
    expect(splash()).not.toBeNull();
    button('splash').click();
    expect(splash()).toBeNull();
    button('splash').click();
    splash()!.click();
    expect(splash()).toBeNull();
  });
  it('"+ post" y "+ post ⚡" ciclan textos de largos distintos (todos con #lacrypta) para ver cómo cambian las cajas', () => {
    const s = new ZapStore(undefined, { clock: () => NOW });
    demoButtons(document, installDemo({}, s, () => NOW), true);
    for (let i = 0; i < DEMO_TEXTS.length; i++) button(i % 2 ? '+ post ⚡' : '+ post').click();
    const lengths = [...s.posts.values()].map((p) => p.content.length);
    expect(new Set(lengths).size).toBe(DEMO_TEXTS.length);
    expect(Math.min(...lengths)).toBeLessThanOrEqual(15);
    expect(Math.max(...lengths)).toBeGreaterThanOrEqual(200); // the longest one hits the store cap
    expect([...s.posts.values()].every((p) => p.content.includes('#lacrypta'))).toBe(true);
  });
  it('"+ mix" agrega de una vez un post de cada largo, algunos zapeables y con sats', () => {
    const s = new ZapStore(undefined, { clock: () => NOW });
    const zappable = new Set<string>();
    demoButtons(document, installDemo({}, s, () => NOW, zappable), true);
    button('+ mix').click();
    const posts = [...s.posts.values()];
    expect(posts.length).toBeGreaterThanOrEqual(DEMO_TEXTS.length);
    expect(new Set(posts.map((p) => p.content.length)).size).toBe(DEMO_TEXTS.length);
    expect(posts.some((p) => zappable.has(p.pubkey))).toBe(true);
    expect(s.zaps.size).toBeGreaterThan(0);
  });
  it('"+ zap" zapea el post más nuevo (o crea uno) y muestra el rayo con los sats', () => {
    const s = new ZapStore(undefined, { clock: () => NOW });
    const stop = zapFx(s);
    try {
      demoButtons(document, installDemo({}, s, () => NOW), true);
      button('+ zap').click();
      const [zap] = s.zaps.values();
      expect(s.posts.has(zap.postId)).toBe(true);
      expect(s.stats()[0].msats).toBe(zap.msats);
      expect(document.querySelector('.zap-fx.is-on')?.textContent).toMatch(/\d+ sats/);
    } finally { stop(); }
  });
  describe('"+ zap" con mira: el próximo click elige el post', () => {
    const setup = (markup: string) => {
      const s = new ZapStore(undefined, { clock: () => NOW });
      const demo = installDemo({}, s, () => NOW);
      const a = demo.post('a'), b = demo.post('b');
      const scene = document.body.appendChild(document.createElement('main'));
      scene.id = 'scene';
      scene.innerHTML = markup.replace('$A', a).replace('$B', b);
      demoButtons(document, demo, true);
      return { s, a, b, scene };
    };
    const zapped = (s: ZapStore) => [...s.zaps.values()].map((z) => z.postId);
    it.each([
      ['cajas de Últimos mensajes', '<ul class="post-list"><li class="post-row" data-id="$A"><p class="excerpt">a</p></li><li class="post-row" data-id="$B">b</li></ul>'],
      ['barras de la Batalla', '<ol class="batalla"><li data-id="$A"><div class="bar-track"><span class="bar-fill"></span></div></li><li data-id="$B"></li></ol>'],
    ])('%s: arma la mira y el click zapea ESE post', (_, markup) => {
      const { s, a, scene } = setup(markup);
      button('+ zap').click();
      expect(zapped(s)).toEqual([]);
      expect(button('+ zap').getAttribute('aria-pressed')).toBe('true');
      expect(document.documentElement.classList.contains('demo-aiming')).toBe(true); // only aiming shows the crosshair
      expect(document.querySelector('style[data-demo-aim]')!.textContent).toMatch(/html\.demo-aiming[^{]*\{[^}]*crosshair !important/);
      (scene.querySelector(`[data-id="${a}"]`)!.firstElementChild as HTMLElement ?? scene.querySelector(`[data-id="${a}"]`)!).dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(zapped(s)).toEqual([a]);
      expect(button('+ zap').getAttribute('aria-pressed')).toBe('false');
      expect(document.documentElement.classList.contains('demo-aiming')).toBe(false);
    });
    it('Esc o click fuera de un post cancela sin zapear', () => {
      const { s, scene } = setup('<h1>t</h1><ul><li class="post-row" data-id="$A"></li></ul>');
      button('+ zap').click();
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      expect(button('+ zap').getAttribute('aria-pressed')).toBe('false');
      expect(document.documentElement.classList.contains('demo-aiming')).toBe(false);
      button('+ zap').click();
      scene.querySelector('h1')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      expect(button('+ zap').getAttribute('aria-pressed')).toBe('false');
      expect(zapped(s)).toEqual([]);
    });
  });
  it('quedan fuera de #scene, así que siguen disponibles cuando la rotación redibuja la escena', () => {
    const scene = document.body.appendChild(document.createElement('main'));
    scene.id = 'scene';
    demoButtons(document, installDemo({}, new ZapStore(), () => NOW), true);
    scene.innerHTML = '<h1>otra escena</h1>';
    expect(button('+ post').closest('#scene')).toBeNull();
    expect(button('+ zap').isConnected).toBe(true);
  });

  describe('flechas de escena (locales) y ▷ reloj', () => {
    // base 6000 ms + 10 s video every 2 cycles: period 22 s; at t=500 the clock says "post"
    const D = { post: 1000, batalla: 2000, anuncio: 3000 };
    const K = { epoch: 0, sceneDurations: D, videoEveryCycles: 2, videoMode: 'full' as const, videoClipSeconds: 21, videoDurationSec: 10, version: 1 };
    const names = ['post', 'batalla', 'anuncio', 'video'];
    const T0 = 1_700_000_000_000;
    const setup = async () => {
      vi.useFakeTimers();
      vi.setSystemTime(T0);
      const clock = () => Date.now() - T0 + 500;
      const fetchFn = vi.fn(async (url: string, init?: RequestInit) => ({ ok: true, json: async () => (url === '/api/time' ? { now: clock() } : url === '/api/kiosk' ? K : { version: 1 }), init }));
      const scene = document.body.appendChild(document.createElement('main'));
      const fol = new Follower(scene, names.map((name) => ({ name, render: (r: HTMLElement) => { r.textContent = name; } }) as Scene), { fetchFn: fetchFn as any, clock, pollMs: 60_000 });
      await fol.start();
      demoButtons(document, installDemo({}, new ZapStore(), () => NOW), true, fol);
      return { scene, fetchFn, clock, fol };
    };

    it('▶/◀ recorren la rotación con vuelta y dejan de seguir el reloj', async () => {
      const { scene, fol } = await setup();
      try {
        expect(scene.textContent).toBe('post');
        button('▶').click();
        expect(scene.textContent).toBe('batalla');
        button('◀').click();
        button('◀').click(); // before the first scene: the last one of the previous cycle (no video in that cycle)
        expect(scene.textContent).toBe('anuncio');
        await vi.advanceTimersByTimeAsync(30_000); // the clock moves on, the screen stays
        expect(scene.textContent).toBe('anuncio');
      } finally { fol.stop(); }
    });

    it('▷ reloj se resalta en pausa y vuelve a la escena que marca el reloj', async () => {
      const { scene, clock, fol } = await setup();
      try {
        expect(button('▷ reloj').disabled).toBe(true); // already following the clock
        button('▶').click();
        expect(button('▷ reloj').disabled).toBe(false);
        await vi.advanceTimersByTimeAsync(3_000);
        button('▷ reloj').click();
        expect(scene.textContent).toBe(positionAt(K, clock()).scene);
        expect(button('▷ reloj').disabled).toBe(true);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(scene.textContent).toBe(positionAt(K, clock()).scene); // following the clock again
      } finally { fol.stop(); }
    });

    it('las flechas no escriben nada en el servidor', async () => {
      const { fetchFn, fol } = await setup();
      try {
        const before = fetchFn.mock.calls.length;
        button('▶').click(); button('◀').click(); button('▷ reloj').click();
        expect(fetchFn.mock.calls.length).toBe(before);
        expect(fetchFn.mock.calls.every(([, init]) => !init?.method || init.method === 'GET')).toBe(true);
      } finally { fol.stop(); }
    });
  });
  it('"+ post ⚡" crea un post de un autor marcado como zapeable (rayo verde)', () => {
    const s = new ZapStore(undefined, { clock: () => NOW });
    const zappable = new Set<string>();
    demoButtons(document, installDemo({}, s, () => NOW, zappable), true);
    button('+ post ⚡').click();
    const [post] = [...s.posts.values()];
    expect(zappable.has(post!.pubkey)).toBe(true);
  });
});
