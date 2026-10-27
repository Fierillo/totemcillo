// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { postScene, fitBoxes, LONG_COMMENT, MAX_BOXES, BOX_MIN_PX, BOX_COMFORT_PX, BOX_MIN_RATIO } from '../src/scenes/post';
import { domMeasurer, type Measurer } from '../src/fit';
import { batallaScene, MAX_BARS, BAR_CHARS, BAR_MIN_PX, BAR_GAP } from '../src/scenes/batalla';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { DEFAULT_SCENE_MS, SCENES, SCHEDULE_DEFAULTS } from '../shared/settings';
import { ORDER } from '../shared/schedule';
import { TARGET_SCENES } from '../src/livefeed';
import { profiles } from '../src/nostr/profiles';

const NOW = 1_800_000_000;
const hex = (n: number) => n.toString(16).padStart(64, '0');
const pk = (c: string) => c.repeat(64);
const mk = () => new ZapStore(undefined, { clock: () => NOW });
const post = (s: ZapStore, n: number, author = 'a', ago = 60) => s.addPost({ id: hex(n), pubkey: pk(author), content: `post ${n}`, created_at: NOW - ago });
let zn = 0;
const zap = (s: ZapStore, n: number, msats: number, comment = '', ago = 5) => s.addZap({ id: hex(5000 + ++zn), postId: hex(n), msats, comment, created_at: NOW - ago, sender: pk('f') });
const bars = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.batalla > li')].sort((a, b) => Number(a.style.getPropertyValue('--rank')) - Number(b.style.getPropertyValue('--rank')));

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(NOW * 1000); });
afterEach(() => { profiles.clear(); vi.useRealTimers(); document.querySelectorAll('svg.strike, .strike-gain').forEach((e) => e.remove()); });

describe('agenda PC: 3 escenas + video', () => {
  it('mensajes, batalla y anuncio; mensajes dura más que el resto; anuncio y video cortos', () => {
    expect([...SCENES]).toEqual(['post', 'batalla', 'anuncio']);
    expect(ORDER).toEqual(['post', 'batalla', 'anuncio', 'video']);
    expect(DEFAULT_SCENE_MS.post).toBeGreaterThan(DEFAULT_SCENE_MS.batalla);
    expect(DEFAULT_SCENE_MS.batalla).toBeGreaterThan(DEFAULT_SCENE_MS.anuncio);
    expect(DEFAULT_SCENE_MS.anuncio).toBeLessThanOrEqual(12_000);
    expect(SCHEDULE_DEFAULTS.videoMode).toBe('clip');
    expect(buildScenes(defaultConfig, mk(), undefined, 'https://x').map((s) => s.name)).toEqual(ORDER);
    expect(TARGET_SCENES.zap).toEqual(['post', 'batalla']);
  });
});

describe('Mensajes', () => {
  it('posts grandes (pocos a la vez) y comentarios largos de zaps como mensajes, del más nuevo al más viejo', () => {
    const s = mk();
    post(s, 1, 'a', 300); post(s, 2, 'b', 200);
    zap(s, 1, 21_000, 'x'.repeat(LONG_COMMENT), 100);
    zap(s, 1, 1_000, 'corto', 50);
    const root = document.createElement('div');
    const off = postScene(s, { publicUrl: 'https://x/' }).render(root);
    const rows = [...root.querySelectorAll('.post-row')];
    expect(rows.map((r) => r.querySelector('.excerpt')!.textContent)).toEqual(['post 1', 'x'.repeat(LONG_COMMENT), 'post 2']); // its last zap moved post 1 up
    expect(rows[1].classList.contains('msg-zap')).toBe(true);
    expect(rows[1].querySelector('.row-total')!.textContent).toContain('21 sats');
    expect(root.querySelector('h1')!.textContent).toBe('Últimos mensajes');
    if (off) off();
  });
});

