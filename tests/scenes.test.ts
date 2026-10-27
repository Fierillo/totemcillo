// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZapStore, type LiveEvent } from '../src/nostr/store';
import { postScene, QR_CAPTION, MAX_BOXES } from '../src/scenes/post';
import { batallaScene } from '../src/scenes/batalla';
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
const bat = (s: ZapStore) => batallaScene(s);

beforeEach(() => vi.useFakeTimers());
afterEach(() => { profiles.clear(); vi.useRealTimers(); document.querySelectorAll('svg.strike, .strike-gain').forEach((e) => e.remove()); });

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
    expect(ev).toEqual([{ type: 'post', postId: hex(2) }, { type: 'zap', postId: hex(1), msats: 21_000 }]);
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
    vi.advanceTimersByTime(3600); // its effect is over
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
  it('lista de posts: la fila zapeada recibe is-zapped, un rayo real cae sobre ella y el total se actualiza', () => {
    const s = mkStore();
    s.addPost(post(1)); s.addPost(post(2));
    const root = document.createElement('div');
    postScene(s, { publicUrl: 'https://x/' }).render(root);
    s.addZap(zap(1, 1, NOW - 1, 2_100_000));
    const r = root.querySelector(`.post-row[data-id="${hex(1)}"]`)!;
    expect(r.classList.contains('is-zapped')).toBe(true);
    expect(document.querySelector('svg.strike')).not.toBeNull();
    expect(r.querySelector('.row-total')!.textContent).toContain('2.100');
    expect(root.querySelectorAll('.is-zapped')).toHaveLength(1);
  });
  it('el rayo deja "+N sats" con lo que sumó el zap (en vivo y al reponer un pendiente)', () => {
    const s = mkStore();
    s.addPost(post(1));
    s.addZap(zap(1, 1, NOW - 1, 5_000_000)); // off-scene: pending
    postScene(s, { publicUrl: 'https://x/' }).render(document.createElement('div'));
    expect(document.querySelector('.strike-gain')!.textContent).toBe('+5.000 sats');
    document.querySelectorAll('.strike-gain').forEach((e) => e.remove());
    s.addZap(zap(2, 1, NOW - 1, 21_000)); // live, on screen
    expect(document.querySelector('.strike-gain')!.textContent).toBe('+21 sats');
  });
  it('totales acumulados: el número parpadea hasta que el backfill termina', () => {
    const s = mkStore();
    s.addPost(post(1)); s.addZap(zap(1, 1, NOW - 3600, 2_100_000));
    const posts = document.createElement('div'), top = document.createElement('div');
    postScene(s, { publicUrl: 'https://x/' }).render(posts);
    bat(s).render(top);
    expect(posts.querySelector('.row-total .pending')!.textContent).toBe('2.100');
    expect(posts.querySelector('.row-total')!.textContent).toContain('2.100');
    expect(top.querySelector('.bar-sats .pending')!.textContent).toBe('2.100');
    expect(top.querySelector('.bar-sats')!.textContent).toBe(' 2.100');
    s.setReady();
    expect(posts.querySelector('.pending')).toBeNull();
    expect(top.querySelector('.pending')).toBeNull();
  });
  it('batalla: rayo real sobre la barra del post zapeado; zap viejo no anima', () => {
    const s = mkStore();
    s.addPost(post(1)); s.addPost(post(2));
    s.addZap(zap(1, 2, NOW - 3600));
    const root = document.createElement('div');
    bat(s).render(root);
    expect(document.querySelector('svg.strike')).toBeNull();
    s.addZap(zap(2, 1, NOW - 1));
    expect(root.querySelector(`li[data-id="${hex(1)}"]`)).not.toBeNull();
    expect(document.querySelector('svg.strike')).not.toBeNull();
  });
  it('zap a un post que no estaba en pantalla: entra primero (arriba a la izquierda) y se anima ahí', () => {
    const s = mkStore();
    for (let i = 1; i <= MAX_BOXES + 3; i++) s.addPost(post(i, NOW - 3600 + i));
    const root = document.createElement('div');
    postScene(s, { publicUrl: 'https://x/' }).render(root); // shows the MAX_BOXES newest: post 1 is out
    s.addZap(zap(1, 1, NOW - 1));
    expect(root.querySelector<HTMLElement>('.post-row')!.dataset.id).toBe(hex(1));
    expect(root.querySelector<HTMLElement>('.is-zapped')!.dataset.id).toBe(hex(1));
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
  const topSc = (s: ZapStore) => { const r = document.createElement('div'); const off = bat(s).render(r) as () => void; return { r, off }; };
  it('zap con otra escena (anuncio/video): indicador ⚡ abajo y pendiente; al entrar a posts, rayo en esa fila', () => {
    const s = mkStore();
    s.addPost(post(1));
    const ind: string[] = [];
    feedFor(s).onMiss((e) => ind.push(e.type));
    s.addZap(zap(1, 1, NOW - 1));
    expect(ind).toEqual(['zap']);
    expect(feedFor(s).pending).toHaveLength(1);
    const { r } = postSc(s);
    const row = r.querySelector(`.post-row[data-id="${hex(1)}"]`)!;
    expect(row.classList.contains('is-zapped')).toBe(true);
    expect(document.querySelector('svg.strike')).not.toBeNull();
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it('zap con otra escena: al entrar a la batalla se repite ahí con el rayo', () => {
    const s = mkStore();
    s.addPost(post(1));
    s.addZap(zap(1, 1, NOW - 1));
    topSc(s);
    expect(document.querySelector('svg.strike')).not.toBeNull();
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it('post nuevo con otra escena: indicador 💬 abajo y se resalta al llegar a posts', () => {
    const s = mkStore();
    const ind: string[] = [];
    feedFor(s).onMiss((e) => ind.push(e.type));
    s.addPost(post(5, NOW - 1));
    expect(ind).toEqual(['post']);
    expect(postSc(s).r.querySelector('.is-new')).not.toBeNull();
  });
  it('objetivo ya visible: animación inmediata, sin indicador ni pendiente', () => {
    const s = mkStore();
    s.addPost(post(1));
    const ind: string[] = [];
    feedFor(s).onMiss((e) => ind.push(e.type));
    const { r } = postSc(s);
    s.addZap(zap(1, 1, NOW - 1));
    expect(r.querySelector('.is-zapped')).not.toBeNull();
    s.addPost(post(9, NOW - 1));
    vi.advanceTimersByTime(100);
    expect(r.querySelector('.is-new')).not.toBeNull();
    expect(ind).toEqual([]);
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it('watch corre antes de decidir en pantalla/fuera (aunque se suscriba después) y deja de correr al desuscribirse', () => {
    const s = mkStore();
    s.addPost(post(1));
    const seen: string[] = [];
    let onScreen = false;
    feedFor(s).onMiss(() => seen.push('miss'));
    feedFor(s).attach({ name: 't', kinds: ['zap'], visible: () => onScreen, mark: () => seen.push('mark') });
    const off = feedFor(s).watch((e) => { seen.push(`watch:${e.type}`); onScreen = true; }); // e.g. switches to the scene that shows it
    s.addZap(zap(1, 1, NOW - 1));
    expect(seen).toEqual(['watch:zap', 'mark']);
    expect(feedFor(s).pending).toHaveLength(0);
    off(); onScreen = false; seen.length = 0;
    s.addZap(zap(2, 1, NOW - 1));
    expect(seen).toEqual(['miss']);
  });
  it('escena visible pero sin esa fila (ej. batalla sin el post): indicador + pendiente', () => {
    const s = mkStore();
    for (let i = 1; i <= 8; i++) s.addPost(post(i, NOW - 3600 + i));
    topSc(s);
    const ind: string[] = [];
    feedFor(s).onMiss((e) => ind.push(e.type));
    s.addPost(post(20, NOW - 1)); // the battle doesn't show new posts
    expect(ind).toEqual(['post']);
  });
  it('zap a post que no está en mensajes: sigue pendiente para la batalla y se anima ahí', () => {
    const s = mkStore();
    for (let i = 1; i <= MAX_BOXES + 3; i++) s.addPost(post(i, i === 1 ? NOW - 3600 : NOW - 1)); // messages shows the newest MAX_BOXES: post 1 is out
    s.addZap(zap(1, 1, NOW - 2)); // its zap is older than every shown post: it doesn't move it up
    postSc(s).off();
    expect(feedFor(s).pending).toHaveLength(1);
    const { r } = topSc(s);
    expect(r.querySelector(`li[data-id="${hex(1)}"]`)).not.toBeNull();
    expect(document.querySelector('svg.strike')).not.toBeNull();
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it('vence si su post no aparece en ninguna escena que le corresponde', () => {
    const s = mkStore();
    for (let i = 1; i <= 8; i++) s.addPost(post(i, NOW - 3600 + i));
    s.addZap(zap(1, 1, NOW - 1));
    postSc(s).off();
    s.setModeration({ hiddenPosts: [], bannedPubkeys: [], startLine: new Date(NOW * 1000).toISOString() }); // battle starts after the zap → not shown
    (batallaScene(s).render(document.createElement('div')) as () => void)();
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it(`la cola tiene tope (${MAX_PENDING})`, () => {
    const s = mkStore();
    s.addPost(post(1));
    for (let i = 0; i < MAX_PENDING + 5; i++) s.addZap(zap(i, 1, NOW - 1));
    expect(feedFor(s).pending).toHaveLength(MAX_PENDING);
  });
  it('showIndicator muestra solo posts (el zap ya tiene su ráfaga grande) y los quita a ~1,5 s', () => {
    const strip = document.createElement('div');
    showIndicator(strip, { type: 'zap', postId: 'x' });
    showIndicator(strip, { type: 'post', postId: 'y' });
    expect(strip.querySelectorAll('.live-ind')).toHaveLength(1);
    expect(strip.querySelector('.live-ind.post svg')).not.toBeNull();
    vi.advanceTimersByTime(1700);
    expect(strip.querySelectorAll('.live-ind')).toHaveLength(0);
  });

  it('showIndicator ubica el post al azar en la franja baja, levemente inclinado', () => {
    const strip = document.createElement('div');
    const at = (r: number) => { showIndicator(strip, { type: 'post', postId: 'y' }, { ms: 1500, rnd: () => r }); return (strip.lastElementChild as HTMLElement).style; };
    const lo = at(0), hi = at(1);
    expect([lo.left, lo.getPropertyValue('--y'), lo.getPropertyValue('--tilt')]).toEqual(['5%', '6vh', '-12deg']);
    expect([hi.left, hi.getPropertyValue('--y'), hi.getPropertyValue('--tilt')]).toEqual(['85%', '22vh', '12deg']);
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
    expect(root.querySelector('h1')!.textContent).toBe('Últimos mensajes');
    expect(root.querySelector('.empty-msg')!.textContent).toBe('Todavía no hay posts con #lacrypta');
    expect(root.querySelectorAll('figure.qr')).toHaveLength(1);
    s.addPost({ ...post(1, 1), content: 'llegó' });
    expect(root.querySelector('h1')!.textContent).toBe('Últimos mensajes');
    expect(root.querySelector('.empty-msg')).toBeNull();
    expect(excerpts(root)).toEqual(['llegó']);
    cleanup?.();
  });
  it('lista hasta MAX_BOXES de los más recientes, de forma determinística entre renderizados', () => {
    const n = MAX_BOXES + 3, s = many(n), a = document.createElement('div'), b = document.createElement('div');
    const cleanups = [postScene(s, { publicUrl: URL }).render(a), postScene(s, { publicUrl: URL }).render(b)];
    expect(excerpts(a)).toEqual(Array.from({ length: MAX_BOXES }, (_, i) => `post ${n - i}`));
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
    const [a, b] = [...root.querySelectorAll('.post-row')]; // its zaps moved post 1 up
    expect(a.querySelector('.excerpt')!.textContent).toBe('Hola <b>mundo</b>');
    expect(a.querySelector('.excerpt b')).toBeNull();
    expect(a.querySelector('.row-total')!.textContent).toContain(sats(4_000_000));
    expect(b.querySelector('.row-total')!.textContent!.trim()).toBe(''); // unzapped: bare bolt, no "0 sats"
    expect(a.querySelector('.author')!.textContent).toBe('aaaaaaaa…aaaa');
    expect(a.querySelector('.ago')!.textContent).toMatch(/^\d+ (s|m|h|d)$/); // no «hace» prefix on the totem
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
    expect(root.querySelectorAll('svg:not(.m-bolt)')).toHaveLength(1);
    expect(root.querySelector('.author')!.textContent).toContain('<img');
    s.addPost({ ...post(9, 999), content: 'nuevo' });
    expect(excerpts(root)[0]).toBe('nuevo');
    cleanup?.(); s.addPost({ ...post(10, 1000), content: 'otro' });
    expect(excerpts(root)[0]).toBe('nuevo');
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
  it.each(['post', 'batalla', 'anuncio'])('%s tiene un solo QR de la app incluso vacío', (name) => {
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
    for (const [scene, list, message] of [[postScene(s), '.post-list', '.post-row .excerpt']] as const) {
      const root = document.createElement('div'), cleanup = scene.render(root), el = root.querySelector<HTMLElement>(list)!;
      expect(el.dataset.boxes).toBe('');
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

describe('el rediseño móvil no toca el tótem de escritorio', () => {
  it('ninguna escena de escritorio muestra pestañas, feed, ranking ni botón flotante móviles', () => {
    const s = new ZapStore();
    s.addPost({ id: 'f'.repeat(64), pubkey: 'a'.repeat(64), content: 'hola #lacrypta', created_at: Math.floor(Date.now() / 1000) });
    s.addZap({ id: 'e'.repeat(64), postId: 'f'.repeat(64), sender: 'b'.repeat(64), msats: 21_000, comment: '', created_at: Math.floor(Date.now() / 1000) });
    s.setReady();
    for (const scene of buildScenes(defaultConfig, s, new Announcement('x'), 'http://x')) {
      const root = document.createElement('div'), cleanup = scene.render(root);
      expect(root.querySelector('.m-fab, [data-compose], .m-reel, .m-top, .m-side, .m-tabs'), scene.name).toBeNull();
      cleanup?.();
    }
  });
});
