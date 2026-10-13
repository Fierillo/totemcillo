// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { postScene } from '../src/scenes/post';
import { sats } from '../src/util';
import { noteUri } from '../src/nostr/link';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';

const setup = () => {
  const store = new ZapStore();
  store.addPost({ id: 'a', pubkey: 'a'.repeat(64), content: 'Hola <b>mundo</b>', created_at: 1 });
  store.addPost({ id: 'b', pubkey: 'b'.repeat(64), content: 'Segundo', created_at: 2 });
  store.addZap({ id: 'z1', postId: 'a', sender: 's'.repeat(64), msats: 2_100_000, comment: 'bien!', created_at: 3 });
  return { store, root: document.createElement('div') };
};

describe('postScene', () => {
  it('sin posts muestra un estado vacío ajustado y pasa al post cuando llega', () => {
    const store = new ZapStore();
    const root = document.createElement('div');
    postScene(store, 1).render(root);
    const msg = root.querySelector<HTMLElement>('.empty-msg')!;
    expect(msg.textContent).toBe('Todavía no hay posts con #lacrypta / #labitconf');
    expect(msg.dataset.fit).toBe('text');
    store.addPost({ id: 'n', pubkey: 'n'.repeat(64), content: 'llegó', created_at: 1 });
    expect(root.querySelector('.empty-msg')).toBeNull();
    expect(root.querySelector('.post-content')!.textContent).toBe('llegó');
  });
  it('muestra contenido escapado, autor, total y zaps', () => {
    const { store, root } = setup();
    const scene = postScene(store, 1000);
    expect(scene.name).toBe('post');
    expect(scene.duration).toBe(1000);
    scene.render(root);
    expect(root.querySelector('.post-content')!.textContent).toBe('Hola <b>mundo</b>');
    expect(root.querySelector('.post-content b')).toBeNull();
    expect(root.querySelector('.author')!.textContent).toBe('aaaaaaaa…aaaa');
    expect(root.querySelector('.total')!.textContent).toContain(sats(2_100_000));
    const lis = root.querySelectorAll('.zaps li');
    expect(lis).toHaveLength(1);
    expect(lis[0].textContent).toContain('bien!');
  });
  it('rota entre posts (más zapeado primero) y muestra invitación si no hay zaps', () => {
    const { store, root } = setup();
    const scene = postScene(store, 1);
    scene.render(root);
    expect(root.querySelector('.post-content')!.textContent).toContain('mundo');
    scene.render(root);
    expect(root.querySelector('.post-content')!.textContent).toBe('Segundo');
    expect(root.querySelector('.zaps')!.textContent).toContain('¡Sé el primero!');
    scene.render(root);
    expect(root.querySelector('.post-content')!.textContent).toContain('mundo');
  });
  it('se actualiza en vivo y deja de hacerlo al limpiar', () => {
    const { store, root } = setup();
    const cleanup = postScene(store, 1).render(root) as () => void;
    store.addZap({ id: 'z2', postId: 'a', msats: 1000, comment: '', created_at: 4 });
    expect(root.querySelectorAll('.zaps li')).toHaveLength(2);
    cleanup();
    store.addZap({ id: 'z3', postId: 'a', msats: 1000, comment: '', created_at: 5 });
    expect(root.querySelectorAll('.zaps li')).toHaveLength(2);
  });
});

describe('XSS', () => {
  it('escapa pubkeys/senders maliciosos (p.ej. historial envenenado)', () => {
    const store = new ZapStore();
    const root = document.createElement('div');
    store.addPost({ id: 'x', pubkey: '<img src=x onerror=alert(1)>', content: 'hola', created_at: 1 });
    store.addZap({ id: 'z', postId: 'x', sender: '<svg onload=alert(1)>', msats: 1000, comment: '', created_at: 2 });
    postScene(store, 1).render(root);
    expect(root.querySelector('img, svg')).toBeNull();
    expect(root.querySelector('.author')!.textContent).toContain('<img');
  });
});

describe('QR', () => {
  const hexPost = { id: 'd'.repeat(64), pubkey: 'e'.repeat(64), content: 'con QR', created_at: 1 };
  it('muestra un QR SVG con la URI de la nota y el texto "Escaneá y zapeá"', () => {
    const store = new ZapStore();
    store.addPost(hexPost);
    const root = document.createElement('div');
    postScene(store, 1, { relays: ['wss://a.com', 'wss://b.com', 'wss://c.com'], template: 'nostr:{nevent}' }).render(root);
    const fig = root.querySelector('figure.qr')!;
    expect(fig).not.toBeNull();
    expect(fig.querySelector('svg')).not.toBeNull();
    expect(fig.querySelector('figcaption')!.textContent).toBe('Escaneá y zapeá');
    expect(fig.getAttribute('data-uri')).toBe(noteUri(hexPost, ['wss://a.com', 'wss://b.com'], 'nostr:{nevent}'));
  });
  it('usa relays y template de la config vía buildScenes', () => {
    const store = new ZapStore();
    store.addPost(hexPost);
    const root = document.createElement('div');
    const cfg = { ...defaultConfig, postsPerCycle: 1, noteUriTemplate: 'https://njump.me/{nevent}' };
    buildScenes(cfg, store)[0].render(root);
    expect(root.querySelector('figure.qr')!.getAttribute('data-uri')).toMatch(/^https:\/\/njump\.me\/nevent1/);
  });
  it('sin id válido no muestra QR', () => {
    const { store, root } = setup();
    postScene(store, 1).render(root);
    expect(root.querySelector('figure.qr')).toBeNull();
  });
});
