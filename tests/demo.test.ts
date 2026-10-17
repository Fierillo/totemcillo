// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { demoButtons, installDemo } from '../src/demo';
import { zapFx } from '../src/zap-fx';

const NOW = 1_800_000_000;
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>('.demo-buttons button')].find((b) => b.textContent === label)!;

afterEach(() => { document.body.innerHTML = ''; });

describe('botones de simulación (solo desarrollo)', () => {
  it('no existen si el flag de desarrollo está apagado', () => {
    const s = new ZapStore(undefined, { clock: () => NOW });
    expect(demoButtons(document, installDemo({}, s, () => NOW), false)).toBeNull();
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
});
