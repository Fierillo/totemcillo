// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { postScene, MAX_CARDS, ZAPS_PER_CARD } from '../src/scenes/post';
import { sats } from '../src/util';
import { noteUri } from '../src/nostr/link';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';

const hex = (n: number) => n.toString(16).padStart(64, '0');
const many = (n: number) => {
  const store = new ZapStore();
  for (let i = 1; i <= n; i++) store.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post ${i}`, created_at: 100 + i });
  return store;
};
const texts = (root: HTMLElement) => [...root.querySelectorAll('.card .card-content')].map((e) => e.textContent);

describe('postScene: grilla de varios posts a la vez', () => {
  it('sin posts muestra un estado vacío ajustado y pasa a la grilla cuando llega uno', () => {
    const store = new ZapStore();
    const root = document.createElement('div');
    postScene(store, 1).render(root);
    const msg = root.querySelector<HTMLElement>('.empty-msg')!;
    expect(msg.textContent).toBe('Todavía no hay posts con #lacrypta / #labitconf');
    expect(msg.dataset.fit).toBe('text');
    store.addPost({ id: 'n', pubkey: 'n'.repeat(64), content: 'llegó', created_at: 1 });
    expect(root.querySelector('.empty-msg')).toBeNull();
    expect(texts(root)).toEqual(['llegó']);
  });
  it(`muestra hasta ${5} posts a la vez, el más nuevo primero`, () => {
    expect(MAX_CARDS).toBe(5);
    const root = document.createElement('div');
    postScene(many(7), 1).render(root);
    expect(texts(root)).toEqual(['post 7', 'post 6', 'post 5', 'post 4', 'post 3']);
    expect(root.querySelector('.post-grid')!.getAttribute('data-n')).toBe('5');
  });
  it('es determinística: mismo store → mismo render, sin importar cuántas veces se muestre', () => {
    const store = many(5);
    const scene = postScene(store, 1);
    const a = document.createElement('div'), b = document.createElement('div'), c = document.createElement('div');
    scene.render(a); scene.render(b); postScene(store, 1).render(c);
    expect(texts(b)).toEqual(texts(a));
    expect(b.innerHTML).toBe(a.innerHTML);
    expect(c.innerHTML).toBe(a.innerHTML);
  });
  it('cada tarjeta: autor, hace cuánto, extracto escapado, total y los últimos zaps', () => {
    const store = new ZapStore();
    store.addPost({ id: 'a', pubkey: 'a'.repeat(64), content: 'Hola <b>mundo</b>', created_at: 1 });
    store.addPost({ id: 'b', pubkey: 'b'.repeat(64), content: 'Segundo', created_at: 2 });
    for (let i = 0; i < 5; i++) store.addZap({ id: `z${i}`, postId: 'a', sender: 's'.repeat(64), msats: 1_000_000, comment: `c${i}`, created_at: 10 + i });
    const root = document.createElement('div');
    postScene(store, 1000).render(root);
    const [b, a] = [...root.querySelectorAll<HTMLElement>('.card')];
    expect(a.querySelector('.card-content')!.textContent).toBe('Hola <b>mundo</b>');
    expect(a.querySelector('.card-content b')).toBeNull();
    expect(a.querySelector('.author')!.textContent).toBe('aaaaaaaa…aaaa');
    expect(a.querySelector('.ago')!.textContent).toMatch(/^hace/);
    expect(a.querySelector('.card-total')!.textContent).toContain(sats(5_000_000));
    const lis = [...a.querySelectorAll('.card-zaps li')].map((l) => l.textContent);
    expect(ZAPS_PER_CARD).toBe(3);
    expect(lis).toHaveLength(3);
    expect(lis[0]).toContain('c4');
    expect(lis[2]).toContain('c2');
    expect(b.querySelector('.card-zaps')!.textContent).toContain('¡Sé el primero!');
  });
  it('se actualiza en vivo y deja de hacerlo al limpiar', () => {
    const store = many(1);
    const root = document.createElement('div');
    const cleanup = postScene(store, 1).render(root) as () => void;
    store.addPost({ id: hex(9), pubkey: 'a'.repeat(64), content: 'nuevo', created_at: 999 });
    expect(texts(root)[0]).toBe('nuevo');
    cleanup();
    store.addPost({ id: hex(10), pubkey: 'a'.repeat(64), content: 'otro', created_at: 1000 });
    expect(texts(root)[0]).toBe('nuevo');
  });
  it('marca texto y lista de cada tarjeta para ajustar fuente', () => {
    const root = document.createElement('div');
    postScene(many(3), 1).render(root);
    root.querySelectorAll<HTMLElement>('.card').forEach((card) => {
      expect(card.querySelector<HTMLElement>('.card-content')!.dataset.fit).toBe('text');
      expect(card.querySelector<HTMLElement>('.card-zaps')!.dataset.fit).toBe('list');
    });
  });
});

describe('XSS', () => {
  it('escapa pubkeys/senders maliciosos', () => {
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
  const p = (n: number) => ({ id: hex(n), pubkey: 'e'.repeat(64), content: `con QR ${n}`, created_at: n });
  it('un solo QR grande, en la tarjeta destacada (la primera)', () => {
    const store = new ZapStore();
    store.addPost(p(1)); store.addPost(p(2)); store.addPost(p(3));
    const root = document.createElement('div');
    postScene(store, 1, { relays: ['wss://a.com', 'wss://b.com', 'wss://c.com'], template: 'nostr:{nevent}' }).render(root);
    const figs = root.querySelectorAll('figure.qr');
    expect(figs).toHaveLength(1);
    const featured = root.querySelector('.card.featured')!;
    expect(featured).toBe(root.querySelector('.card'));
    expect(featured.querySelector('figure.qr svg')).not.toBeNull();
    expect(featured.querySelector('figcaption')!.textContent).toBe('Escaneá y zapeá');
    expect(figs[0].getAttribute('data-uri')).toBe(noteUri(p(3), ['wss://a.com', 'wss://b.com'], 'nostr:{nevent}'));
  });
  it('usa relays y template de la config vía buildScenes', () => {
    const store = new ZapStore();
    store.addPost(p(1));
    const root = document.createElement('div');
    buildScenes({ ...defaultConfig, noteUriTemplate: 'https://njump.me/{nevent}' }, store)[0].render(root);
    expect(root.querySelector('figure.qr')!.getAttribute('data-uri')).toMatch(/^https:\/\/njump\.me\/nevent1/);
  });
  it('sin id válido no muestra QR', () => {
    const store = new ZapStore();
    store.addPost({ id: 'a', pubkey: 'a'.repeat(64), content: 'x', created_at: 1 });
    const root = document.createElement('div');
    postScene(store, 1).render(root);
    expect(root.querySelector('figure.qr')).toBeNull();
  });
});
