// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { postScene, MAX_POSTS, QR_CAPTION } from '../src/scenes/post';
import { sats } from '../src/util';
import { buildScenes } from '../src/scenes';
import { defaultConfig, publicUrlOf } from '../src/config';

const URL_ = 'https://totem.lacrypta.ar/';
const hex = (n: number) => n.toString(16).padStart(64, '0');
const many = (n: number) => {
  const store = new ZapStore();
  for (let i = 1; i <= n; i++) store.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post ${i}`, created_at: 100 + i });
  return store;
};
const excerpts = (root: HTMLElement) => [...root.querySelectorAll('.post-row .excerpt')].map((e) => e.textContent);

describe('postScene: lista vertical de posts recientes', () => {
  it('sin posts muestra estado vacío (con el QR igual) y pasa a la lista cuando llega uno', () => {
    const store = new ZapStore();
    const root = document.createElement('div');
    postScene(store, 1, { publicUrl: URL_ }).render(root);
    expect(root.querySelector('.empty-msg')!.textContent).toBe('Todavía no hay posts con #lacrypta / #labitconf');
    expect(root.querySelectorAll('figure.qr')).toHaveLength(1);
    store.addPost({ id: 'n', pubkey: 'n'.repeat(64), content: 'llegó', created_at: 1 });
    expect(root.querySelector('.empty-msg')).toBeNull();
    expect(excerpts(root)).toEqual(['llegó']);
  });
  it(`muestra hasta ${6} posts, el más nuevo primero, en una lista ajustable`, () => {
    expect(MAX_POSTS).toBe(6);
    const root = document.createElement('div');
    postScene(many(8), 1, { publicUrl: URL_ }).render(root);
    expect(excerpts(root)).toEqual(['post 8', 'post 7', 'post 6', 'post 5', 'post 4', 'post 3']);
    const ul = root.querySelector<HTMLElement>('ul.post-list')!;
    expect(ul.dataset.fit).toBe('list');
    expect(Number(ul.dataset.max)).toBeLessThanOrEqual(3.2);
  });
  it('es determinística: mismo store → mismo HTML, sin importar cuántas veces se muestre', () => {
    const store = many(5);
    const scene = postScene(store, 1, { publicUrl: URL_ });
    const a = document.createElement('div'), b = document.createElement('div'), c = document.createElement('div');
    scene.render(a); scene.render(b); postScene(store, 1, { publicUrl: URL_ }).render(c);
    expect(b.innerHTML).toBe(a.innerHTML);
    expect(c.innerHTML).toBe(a.innerHTML);
  });
  it('cada fila: sólo el mensaje (escapado) y el total acumulado; sin autor, hora ni zaps', () => {
    const store = new ZapStore();
    store.addPost({ id: 'a', pubkey: 'a'.repeat(64), content: 'Hola <b>mundo</b>', created_at: 1 });
    store.addPost({ id: 'b', pubkey: 'b'.repeat(64), content: 'Segundo', created_at: 2 });
    for (let i = 0; i < 4; i++) store.addZap({ id: `z${i}`, postId: 'a', sender: 's'.repeat(64), msats: 1_000_000, comment: `comentario${i}`, created_at: 10 + i });
    const root = document.createElement('div');
    postScene(store, 1, { publicUrl: URL_ }).render(root);
    const [b, a] = [...root.querySelectorAll<HTMLElement>('.post-row')];
    expect(a.querySelector('.excerpt')!.textContent).toBe('Hola <b>mundo</b>');
    expect(a.querySelector('.excerpt b')).toBeNull();
    expect(a.querySelector('.row-total')!.textContent).toContain(sats(4_000_000));
    expect(b.querySelector('.row-total')!.textContent).toContain('0');
    expect([...a.children].map((c) => c.className)).toEqual(['excerpt', 'row-total']);
    expect(root.textContent).not.toContain('comentario');
    expect(root.querySelector('.author, .ago, .row-zaps')).toBeNull();
  });
  it('un solo QR en la escena, con la URL pública de la app (no por post)', () => {
    const root = document.createElement('div');
    postScene(many(4), 1, { publicUrl: URL_ }).render(root);
    const figs = root.querySelectorAll('figure.qr');
    expect(figs).toHaveLength(1);
    expect(figs[0].getAttribute('data-uri')).toBe(URL_);
    expect(figs[0].querySelector('svg')).not.toBeNull();
    expect(figs[0].querySelector('figcaption')!.textContent).toBe(QR_CAPTION);
    expect(root.querySelector('.post-row figure')).toBeNull();
  });
  it('se actualiza en vivo y deja de hacerlo al limpiar', () => {
    const store = many(1);
    const root = document.createElement('div');
    const cleanup = postScene(store, 1, { publicUrl: URL_ }).render(root) as () => void;
    store.addPost({ id: hex(9), pubkey: 'a'.repeat(64), content: 'nuevo', created_at: 999 });
    expect(excerpts(root)[0]).toBe('nuevo');
    cleanup();
    store.addPost({ id: hex(10), pubkey: 'a'.repeat(64), content: 'otro', created_at: 1000 });
    expect(excerpts(root)[0]).toBe('nuevo');
  });
  it('no inyecta HTML de pubkeys/senders maliciosos', () => {
    const store = new ZapStore();
    const root = document.createElement('div');
    store.addPost({ id: 'x', pubkey: '<img src=x onerror=alert(1)>', content: 'hola', created_at: 1 });
    store.addZap({ id: 'z', postId: 'x', sender: '<svg onload=alert(1)>', msats: 1000, comment: '', created_at: 2 });
    postScene(store, 1, { publicUrl: URL_ }).render(root);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelectorAll('svg')).toHaveLength(1);
  });
});

describe('URL pública', () => {
  it('usa publicUrl de la config o el origin de la página', () => {
    expect(publicUrlOf({ ...defaultConfig, publicUrl: URL_ }, 'http://x')).toBe(URL_);
    expect(publicUrlOf(defaultConfig, 'https://totem.vercel.app')).toBe('https://totem.vercel.app/');
  });
  it('buildScenes pasa la URL al QR', () => {
    const root = document.createElement('div');
    buildScenes({ ...defaultConfig, publicUrl: URL_ }, many(1))[0].render(root);
    expect(root.querySelector('figure.qr')!.getAttribute('data-uri')).toBe(URL_);
  });
});
