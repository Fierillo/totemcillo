// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { latestZapsScene } from '../src/scenes/latestZaps';
import { sats } from '../src/util';

const setup = (n: number) => {
  const store = new ZapStore();
  store.addPost({ id: 'a', pubkey: 'p', content: 'Post A <script>', created_at: 1 });
  for (let i = 0; i < n; i++) store.addZap({ id: `z${i}`, postId: 'a', sender: 's', msats: (i + 1) * 1000, comment: i === n - 1 ? 'el último' : '', created_at: i });
  return { store, root: document.createElement('div') };
};

describe('latestZapsScene', () => {
  it('sin zaps muestra título y estado vacío ajustado', () => {
    const root = document.createElement('div');
    latestZapsScene(setup(0).store).render(root);
    expect(root.querySelector('h1')!.textContent).toContain('Últimos zaps');
    const msg = root.querySelector<HTMLElement>('.empty-msg')!;
    expect(msg.textContent).toBe('Todavía no hay zaps');
    expect(msg.dataset.fit).toBe('text');
    expect(root.querySelector('li')).toBeNull();
  });
  it('muestra los 10 más nuevos primero, con comentario y extracto escapado', () => {
    const { store, root } = setup(12);
    const scene = latestZapsScene(store);
    expect(scene.name).toBe('latestZaps');

    scene.render(root);
    expect(root.querySelector('h1')!.textContent).toContain('Últimos zaps');
    const lis = root.querySelectorAll('.zap-list li');
    expect(lis).toHaveLength(10);
    expect(lis[0].querySelector('.amount')!.textContent).toBe(sats(12000));
    expect(lis[0].textContent).toContain('el último');
    expect(lis[0].querySelector('small')!.textContent).toBe('Post A <script>');
    expect(root.querySelector('script')).toBeNull();
  });
  it('se actualiza en vivo y deja de hacerlo al limpiar', () => {
    const { store, root } = setup(1);
    const cleanup = latestZapsScene(store).render(root) as () => void;
    store.addZap({ id: 'n', postId: 'x', msats: 99000, comment: '', created_at: 50 });
    expect(root.querySelector('.amount')!.textContent).toBe(sats(99000));
    cleanup();
    store.addZap({ id: 'm', postId: 'x', msats: 1000, comment: '', created_at: 60 });
    expect(root.querySelectorAll('.zap-list li')).toHaveLength(2);
  });
});