describe('Mensajes como cajas flotantes', () => {
  const scene = (canZap?: (p: string) => Promise<boolean>, n = 12) => {
    const s = mk();
    for (let i = 1; i <= n; i++) post(s, i, i === 11 ? 'b' : 'a', 600 - i);
    const root = document.createElement('div');
    const off = postScene(s, { publicUrl: 'https://x/', canZap }).render(root);
    return { s, root, off: off ?? (() => {}) };
  };

  it('pide tantos mensajes como pueden entrar (no 9 fijos) y el ajuste deja los que caben a letra fija legible', () => {
    const { root, off } = scene(undefined, MAX_BOXES + 10);
    const rows = [...root.querySelectorAll<HTMLElement>('.post-list[data-boxes] > .post-row')];
    expect(MAX_BOXES).toBeGreaterThan(9);
    expect(rows).toHaveLength(MAX_BOXES); // happy-dom has no layout: every candidate "fits"
    expect(root.querySelector<HTMLElement>('.post-list')!.dataset.floor).toBe(String(BOX_COMFORT_PX));
    expect(root.querySelectorAll('.post-list > .qr-slot:not(.post-row)')).toHaveLength(1); // the QR keeps only its own corner of the list
    off();
  });

  it('los sats van en la cabecera de la caja, junto al autor y la hora (sin fila propia)', () => {
    const { root, off } = scene();
    for (const row of root.querySelectorAll('.post-list > .post-row')) expect(row.querySelector('.row-meta > .row-total')).not.toBeNull();
    off();
  });

  it('cada caja tiene su propia fase de flotado', () => {
    const { root, off } = scene();
    const rows = [...root.querySelectorAll<HTMLElement>('.post-list[data-boxes] > .post-row')];
    expect(new Set(rows.map((r) => r.style.getPropertyValue('--i'))).size).toBe(rows.length);
    off();
  });

  it('un mensaje largo no se corta a un largo fijo: la caja recibe el texto completo', () => {
    const s = mk();
    s.addPost({ id: hex(1), pubkey: pk('a'), content: 'palabra '.repeat(20).trim(), created_at: NOW - 60 });
    const root = document.createElement('div');
    const off = postScene(s, { publicUrl: 'https://x/' }).render(root);
    expect(root.querySelector('.excerpt')!.textContent).toBe('palabra '.repeat(20).trim());
    off?.();
  });

  describe('orden de lectura: arriba a la izquierda el de actividad más reciente', () => {
    const ids = (root: HTMLElement) => [...root.querySelectorAll<HTMLElement>('.post-list > .post-row')].map((r) => r.dataset.id);
    it('un zap sube su post al primer lugar y los demás se corren una posición', () => {
      const s = mk();
      [1, 2, 3].forEach((n) => post(s, n, 'a', 100 * n)); // 1 newest
      const root = document.createElement('div');
      const off = postScene(s, { publicUrl: 'https://x/' }).render(root)!;
      expect(ids(root)).toEqual([hex(1), hex(2), hex(3)]);
      zap(s, 3, 1_000, '', 1);
      expect(ids(root)).toEqual([hex(3), hex(1), hex(2)]);
      off();
    });
    it('un post nuevo entra primero, aunque haya uno zapeado antes', () => {
      const s = mk();
      [1, 2].forEach((n) => post(s, n, 'a', 100 * n));
      zap(s, 2, 1_000, '', 50);
      const root = document.createElement('div');
      const off = postScene(s, { publicUrl: 'https://x/' }).render(root)!;
      post(s, 9, 'a', 0);
      expect(ids(root)).toEqual([hex(9), hex(2), hex(1)]);
      off();
    });
    it('la grilla no rellena huecos reordenando (sin dense): el orden visual es el del DOM', async () => {
      const css = (await import('node:fs')).readFileSync('src/style.css', 'utf8');
      expect(css).not.toMatch(/\.post-list\[data-boxes\][^}]*grid-auto-flow:[^;]*dense/);
    });
  });

  describe('orden por caja: achicar letra → agrandar caja (2 filas) → truncar', () => {
    // Fake layout: a message fits if font × length <= its box's room (a two-row box has more).
    const ONE = 600, TWO = 1400;
    const fit = (texts: string[]) => {
      const fits = (el: HTMLElement) => !el.matches('.excerpt') || parseFloat(el.style.fontSize) * (el.textContent ?? '').length <= (el.closest('.is-long') ? TWO : ONE);
      const root = document.createElement('div');
      root.innerHTML = `<ul class="post-list" data-max="3" data-floor="${BOX_COMFORT_PX}">${texts.map((t) => `<li class="post-row"><div class="row-main"><div class="row-meta"></div><p class="excerpt">${t}</p></div></li>`).join('')}</ul>`;
      fitBoxes(root, { setSize: domMeasurer.setSize, fits }, 1000, 1000); // 3vh = 30px
      return [...root.querySelectorAll<HTMLElement>('.post-row')].map((r) => { const p = r.querySelector<HTMLElement>('.excerpt')!; return { px: parseFloat(p.style.fontSize), long: r.classList.contains('is-long'), cut: p.textContent!.endsWith('…') }; });
    };
    it('1) primero baja la letra dentro de una caja normal, hasta el mínimo (~70% de la cómoda)', () => {
      expect(fit(['x'.repeat(25)])).toEqual([{ px: 24, long: false, cut: false }]); // 30 × 25 > 600; 24 × 25 = 600
    });
    it('2) si al mínimo no entra en una celda, la caja pasa a dos filas con la letra más grande que entre', () => {
      expect(fit(['x'.repeat(34)])).toEqual([{ px: 30, long: true, cut: false }]); // min 18 × 34 > 600; 30 × 34 <= 1400
      expect(fit(['x'.repeat(60)])).toEqual([{ px: 23, long: true, cut: false }]); // 23 × 60 = 1380
    });
    it('3) sólo si tampoco entra en dos filas, trunca con «…» al mínimo', () => {
      expect(fit(['palabra '.repeat(30).trim()])).toEqual([{ px: Math.max(BOX_MIN_PX, Math.floor(30 * BOX_MIN_RATIO)), long: true, cut: true }]);
    });
    it('un mensaje corto queda en una celda a la letra de la lista, sin importar cuántos caracteres tenga otro', () => {
      expect(fit(['corto', 'x'.repeat(34)]).map((b) => b.long)).toEqual([false, true]);
    });
  });

  it('mensajes largos: primero baja la letra de esa caja (hasta el mínimo legible) y recién ahí trunca', () => {
    // Fake layout: a box's text "fits" if font × length <= 600 (the box already stretched to its max).
    const fits = (el: HTMLElement) => !el.matches('.excerpt') || parseFloat(el.style.fontSize) * (el.textContent ?? '').length <= 600; // the list and its boxes have room
    const m: Measurer = { setSize: domMeasurer.setSize, fits };
    const root = document.createElement('div');
    root.innerHTML = `<ul class="post-list" data-max="3" data-floor="${BOX_MIN_PX}">${['corto', 'x'.repeat(24), 'palabra '.repeat(40).trim()].map((t) => `<li class="post-row"><div class="row-main"><div class="row-meta"></div><p class="excerpt">${t}</p></div></li>`).join('')}</ul>`;
    fitBoxes(root, m, 1000, 1000); // 3vh = 30px
    const [short, medium, long] = [...root.querySelectorAll<HTMLElement>('.excerpt')];
    expect([parseFloat(short.style.fontSize), short.textContent]).toEqual([30, 'corto']);
    expect([parseFloat(medium.style.fontSize), medium.textContent]).toEqual([25, 'x'.repeat(24)]);
    expect(parseFloat(long.style.fontSize)).toBe(Math.floor(30 * BOX_MIN_RATIO));
    expect(long.textContent!.endsWith('…')).toBe(true);
    expect([...root.querySelectorAll<HTMLElement>('.row-meta')].map((h) => parseFloat(h.style.fontSize))).toEqual([30, 25, Math.floor(30 * BOX_MIN_RATIO)]); // sats as big as their message
  });

  describe('la lista llena su área', () => {
    // Fake layout: every text fits; the list fits while the boxes' font × length adds up to <= room.
    const load = (el: Element) => [...el.querySelectorAll<HTMLElement>('.post-row:not([hidden]) .excerpt')].reduce((sum, p) => sum + parseFloat(p.style.fontSize) * p.textContent!.length, 0);
    const fill = (room: number, floor: number, maxVh: number, comfortVh = 0) => {
      const m: Measurer = { setSize: domMeasurer.setSize, fits: (el) => !el.matches('ul') || load(el) <= room };
      const root = document.createElement('div');
      root.innerHTML = `<ul class="post-list" data-max="${maxVh}" data-floor="${floor}" data-comfort="${comfortVh}">${'<li class="post-row"><p class="excerpt">xxxxxxxxxx</p></li>'.repeat(3)}</ul>`;
      fitBoxes(root, m, 1000, 1000);
      return { size: root.querySelector<HTMLElement>('.post-list')!.style.fontSize, boxes: root.querySelectorAll('.post-row').length };
    };
    it('si entran todas, la letra sube hasta llenar el área (sin pasar el máximo)', () => {
      expect(fill(900, 20, 5)).toEqual({ size: '30px', boxes: 3 }); // 3 × 10 × 30 = 900
      expect(fill(9000, 20, 5)).toEqual({ size: '50px', boxes: 3 }); // capped at 5vh
    });
    it('prefiere menos cajas cómodas: con la letra mínima cómoda no entran todas, deja las que entran y las agranda', () => {
      expect(fill(500, 20, 5)).toEqual({ size: '25px', boxes: 2 }); // 3 × 10 × 20 = 600 > 500; 2 × 10 × 25 = 500
    });
    it('en una ventana muy chica, si ni una caja entra a la letra cómoda, baja hasta el mínimo legible', () => {
      expect(fill(150, 20, 5)).toEqual({ size: '15px', boxes: 1 }); // 1 × 10 × 20 > 150; 1 × 10 × 15 = 150
    });
    it('en una ventana grande la letra cómoda escala con el alto (data-comfort vh): menos cajas, más grandes', () => {
      expect(fill(900, 20, 5, 4)).toEqual({ size: '45px', boxes: 2 }); // floor 4vh = 40px: 3 × 10 × 40 > 900 drops one; 2 × 10 × 45 = 900
    });
  });

  it('un comentario de zap que llega en vivo entra con el efecto de post nuevo (sólo esa caja, una vez)', async () => {
    const { s, root, off } = scene();
    zap(s, 12, 21_000, 'c'.repeat(LONG_COMMENT), 1);
    await vi.advanceTimersByTimeAsync(200);
    const box = root.querySelector('.msg-zap')!;
    expect(box.classList.contains('is-new')).toBe(true);
    expect(root.querySelectorAll('.is-new')).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3600); // effect over: later redraws don't replay it
    s.addPost({ id: hex(99), pubkey: pk('a'), content: 'otro', created_at: NOW });
    await vi.advanceTimersByTimeAsync(200);
    expect(root.querySelector('.msg-zap')!.classList.contains('is-new')).toBe(false);
    expect(root.querySelector(`[data-id="${hex(99)}"]`)!.classList.contains('is-new')).toBe(true);
    off();
  });

  it('un redibujado tardío (perfil / canZap) a mitad del efecto lo continúa sin reiniciarlo ni cortarlo', async () => {
    const { s, root, off } = scene();
    s.addPost({ id: hex(99), pubkey: pk('9'), content: 'nuevo', created_at: NOW });
    zap(s, 12, 21_000);
    await vi.advanceTimersByTimeAsync(150);
    const row = () => root.querySelector<HTMLElement>(`[data-id="${hex(99)}"]`)!;
    const zrow = () => root.querySelector<HTMLElement>(`[data-id="${hex(12)}"]`)!;
    expect(row().classList.contains('is-new')).toBe(true);
    const strikes = document.querySelectorAll('svg.strike').length;
    await vi.advanceTimersByTimeAsync(850);
    profiles.set(pk('9'), null); // late redraw ~1 s later
    await vi.advanceTimersByTimeAsync(150);
    expect(row().classList.contains('is-new')).toBe(true);
    expect(parseFloat(row().style.animationDelay)).toBeLessThanOrEqual(-900);
    expect(zrow().classList.contains('is-zapped')).toBe(true);
    expect(document.querySelectorAll('svg.strike').length).toBe(strikes); // no new strike
    await vi.advanceTimersByTimeAsync(4000);
    profiles.set(pk('9'), null);
    await vi.advanceTimersByTimeAsync(150);
    expect(row().classList.contains('is-new')).toBe(false);
    expect(zrow().classList.contains('is-zapped')).toBe(false);
    off();
  });

  it('un zap en vivo a un post en pantalla: sólo el rayo real (strike) y sats al día, sin ícono simbólico encima', async () => {
    const { s, root, off } = scene();
    zap(s, 12, 21_000); zap(s, 12, 42_000);
    await vi.advanceTimersByTimeAsync(200);
    expect(document.querySelector('svg.strike')).not.toBeNull();
    expect(root.querySelector(`[data-id="${hex(12)}"] .row-total`)!.textContent).toContain('63 sats');
    off();
  });
});

