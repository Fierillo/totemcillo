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
  it('sin zaps muestra título y estado vacío ajustado', () => {
    const root = document.createElement('div');
    top10HistoricoScene(new ZapStore()).render(root);
    expect(root.querySelector('h1')!.textContent).toBe('Top 10 zaps · histórico');
    const msg = root.querySelector<HTMLElement>('.empty-msg')!;
    expect(msg.textContent).toBe('Todavía no hay zaps en este período');
    expect(msg.dataset.fit).toBe('text');
    expect(root.querySelector('li')).toBeNull();
  });
  it('título visible y 10 filas: rank, sats, extracto escapado y autor; sin zaps huérfanos', () => {
    const { s, root } = setup();
    const scene = top10HistoricoScene(s);
    expect(scene.name).toBe('top10Historico');
    scene.render(root);
    const h1 = root.querySelector<HTMLElement>('h1')!;
    expect(h1.textContent).toBe('Top 10 zaps · histórico');
    expect(h1.dataset.fit).toBe('text');
    const lis = root.querySelectorAll('.top-list li');
    expect(lis).toHaveLength(10);
    expect(lis[0].querySelector('.rank')!.textContent).toBe('#1');
    expect(lis[0].querySelector('.amount')!.textContent).toBe(sats(12_000));
    expect(lis[0].querySelector('.excerpt')!.textContent).toBe('Post 11 <b>x</b>');
    expect(lis[0].querySelector('.author')!.textContent).toBe('aaaaaaaa…aaaa');
    expect(lis[9].querySelector('.rank')!.textContent).toBe('#10');
    expect(root.textContent).not.toContain('post no disponible');
    expect(root.querySelector('.top-list b')).toBeNull();
  });
  it('lista ajustada y se actualiza en vivo', () => {
    const { s, root } = setup();
    top10HistoricoScene(s).render(root);
    expect(root.querySelector<HTMLElement>('.top-list')!.style.fontSize).toMatch(/px$/);
    s.addZap({ id: 'big', postId: 'p0', msats: 10_000_000, comment: '', created_at: 200 });
    expect(root.querySelector('.top-list li .excerpt')!.textContent).toBe('Post 0 <b>x</b>');
  });
});

import { top10Ultimas3hScene } from '../src/scenes/top10Ultimas3h';
import { defaultConfig, loadConfig } from '../src/config';

describe('top10Ultimas3hScene', () => {
  const NOW = 1_000_000;
  const store = () => {
    const s = new ZapStore();
    s.addPost({ id: 'a', pubkey: 'a'.repeat(64), content: 'A', created_at: 1 });
    s.addPost({ id: 'b', pubkey: 'b'.repeat(64), content: 'B', created_at: 1 });
    s.addZap({ id: 'viejo', postId: 'a', msats: 900_000, comment: '', created_at: NOW - 4 * 3600 });
    s.addZap({ id: 'b1', postId: 'b', msats: 1000, comment: '', created_at: NOW - 60 });
    s.addZap({ id: 'a1', postId: 'a', msats: 2000, comment: '', created_at: NOW - 100 });
    return s;
  };
  it('cuenta sólo zaps de la ventana y tiene título visible', () => {
    const root = document.createElement('div');
    const scene = top10Ultimas3hScene(store(), 3, () => NOW * 1000);
    expect(scene.name).toBe('top10Ultimas3h');
    scene.render(root);
    expect(root.querySelector('h1')!.textContent).toBe('Top 10 zaps · últimas 3 horas');
    const rows = [...root.querySelectorAll('.top-list li')].map((li) => [li.querySelector('.excerpt')!.textContent, li.querySelector('.amount')!.textContent]);
    expect(rows).toEqual([['A', sats(2000)], ['B', sats(1000)]]);
  });
  it('ventana configurable y no lista si no hay zaps recientes', () => {
    const root = document.createElement('div');
    top10Ultimas3hScene(store(), 6, () => NOW * 1000).render(root);
    expect(root.querySelector('h1')!.textContent).toBe('Top 10 zaps · últimas 6 horas');
    expect(root.querySelector('.amount')!.textContent).toBe(sats(902_000));
    const later = document.createElement('div');
    top10Ultimas3hScene(store(), 3, () => (NOW + 4 * 3600) * 1000).render(later);
    expect(later.querySelector('h1')!.textContent).toBe('Top 10 zaps · últimas 3 horas');
    expect(later.querySelector('.empty-msg')!.textContent).toBe('Todavía no hay zaps en este período');
  });
  it('config topRecentHours por defecto 3', async () => {
    expect(defaultConfig.topRecentHours).toBe(3);
    expect((await loadConfig((async () => ({ ok: true, json: async () => ({ topRecentHours: 1 }) })) as any)).topRecentHours).toBe(1);
  });
});
