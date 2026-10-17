// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { demoButtons, installDemo } from '../src/demo';
import { zapFx } from '../src/zap-fx';
import { Follower } from '../src/follow';
import { positionAt } from '../shared/schedule';
import type { Scene } from '../src/scenes/types';

const NOW = 1_800_000_000;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.demo-buttons button')].find((b) => b.textContent === label)!;

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('botones de simulación (solo desarrollo)', () => {
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
    const D = { post: 1000, latestZaps: 2000, top10Historico: 1000, top10Ultimas3h: 1000, anuncio: 1000 };
    const K = { epoch: 0, sceneDurations: D, videoEveryCycles: 2, videoMode: 'full' as const, videoClipSeconds: 21, videoDurationSec: 10, version: 1 };
    const names = ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio', 'video'];
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
        expect(scene.textContent).toBe('latestZaps');
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
        expect(scene.textContent).toBe('top10Historico');
        expect(button('▷ reloj').disabled).toBe(true);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(scene.textContent).toBe('top10Ultimas3h'); // following the clock again
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
});
