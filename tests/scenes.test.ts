// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZapStore, type LiveEvent } from '../src/nostr/store';
import { postScene, MAX_POSTS, QR_CAPTION } from '../src/scenes/post';
import { topScene } from '../src/scenes/top';
import { top10HistoricoScene } from '../src/scenes/top10Historico';
import { top10Ultimas3hScene } from '../src/scenes/top10Ultimas3h';
import { latestZapsScene } from '../src/scenes/latestZaps';
import { anuncioScene, EMPTY_ANUNCIO } from '../src/scenes/anuncio';
import { Announcement } from '../src/announcement';
import { buildScenes } from '../src/scenes';
import { live } from '../src/scenes/live';
import { defaultConfig, publicUrlOf } from '../src/config';
import { ORDER } from '../shared/schedule';
import { sats } from '../src/util';
import { installDemo } from '../src/demo';
import { feedFor, showIndicator, MAX_PENDING } from '../src/livefeed';
import { profiles } from '../src/nostr/profiles';

const NOW = 1_800_000_000;
const hex = (n: number) => n.toString(16).padStart(64, '0');
const post = (n: number, created_at = NOW - 3600) => ({ id: hex(n), pubkey: 'a'.repeat(64), content: `post ${n}`, created_at });
const zap = (n: number, postN: number, created_at = NOW, msats = 21_000) => ({ id: hex(1000 + n), postId: hex(postN), msats, comment: '', created_at });
const mem = (data: unknown) => { const m = new Map([['totemcillo:v1', JSON.stringify(data)]]); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };
const mkStore = (storage?: any) => new ZapStore(storage, { clock: () => NOW });

beforeEach(() => vi.useFakeTimers());
afterEach(() => { profiles.clear(); vi.useRealTimers(); });

describe('store: eventos en vivo (no historial)', () => {
  it('emite post/zap sólo si son recientes (≤ liveWindowSec) y nuevos', () => {
    const s = mkStore();
    const ev: LiveEvent[] = [];
    s.onLive((e) => ev.push(e));
    s.addPost(post(1)); // old backfill
    s.addPost(post(2, NOW - 10)); // new, live
    s.addPost(post(2, NOW - 10)); // duplicate
    s.addZap(zap(1, 1, NOW - 3600)); // old zap
    s.addZap(zap(2, 1, NOW - 5)); // live zap
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
    postScene(s, { publicUrl: 'https://x/' }).render(root);
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
    postScene(s, { publicUrl: 'https://x/' }).render(root);
    s.addPost(post(2, NOW - 2));
    s.addPost(post(3)); // redraw from another change (history)
    vi.advanceTimersByTime(100);
    expect(root.querySelector('.is-new')).toBeNull();
  });
  it('si la escena no está en pantalla, queda pendiente y se anima al entrar (una sola vez)', () => {
    const s = mkStore();
    s.addPost(post(2, NOW - 2));
    const root = document.createElement('div');
    const off = postScene(s, { publicUrl: 'https://x/' }).render(root) as () => void;
    expect(root.querySelector(`.post-row[data-id="${hex(2)}"]`)!.classList.contains('is-new')).toBe(true);
    off();
    const root2 = document.createElement('div');
    postScene(s, { publicUrl: 'https://x/' }).render(root2);
    expect(root2.querySelector('.is-new')).toBeNull();
  });
});