describe('Batalla de zaps: el mensaje es protagonista', () => {
  it('ventana alta: entran todas las barras posibles (más de 6) con separación mínima fija', async () => {
    const s = mk();
    for (let i = 1; i <= 30; i++) { post(s, i, 'a'); zap(s, i, i * 1000); }
    const root = document.createElement('div');
    const off = batallaScene(s, 3, 'https://x/').render(root);
    const ol = root.querySelector<HTMLElement>('.batalla')!;
    Object.defineProperty(ol, 'clientHeight', { configurable: true, value: 900 });
    zap(s, 1, 1);
    await vi.advanceTimersByTimeAsync(150);
    const n = Math.floor((900 + BAR_GAP) / (BAR_MIN_PX + BAR_GAP));
    expect(n).toBeGreaterThan(6);
    expect(BAR_GAP).toBeGreaterThanOrEqual(8);
    expect(root.querySelectorAll('.batalla > li')).toHaveLength(n);
    expect(ol.style.getPropertyValue('--n')).toBe(String(n));
    expect(ol.style.getPropertyValue('--gap')).toBe(`${BAR_GAP}px`);
    off?.();
  });

  it('ventana baja: muestra menos barras (mínimo una) en vez de recortar el texto', async () => {
    const s = mk();
    for (let i = 1; i <= 6; i++) { post(s, i, 'a'); zap(s, i, i * 1000); }
    const root = document.createElement('div');
    const off = batallaScene(s, 3, 'https://x/').render(root);
    expect(root.querySelectorAll('.batalla > li')).toHaveLength(6); // fewer posts than places: all of them
    const ol = root.querySelector<HTMLElement>('.batalla')!;
    Object.defineProperty(ol, 'clientHeight', { configurable: true, value: BAR_MIN_PX * 2.5 });
    zap(s, 1, 1);
    await vi.advanceTimersByTimeAsync(150);
    expect(root.querySelectorAll('.batalla > li')).toHaveLength(2);
    expect(ol.style.getPropertyValue('--n')).toBe('2');
    Object.defineProperty(ol, 'clientHeight', { configurable: true, value: 10 });
    zap(s, 1, 1);
    await vi.advanceTimersByTimeAsync(150);
    expect(root.querySelectorAll('.batalla > li')).toHaveLength(1);
    off?.();
  });

  it('el texto del post va antes de la barra (línea fina) y muestra hasta BAR_CHARS caracteres', () => {
    const s = mk();
    s.addPost({ id: hex(1), pubkey: pk('a'), content: 'palabra '.repeat(100), created_at: NOW - 60 });
    zap(s, 1, 21_000);
    const root = document.createElement('div');
    const off = batallaScene(s, 3, 'https://x/').render(root);
    const li = root.querySelector('.batalla > li')!;
    const ex = li.querySelector('.bar-msg .bar-text')!;
    // Rank + author inline at the start of the same line as the message, no separate row.
    const msg = li.querySelector('.bar-msg')!;
    expect(msg.firstElementChild!.matches('.bar-label')).toBe(true);
    expect(msg.querySelector('.bar-label .rank')!.textContent).toBe('#1');
    expect(li.querySelectorAll(':scope > .bar-label')).toHaveLength(0);
    expect(BAR_MIN_PX).toBeLessThan(72);
    expect(BAR_CHARS).toBeGreaterThanOrEqual(120);
    expect([...ex.textContent!].length).toBeLessThanOrEqual(BAR_CHARS + 1);
    expect([...ex.textContent!].length).toBeGreaterThan(100);
    expect(ex.compareDocumentPosition(li.querySelector('.bar-track')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(li.querySelector('.bar-sats')!.textContent).toContain('21 sats');
    off?.();
  });
});

describe('Batalla de zaps', () => {
  const setup = (canZap?: (p: string) => Promise<boolean>) => {
    const s = mk();
    post(s, 1, 'a'); post(s, 2, 'b'); post(s, 3, 'c');
    zap(s, 1, 30_000); zap(s, 2, 20_000); zap(s, 3, 10_000, '', 4 * 3600); // 3: outside the 3h window
    const root = document.createElement('div');
    const off = batallaScene(s, 3, 'https://x/', canZap).render(root);
    return { s, root, off: off as () => void };
  };

  it('barras de los más zapeados de las últimas horas, proporcionales y ordenadas', async () => {
    const { root, off } = setup();
    await vi.advanceTimersByTimeAsync(100);
    const b = bars(root);
    expect(MAX_BARS).toBeGreaterThanOrEqual(5);
    expect(b.map((li) => li.dataset.id)).toEqual([hex(1), hex(2)]);
    expect(b[0].querySelector<HTMLElement>('.bar-fill')!.style.width).toBe('100%');
    expect(parseFloat(b[1].querySelector<HTMLElement>('.bar-fill')!.style.width)).toBeCloseTo(66.67, 1);
    expect(b[1].querySelector('.bar-sats')!.textContent).toContain('20 sats');
    expect(root.querySelector('figure.qr')).not.toBeNull();
    off();
  });

  it('excluye autores no zapeables', async () => {
    const { root, off } = setup(async (p) => p !== pk('a'));
    await vi.advanceTimersByTimeAsync(100);
    expect(bars(root).map((li) => li.dataset.id)).toEqual([hex(2)]);
    off();
  });

  it('en vivo: la barra crece y se reordena sin recrearse, con aviso de sorpasso y globo con el comentario (hinchada)', async () => {
    const { s, root, off } = setup();
    await vi.advanceTimersByTimeAsync(100);
    const li2 = root.querySelector<HTMLElement>(`[data-id="${hex(2)}"]`)!;
    zap(s, 2, 15_000, '¡vamos!', 1);
    await vi.advanceTimersByTimeAsync(150);
    expect(bars(root).map((li) => li.dataset.id)).toEqual([hex(2), hex(1)]);
    expect(root.querySelector(`[data-id="${hex(2)}"]`)).toBe(li2);
    expect(li2.querySelector<HTMLElement>('.bar-fill')!.style.width).toBe('100%');
    expect(root.querySelector('.batalla-aviso')!.textContent).toContain('pasó');
    expect(li2.querySelector('.globo')!.textContent).toBe('¡vamos!');
    expect(li2.classList.contains('is-hinchada')).toBe(true);
    await vi.advanceTimersByTimeAsync(8000);
    expect(li2.querySelector('.globo')).toBeNull();
    expect(li2.classList.contains('is-hinchada')).toBe(false);
    expect(root.querySelector('.batalla-aviso')!.textContent).toBe('');
    off();
  });

  it('vacío sin zaps recientes', () => {
    const s = mk(); post(s, 1);
    const root = document.createElement('div');
    const off = batallaScene(s, 3).render(root) as () => void;
    expect(root.querySelector('.empty-msg')!.textContent).toBe('Todavía no hay zaps en las últimas 3 horas');
    off();
  });
});
