// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { postScene } from '../src/scenes/post';
import { latestZapsScene } from '../src/scenes/latestZaps';

const store = () => {
  const s = new ZapStore();
  s.addPost({ id: 'd'.repeat(64), pubkey: 'e'.repeat(64), content: 'texto', created_at: 1 });
  s.addZap({ id: 'z', postId: 'd'.repeat(64), msats: 1000, comment: 'c', created_at: 2 });
  return s;
};

describe('las escenas ajustan el texto a su región', () => {
  it('post: texto, autor y lista de zaps marcados y ajustados (también en vivo)', () => {
    const s = store(), root = document.createElement('div');
    postScene(s, 1).render(root);
    for (const sel of ['.post-content', '.author', '.zaps ul']) {
      const el = root.querySelector<HTMLElement>(sel)!;
      expect(el.dataset.fit, sel).toBeTruthy();
      expect(el.style.fontSize, sel).toMatch(/px$/);
    }
    s.addZap({ id: 'z2', postId: 'd'.repeat(64), msats: 1000, comment: '', created_at: 3 });
    expect(root.querySelector<HTMLElement>('.zaps ul')!.style.fontSize).toMatch(/px$/);
  });
  it('últimos zaps: lista ajustada', () => {
    const root = document.createElement('div');
    latestZapsScene(store(), 1).render(root);
    const ul = root.querySelector<HTMLElement>('.zap-list')!;
    expect(ul.dataset.fit).toBe('list');
    expect(ul.style.fontSize).toMatch(/px$/);
  });
});

import { top10HistoricoScene } from '../src/scenes/top10Historico';

describe('listas con tope de fuente y mensajes que se priorizan', () => {
  it('post, últimos zaps y tops: max ≤ 3.2vh, tope en vw y líneas de mensaje marcadas [data-clip]', () => {
    const s = store();
    for (const [scene, sel, line] of [[postScene(s, 1), '.zaps ul', '.zaps li'], [latestZapsScene(s, 1), '.zap-list', '.zap-list .who'], [top10HistoricoScene(s, 1), '.top-list', '.top-list .excerpt']] as const) {
      const root = document.createElement('div');
      scene.render(root);
      const ul = root.querySelector<HTMLElement>(sel)!;
      expect(Number(ul.dataset.max), sel).toBeLessThanOrEqual(3.2);
      expect(ul.dataset.maxw, sel).toBeTruthy();
      expect(root.querySelector(line)!.hasAttribute('data-clip'), line).toBe(true);
    }
  });
});