describe('animación de zap (rayo) en la fila visible', () => {
  it('lista de posts: la fila zapeada recibe is-zapped con un rayo SVG y el total actualizado', () => {
    const s = mkStore();
    s.addPost(post(1)); s.addPost(post(2));
    const root = document.createElement('div');
    postScene(s, { publicUrl: 'https://x/' }).render(root);
    s.addZap(zap(1, 1, NOW - 1, 2_100_000));
    const r = root.querySelector(`.post-row[data-id="${hex(1)}"]`)!;
    expect(r.classList.contains('is-zapped')).toBe(true);
    expect(r.querySelector('svg.bolt')).not.toBeNull();
    expect(r.querySelector('.row-total')!.textContent).toContain('2.100');
    expect(root.querySelectorAll('.is-zapped')).toHaveLength(1);
  });
  it('totales acumulados: el número parpadea hasta que el backfill termina', () => {
    const s = mkStore();
    s.addPost(post(1)); s.addZap(zap(1, 1, NOW - 3600, 2_100_000));
    const posts = document.createElement('div'), latest = document.createElement('div');
    postScene(s, { publicUrl: 'https://x/' }).render(posts);
    latestZapsScene(s).render(latest);
    expect(posts.querySelector('.row-total .pending')!.textContent).toBe('2.100 sats');
    expect(posts.querySelector('.row-total')!.textContent).toContain('2.100');
    expect(latest.querySelector('.pending')).toBeNull();
    s.setReady();
    expect(posts.querySelector('.pending')).toBeNull();
  });
  it('top: anima la fila si el post está listado; zap viejo no anima', () => {
    const s = mkStore();
    s.addPost(post(1)); s.addPost(post(2));
    s.addZap(zap(1, 2, NOW - 3600));
    const root = document.createElement('div');
    topScene({ name: 'top10Historico', title: 'T', store: s, since: () => 0 }).render(root);
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
    postScene(s, { publicUrl: 'https://x/' }).render(root); // shows the 6 newest: 3..8
    s.addZap(zap(1, 1, NOW - 1));
    expect(root.querySelector('.is-zapped')).toBeNull();
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
  const postSc = (s: ZapStore) => { const r = document.createElement('div'); const off = postScene(s, { publicUrl: 'https://x/' }).render(r) as () => void; return { r, off }; };
  const topSc = (s: ZapStore, name = 'top10Historico') => { const r = document.createElement('div'); const off = topScene({ name, title: 'T', store: s, since: () => 0 }).render(r) as () => void; return { r, off }; };
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
    vi.advanceTimersByTime(100);
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
    s.addPost(post(20, NOW - 1)); // the top scene doesn't show new posts
    expect(ind).toEqual(['post']);
  });
  it('zap a post que no está en posts: sigue pendiente para los tops y se anima ahí', () => {
    const s = mkStore();
    for (let i = 1; i <= 8; i++) s.addPost(post(i, NOW - 3600 + i)); // posts shows 3..8
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
    // tops with an empty window (future since) → not shown
    postSc(s).off();
    for (const n of ['top10Historico', 'top10Ultimas3h']) { const r = document.createElement('div'); (topScene({ name: n, title: 'T', store: s, since: () => NOW + 10 }).render(r) as () => void)(); }
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
});

describe('renderizado de posts', () => {
  const URL = 'https://totem.example/';
  const many = (n: number) => {
    const s = new ZapStore();
    for (let i = 1; i <= n; i++) s.addPost({ ...post(i, 100 + i), content: `post ${i}` });
    return s;
  };
  const excerpts = (root: HTMLElement) => [...root.querySelectorAll('.post-row .excerpt')].map((el) => el.textContent);
  it('pasa del estado vacío a la lista al llegar un post, manteniendo un QR', () => {
    const s = new ZapStore(), root = document.createElement('div');
    const cleanup = postScene(s, { publicUrl: URL }).render(root);
    expect(root.querySelector('.empty-msg')!.textContent).toBe('Todavía no hay posts con #lacrypta / #labitconf');
    expect(root.querySelectorAll('figure.qr')).toHaveLength(1);
    s.addPost({ ...post(1, 1), content: 'llegó' });
    expect(root.querySelector('.empty-msg')).toBeNull();
    expect(excerpts(root)).toEqual(['llegó']);
    cleanup?.();
  });
  it('lista los seis más recientes, de forma determinística entre renderizados', () => {
    const s = many(8), a = document.createElement('div'), b = document.createElement('div');
    const cleanups = [postScene(s, { publicUrl: URL }).render(a), postScene(s, { publicUrl: URL }).render(b)];
    expect(MAX_POSTS).toBe(6);
    expect(excerpts(a)).toEqual(['post 8', 'post 7', 'post 6', 'post 5', 'post 4', 'post 3']);
    expect(a.innerHTML).toBe(b.innerHTML);
    cleanups.forEach((cleanup) => cleanup?.());
  });
  it('cada fila muestra autor, tiempo, texto escapado y total; no comentarios de zaps', () => {
    const s = new ZapStore(), root = document.createElement('div');
    s.addPost({ ...post(1, 1), content: 'Hola <b>mundo</b>' });
    s.addPost({ ...post(2, 2), content: 'Segundo' });
    for (let i = 0; i < 4; i++) s.addZap({ ...zap(i, 1, 10 + i, 1_000_000), comment: `comentario${i}` });
    profiles.set('a'.repeat(64), null);
    const cleanup = postScene(s, { publicUrl: URL }).render(root);
    const [b, a] = [...root.querySelectorAll('.post-row')];
    expect(a.querySelector('.excerpt')!.textContent).toBe('Hola <b>mundo</b>');
    expect(a.querySelector('.excerpt b')).toBeNull();
    expect(a.querySelector('.row-total')!.textContent).toContain(sats(4_000_000));
    expect(b.querySelector('.row-total')!.textContent).toContain('0');
    expect(a.querySelector('.author')!.textContent).toBe('aaaaaaaa…aaaa');
    expect(a.querySelector('.ago')!.textContent).toMatch(/^hace/);
    expect(root.textContent).not.toContain('comentario');
    expect(root.querySelector('.row-zaps')).toBeNull();
    cleanup?.();
  });
  it('escapa autores maliciosos y deja de actualizarse al limpiar', () => {
    const s = new ZapStore(), root = document.createElement('div');
    s.addPost({ ...post(1, 1), pubkey: '<img src=x onerror=alert(1)>' });
    s.addZap({ ...zap(1, 1, 2), sender: '<svg onload=alert(1)>' });
    profiles.set('<img src=x onerror=alert(1)>', null);
    const cleanup = postScene(s, { publicUrl: URL }).render(root);
    expect(root.querySelector('img')).toBeNull();
    expect(root.querySelectorAll('svg')).toHaveLength(1);
    expect(root.querySelector('.author')!.textContent).toContain('<img');
    s.addPost({ ...post(9, 999), content: 'nuevo' });
    expect(excerpts(root)[0]).toBe('nuevo');
    cleanup?.(); s.addPost({ ...post(10, 1000), content: 'otro' });
    expect(excerpts(root)[0]).toBe('nuevo');
  });
});

describe('rankings', () => {
  const setup = () => {
    const s = new ZapStore();
    for (let i = 0; i < 12; i++) {
      s.addPost({ ...post(i, 1), content: `Post ${i} <b>x</b>` });
      s.addZap(zap(i, i, 100 + i, (i + 1) * 1000));
    }
    s.addZap({ ...zap(99, 99, 50, 50_000), postId: 'borrado' });
    return s;
  };
  it('muestra título y estado vacío ajustado cuando no hay zaps', () => {
    const root = document.createElement('div'), cleanup = top10HistoricoScene(new ZapStore()).render(root);
    expect(root.querySelector('h1')!.textContent).toBe('Top 10 zaps · histórico');
    expect(root.querySelector('.empty-msg')!.textContent).toBe('Todavía no hay zaps en este período');
    expect(root.querySelector('li')).toBeNull();
    cleanup?.();
  });
  it('ordena diez filas con rank, sats, autor y extracto escapado; excluye huérfanos y actualiza en vivo', () => {
    profiles.set('a'.repeat(64), null);
    const s = setup(), root = document.createElement('div'), cleanup = top10HistoricoScene(s).render(root);
    const rows = root.querySelectorAll('.top-list li');
    expect(rows).toHaveLength(10);
    expect(rows[0].querySelector('.rank')!.textContent).toBe('#1');
    expect(rows[0].querySelector('.amount')!.textContent).toBe(sats(12_000));
    expect(rows[0].querySelector('.excerpt')!.textContent).toBe('Post 11 <b>x</b>');
    expect(rows[0].querySelector('.author')!.textContent).toBe('aaaaaaaa…aaaa');
    expect(rows[9].querySelector('.rank')!.textContent).toBe('#10');
    expect(root.textContent).not.toContain('post no disponible');
    expect(root.querySelector('.top-list b')).toBeNull();
    s.addZap(zap(100, 0, 200, 10_000_000));
    expect(root.querySelector('.top-list li .excerpt')!.textContent).toBe('Post 0 <b>x</b>');
    cleanup?.();
  });
  it('cuenta solo la ventana reciente configurable y muestra vacío al quedar sin zaps recientes', () => {
    const now = 1_000_000, s = new ZapStore(), root = document.createElement('div');
    s.addPost({ ...post(1, 1), content: 'A' }); s.addPost({ ...post(2, 1), content: 'B' });
    s.addZap(zap(1, 1, now - 4 * 3600, 900_000));
    s.addZap(zap(2, 2, now - 60, 1000)); s.addZap(zap(3, 1, now - 100, 2000));
    const show = (hours: number, time = now) => top10Ultimas3hScene(s, hours, () => time * 1000).render(root);
    let cleanup = show(3);
    expect(root.querySelector('h1')!.textContent).toBe('Top 10 zaps · últimas 3 horas');
    expect([...root.querySelectorAll('.top-list li')].map((li) => [li.querySelector('.excerpt')!.textContent, li.querySelector('.amount')!.textContent])).toEqual([['A', sats(2000)], ['B', sats(1000)]]);
    cleanup?.(); cleanup = show(6);
    expect(root.querySelector('h1')!.textContent).toBe('Top 10 zaps · últimas 6 horas');
    expect(root.querySelector('.amount')!.textContent).toBe(sats(902_000));
    cleanup?.(); cleanup = show(3, now + 4 * 3600);
    expect(root.querySelector('.empty-msg')!.textContent).toBe('Todavía no hay zaps en este período');
    cleanup?.();
  });
});

describe('últimos zaps', () => {
  const setup = (n: number) => {
    const s = new ZapStore(); s.addPost({ ...post(1, 1), content: 'Post A <script>' });
    for (let i = 0; i < n; i++) s.addZap({ ...zap(i, 1, i, (i + 1) * 1000), comment: i === n - 1 ? 'el último' : '' });
    return s;
  };
  it('muestra estado vacío y los diez más nuevos con comentario y extracto escapado', () => {
    const root = document.createElement('div');
    let cleanup = latestZapsScene(setup(0)).render(root);
    expect(root.querySelector('h1')!.textContent).toContain('Últimos zaps');
    expect(root.querySelector('.empty-msg')!.textContent).toBe('Todavía no hay zaps');
    expect(root.querySelector('li')).toBeNull();
    cleanup?.(); cleanup = latestZapsScene(setup(12)).render(root);
    const rows = root.querySelectorAll('.zap-list li');
    expect(rows).toHaveLength(10);
    expect(rows[0].querySelector('.amount')!.textContent).toBe(sats(12_000));
    expect(rows[0].textContent).toContain('el último');
    expect(rows[0].querySelector('small')!.textContent).toBe('Post A <script>');
    expect(root.querySelector('script')).toBeNull();
    cleanup?.();
  });
  it('actualiza hasta limpiar', () => {
    const s = setup(1), root = document.createElement('div'), cleanup = latestZapsScene(s).render(root);
    s.addZap(zap(20, 2, 50, 99000));
    expect(root.querySelector('.amount')!.textContent).toBe(sats(99000));
    cleanup?.(); s.addZap(zap(21, 2, 60, 1000));
    expect(root.querySelectorAll('.zap-list li')).toHaveLength(2);
  });
});

describe('anuncio', () => {
  it('limita a 280 grafemas, notifica cambios reales y permite desuscribirse', () => {
    const a = new Announcement('hola'), fn = vi.fn(), off = a.onChange(fn);
    a.set('hola'); expect(fn).not.toHaveBeenCalled();
    a.set('chau'); expect(fn).toHaveBeenCalledOnce();
    a.set('🧡'.repeat(300)); expect([...a.text]).toHaveLength(280);
    off(); a.set('otro'); expect(fn).toHaveBeenCalledTimes(2);
  });
  it('renderiza vacío o texto escapado, actualizándose hasta limpiar', () => {
    const a = new Announcement(''), root = document.createElement('div'), cleanup = anuncioScene(a).render(root);
    expect(root.querySelector('.empty-msg')!.textContent).toBe(EMPTY_ANUNCIO);
    a.set('Charla a las <b>18</b>');
    expect(root.querySelector('h1')!.textContent).toBe('📣 Anuncio');
    expect(root.querySelector('.anuncio-msg')!.textContent).toBe('Charla a las <b>18</b>');
    expect(root.querySelector('.anuncio-msg b')).toBeNull();
    cleanup?.(); a.set('otro');
    expect(root.querySelector('.anuncio-msg')!.textContent).toBe('Charla a las <b>18</b>');
  });
});

describe('composición y QR', () => {
  const URL = 'https://totem.example/';
  it('construye renderizadores en orden de agenda y resuelve la URL pública o el origin', () => {
    expect(buildScenes(defaultConfig, new ZapStore()).map((scene) => scene.name)).toEqual(ORDER);
    expect(publicUrlOf({ ...defaultConfig, publicUrl: URL }, 'http://x')).toBe(URL);
    expect(publicUrlOf(defaultConfig, 'https://example.com')).toBe('https://example.com/');
  });
  it.each(['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio'])('%s tiene un solo QR de la app incluso vacío', (name) => {
    const scene = buildScenes({ ...defaultConfig, publicUrl: URL }, new ZapStore(), new Announcement(''), 'http://x').find((s) => s.name === name)!;
    const root = document.createElement('div'), cleanup = scene.render(root), qr = root.querySelectorAll('figure.qr');
    expect(qr).toHaveLength(1);
    expect(qr[0].getAttribute('data-uri')).toBe(URL);
    expect(qr[0].querySelector('svg')).not.toBeNull();
    expect(qr[0].querySelector('figcaption')!.textContent).toBe(QR_CAPTION);
    cleanup?.();
  });
  it('el video no lleva QR', () => {
    const scene = buildScenes(defaultConfig, new ZapStore()).find((s) => s.name === 'video')!;
    const root = document.createElement('div'), cleanup = scene.render(root);
    expect(root.querySelector('figure.qr')).toBeNull(); cleanup?.();
  });
});

describe('ajuste y ciclo de vida', () => {
  it('agrupa ráfagas de cambios sin perder el último estado y cancela el redibujo pendiente al salir', () => {
    const s = new ZapStore(), sizes: number[] = [];
    const off = live(s, () => sizes.push(s.posts.size));
    for (let i = 0; i < 30; i++) s.addPost(post(i, 1));
    expect(sizes).toEqual([0, 1]);
    vi.advanceTimersByTime(100);
    expect(sizes).toEqual([0, 1, 30]);
    s.addPost(post(31, 1));
    off();
    vi.advanceTimersByTime(100);
    expect(sizes).toEqual([0, 1, 30]);
  });
  it('ajusta las listas al renderizar y después de un cambio, marcando los mensajes recortables', () => {
    const s = new ZapStore(); s.addPost(post(1, 1)); s.addZap(zap(1, 1, 2));
    for (const [scene, list, message] of [[postScene(s), '.post-list', '.post-row .excerpt'], [latestZapsScene(s), '.zap-list', '.zap-list .who'], [top10HistoricoScene(s), '.top-list', '.top-list .excerpt']] as const) {
      const root = document.createElement('div'), cleanup = scene.render(root), el = root.querySelector<HTMLElement>(list)!;
      expect(el.dataset.fit).toBe('list');
      expect(el.style.fontSize).toMatch(/px$/);
      expect(root.querySelector(message)!.hasAttribute('data-clip')).toBe(true);
      s.addZap({ ...zap(10, 1, 3), id: list });
      expect(root.querySelector<HTMLElement>(list)!.style.fontSize).toMatch(/px$/);
      cleanup?.();
    }
  });
  it('live redibuja en cambios y resize, y se desuscribe al limpiar', () => {
    const s = new ZapStore(), draw = vi.fn(), off = live(s, draw);
    expect(draw).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('resize')); expect(draw).toHaveBeenCalledTimes(2);
    s.addPost(post(1, 1));
    vi.advanceTimersByTime(100);
    expect(draw).toHaveBeenCalledTimes(3);
    off(); window.dispatchEvent(new Event('resize')); s.addPost(post(2, 1));
    expect(draw).toHaveBeenCalledTimes(3);
  });
});
