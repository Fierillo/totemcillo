// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZapStore, type LiveEvent } from '../src/nostr/store';
import { postScene } from '../src/scenes/post';
import { topScene } from '../src/scenes/top';
import { installDemo } from '../src/demo';
import { feedFor, showIndicator, MAX_PENDING } from '../src/livefeed';

const NOW = 1_800_000_000;
const hex = (n: number) => n.toString(16).padStart(64, '0');
const post = (n: number, created_at = NOW - 3600) => ({ id: hex(n), pubkey: 'a'.repeat(64), content: `post ${n}`, created_at });
const zap = (n: number, postN: number, created_at = NOW, msats = 21_000) => ({ id: hex(1000 + n), postId: hex(postN), msats, comment: '', created_at });
const mem = (data: unknown) => { const m = new Map([['totemcillo:v1', JSON.stringify(data)]]); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const mkStore = (storage?: any) => new ZapStore(storage, { clock: () => NOW });

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('store: eventos en vivo (no historial)', () => {
  it('emite post/zap sólo si son recientes (≤ liveWindowSec) y nuevos', () => {
    const s = mkStore();
    const ev: LiveEvent[] = [];
    s.onLive((e) => ev.push(e));
    s.addPost(post(1)); // backfill viejo
    s.addPost(post(2, NOW - 10)); // nuevo en vivo
    s.addPost(post(2, NOW - 10)); // duplicado
    s.addZap(zap(1, 1, NOW - 3600)); // zap viejo
    s.addZap(zap(2, 1, NOW - 5)); // zap en vivo
    expect(ev).toEqual([{ type: 'post', postId: hex(2) }, { type: 'zap', postId: hex(1) }]);
  });
  it('lo cargado de localStorage nunca dispara', () => {
    const ev: LiveEvent[] = [];
    const s = new ZapStore(mem({ posts: [post(1, NOW - 1)], zaps: [zap(1, 1, NOW - 1)] }), { clock: () => NOW });
    s.onLive((e) => ev.push(e));
    expect(ev).toEqual([]);
    expect(s.posts.size).toBe(1);
  });
});

describe('animación de post nuevo en la lista', () => {
  it('el post nuevo en vivo aparece arriba con clase is-new; los de historial no', () => {
    const s = mkStore();
    s.addPost(post(1));
    const root = document.createElement('div');
    postScene(s, 1, { publicUrl: 'https://x/' }).render(root);
    expect(root.querySelector('.is-new')).toBeNull();
    s.addPost(post(2, NOW - 2));
    const first = root.querySelector('.post-row')!;
    expect(first.getAttribute('data-id')).toBe(hex(2));
    expect(first.classList.contains('is-new')).toBe(true);
    expect(root.querySelectorAll('.is-new')).toHaveLength(1);
  });
  it('no se re-anima en redibujos posteriores', () => {
    const s = mkStore();
    const root = document.createElement('div');
    postScene(s, 1, { publicUrl: 'https://x/' }).render(root);
    s.addPost(post(2, NOW - 2));
    s.addPost(post(3)); // redibujo por otro cambio (historial)
    expect(root.querySelector('.is-new')).toBeNull();
  });
  it('si la escena no está en pantalla, queda pendiente y se anima al entrar (una sola vez)', () => {
    const s = mkStore();
    s.addPost(post(2, NOW - 2));
    const root = document.createElement('div');
    const off = postScene(s, 1, { publicUrl: 'https://x/' }).render(root) as () => void;
    expect(root.querySelector(`.post-row[data-id="${hex(2)}"]`)!.classList.contains('is-new')).toBe(true);
    off();
    const root2 = document.createElement('div');
    postScene(s, 1, { publicUrl: 'https://x/' }).render(root2);
    expect(root2.querySelector('.is-new')).toBeNull();
  });
});

describe('animación de zap (rayo) en la fila visible', () => {
  it('lista de posts: la fila zapeada recibe is-zapped con un rayo SVG y el total actualizado', () => {
    const s = mkStore();
    s.addPost(post(1)); s.addPost(post(2));
    const root = document.createElement('div');
    postScene(s, 1, { publicUrl: 'https://x/' }).render(root);
    s.addZap(zap(1, 1, NOW - 1, 2_100_000));
    const r = root.querySelector(`.post-row[data-id="${hex(1)}"]`)!;
    expect(r.classList.contains('is-zapped')).toBe(true);
    expect(r.querySelector('svg.bolt')).not.toBeNull();
    expect(r.querySelector('.row-total')!.textContent).toContain('2.100');
    expect(root.querySelectorAll('.is-zapped')).toHaveLength(1);
  });
  it('top: anima la fila si el post está listado; zap viejo no anima', () => {
    const s = mkStore();
    s.addPost(post(1)); s.addPost(post(2));
    s.addZap(zap(1, 2, NOW - 3600));
    const root = document.createElement('div');
    topScene({ name: 'top10Historico', title: 'T', store: s, duration: 1, since: () => 0 }).render(root);
    expect(root.querySelector('.is-zapped')).toBeNull();
    s.addZap(zap(2, 1, NOW - 1));
    const li = root.querySelector(`li[data-id="${hex(1)}"]`)!;
    expect(li.classList.contains('is-zapped')).toBe(true);
    expect(li.querySelector('svg.bolt')).not.toBeNull();
  });
  it('zap a un post que no está en pantalla: nada se anima', () => {
    const s = mkStore();
    for (let i = 1; i <= 8; i++) s.addPost(post(i, NOW - 3600 + i));
    const root = document.createElement('div');
    postScene(s, 1, { publicUrl: 'https://x/' }).render(root); // muestra los 6 más nuevos: 3..8
    s.addZap(zap(1, 1, NOW - 1));
    expect(root.querySelector('.is-zapped')).toBeNull();
  });
});

describe('estilos: livianos y con prefers-reduced-motion', () => {
  it('define animaciones CSS y las suaviza con reduced motion', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/src/style.css`, 'utf8');
    expect(css).toMatch(/\.is-new\s*\{[^}]*animation/);
    expect(css).toMatch(/\.is-zapped\s*\{[^}]*animation/);
    const pop = css.match(/@keyframes total-pop\s*\{[\s\S]*?\}\s*\}/)![0];
    expect(pop).not.toMatch(/scale|transform/); // el total nunca cambia de tamaño: sin solapes
    expect(pop).toMatch(/color|text-shadow/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*is-zapped/);
  });
});

describe('demo (sólo dev): window.__totemDemo', () => {
  it('post() agrega un post en vivo y zap() zapea el más nuevo (o el id dado)', () => {
    const s = mkStore();
    const w: any = {};
    installDemo(w, s, () => NOW);
    const ev: LiveEvent[] = [];
    s.onLive((e) => ev.push(e));
    const id = w.__totemDemo.post('hola');
    w.__totemDemo.zap();
    w.__totemDemo.zap(id, 5000);
    expect(ev.map((e) => e.type)).toEqual(['post', 'zap', 'zap']);
    expect(s.stats().find((x) => x.postId === id)!.msats).toBe(21_000_000 + 5_000_000);
  });
});

describe('pendientes + indicador abajo cuando el objetivo no está en pantalla', () => {
  const postSc = (s: ZapStore) => { const r = document.createElement('div'); const off = postScene(s, 1, { publicUrl: 'https://x/' }).render(r) as () => void; return { r, off }; };
  const topSc = (s: ZapStore, name = 'top10Historico') => { const r = document.createElement('div'); const off = topScene({ name, title: 'T', store: s, duration: 1, since: () => 0 }).render(r) as () => void; return { r, off }; };
  it('zap con otra escena (anuncio/video): indicador ⚡ abajo y pendiente; al entrar a posts, rayo en esa fila', () => {
    const s = mkStore();
    s.addPost(post(1));
    const ind: string[] = [];
    feedFor(s).setIndicator((e) => ind.push(e.type));
    s.addZap(zap(1, 1, NOW - 1));
    expect(ind).toEqual(['zap']);
    expect(feedFor(s).pending).toHaveLength(1);
    const { r } = postSc(s);
    const row = r.querySelector(`.post-row[data-id="${hex(1)}"]`)!;
    expect(row.classList.contains('is-zapped')).toBe(true);
    expect(row.querySelector('svg.bolt')).not.toBeNull();
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it('post nuevo con otra escena: indicador 💬 abajo y se resalta al llegar a posts', () => {
    const s = mkStore();
    const ind: string[] = [];
    feedFor(s).setIndicator((e) => ind.push(e.type));
    s.addPost(post(5, NOW - 1));
    expect(ind).toEqual(['post']);
    expect(postSc(s).r.querySelector('.is-new')).not.toBeNull();
  });
  it('objetivo ya visible: animación inmediata, sin indicador ni pendiente', () => {
    const s = mkStore();
    s.addPost(post(1));
    const ind: string[] = [];
    feedFor(s).setIndicator((e) => ind.push(e.type));
    const { r } = postSc(s);
    s.addZap(zap(1, 1, NOW - 1));
    expect(r.querySelector('.is-zapped')).not.toBeNull();
    s.addPost(post(9, NOW - 1));
    expect(r.querySelector('.is-new')).not.toBeNull();
    expect(ind).toEqual([]);
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it('escena visible pero sin esa fila (ej. top sin el post): indicador + pendiente', () => {
    const s = mkStore();
    for (let i = 1; i <= 8; i++) s.addPost(post(i, NOW - 3600 + i));
    topSc(s);
    const ind: string[] = [];
    feedFor(s).setIndicator((e) => ind.push(e.type));
    s.addPost(post(20, NOW - 1)); // la escena top no muestra posts nuevos
    expect(ind).toEqual(['post']);
  });
  it('zap a post que no está en posts: sigue pendiente para los tops y se anima ahí', () => {
    const s = mkStore();
    for (let i = 1; i <= 8; i++) s.addPost(post(i, NOW - 3600 + i)); // posts muestra 3..8
    s.addZap(zap(1, 1, NOW - 1));
    postSc(s).off();
    expect(feedFor(s).pending).toHaveLength(1);
    const { r } = topSc(s);
    expect(r.querySelector(`li[data-id="${hex(1)}"]`)!.classList.contains('is-zapped')).toBe(true);
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it('vence si su post no aparece en ninguna escena que le corresponde', () => {
    const s = mkStore();
    for (let i = 1; i <= 8; i++) s.addPost(post(i, NOW - 3600 + i));
    s.addZap(zap(1, 1, NOW - 1));
    // tops con ventana vacía (since futuro) → no aparece
    postSc(s).off();
    for (const n of ['top10Historico', 'top10Ultimas3h']) { const r = document.createElement('div'); (topScene({ name: n, title: 'T', store: s, duration: 1, since: () => NOW + 10 }).render(r) as () => void)(); }
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it(`la cola tiene tope (${10})`, () => {
    expect(MAX_PENDING).toBe(10);
    const s = mkStore();
    s.addPost(post(1));
    for (let i = 0; i < 15; i++) s.addZap(zap(i, 1, NOW - 1));
    expect(feedFor(s).pending).toHaveLength(10);
  });
  it('showIndicator apila íconos chicos en la franja y los quita a ~1,5 s', () => {
    const strip = document.createElement('div');
    showIndicator(strip, { type: 'zap', postId: 'x' });
    showIndicator(strip, { type: 'post', postId: 'y' });
    expect(strip.querySelectorAll('.live-ind')).toHaveLength(2);
    expect(strip.querySelector('.live-ind.zap svg')).not.toBeNull();
    expect(strip.querySelector('.live-ind.post svg')).not.toBeNull();
    vi.advanceTimersByTime(1700);
    expect(strip.querySelectorAll('.live-ind')).toHaveLength(0);
  });
  it('la franja vive en el footer, posicionada para no tapar el texto', async () => {
    const { readFileSync } = await import('node:fs');
    const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
    const css = readFileSync(`${process.cwd()}/src/style.css`, 'utf8');
    expect(html).toMatch(/<footer[^>]*>[\s\S]*id="live-strip"[\s\S]*<\/footer>/);
    expect(css).toMatch(/#live-strip\s*\{[^}]*position:\s*absolute[^}]*right:/);
    expect(css).toMatch(/\.footer\s*\{[^}]*position:\s*relative/);
  });
});
