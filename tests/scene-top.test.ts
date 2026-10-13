// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { top10HistoricoScene } from '../src/scenes/top10Historico';
import { sats } from '../src/util';

const setup = () => {
  const s = new ZapStore();
  for (let i = 0; i < 12; i++) {
    s.addPost({ id: `p${i}`, pubkey: 'a'.repeat(64), content: `Post ${i} <b>x</b>`, created_at: 1 });
    s.addZap({ id: `z${i}`, postId: `p${i}`, msats: (i + 1) * 1000, comment: '', created_at: 100 + i });
  }
  s.addZap({ id: 'huerfano', postId: 'borrado', msats: 50_000, comment: '', created_at: 50 });
  return { s, root: document.createElement('div') };
};

describe('top10HistoricoScene', () => {
  it('ready sólo si hay zaps', () => {
    expect(top10HistoricoScene(new ZapStore(), 1).ready!()).toBe(false);
    expect(top10HistoricoScene(setup().s, 1).ready!()).toBe(true);
  });
  it('título visible y 10 filas: rank, sats, extracto escapado o "post no disponible", autor', () => {
    const { s, root } = setup();
    const scene = top10HistoricoScene(s, 5000);
    expect([scene.name, scene.duration]).toEqual(['top10Historico', 5000]);
    scene.render(root);
    const h1 = root.querySelector<HTMLElement>('h1')!;
    expect(h1.textContent).toBe('Top 10 histórico');
    expect(h1.dataset.fit).toBe('text');
    const lis = root.querySelectorAll('.top-list li');
    expect(lis).toHaveLength(10);
    expect(lis[0].querySelector('.rank')!.textContent).toBe('#1');
    expect(lis[0].querySelector('.amount')!.textContent).toBe(sats(50_000));
    expect(lis[0].querySelector('.excerpt')!.textContent).toBe('post no disponible');
    expect(lis[1].querySelector('.rank')!.textContent).toBe('#2');
    expect(lis[1].querySelector('.excerpt')!.textContent).toBe('Post 11 <b>x</b>');
    expect(lis[1].querySelector('.author')!.textContent).toBe('aaaaaaaa…aaaa');
    expect(root.querySelector('.top-list b')).toBeNull();
  });
  it('lista ajustada y se actualiza en vivo', () => {
    const { s, root } = setup();
    top10HistoricoScene(s, 1).render(root);
    expect(root.querySelector<HTMLElement>('.top-list')!.style.fontSize).toMatch(/px$/);
    s.addZap({ id: 'big', postId: 'p0', msats: 10_000_000, comment: '', created_at: 200 });
    expect(root.querySelector('.top-list li .excerpt')!.textContent).toBe('Post 0 <b>x</b>');
  });
});
