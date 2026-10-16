// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { domMeasurer, fitList, fitRegions, fitText, type Measurer } from '../src/fit';
import { graphemes, truncateText } from '../src/text';
import { ago, esc, sats, shortKey } from '../src/util';
import { fromArInput, toArInput } from '../src/startline';
import { defaultConfig, loadConfig } from '../src/config';
import shipped from '../public/config.json';

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const size = (el: HTMLElement) => parseFloat(el.style.fontSize);
/** Fake measurer: "fits" if size × text length <= capacity. */
const textMeasurer = (cap: number): Measurer => ({ setSize: domMeasurer.setSize, fits: (el) => size(el) * (el.textContent ?? '').length <= cap });
const el = (text: string) => { const e = document.createElement('p'); e.textContent = text; return e; };

describe('fitText', () => {
  it('usa el máximo si entra', () => {
    const e = el('hola');
    expect(fitText(e, { max: 50, min: 10 }, textMeasurer(1000))).toEqual({ size: 50, truncated: false });
    expect(e.style.fontSize).toBe('50px');
  });
  it('busca el mayor tamaño que entra (búsqueda binaria)', () => {
    const e = el('x'.repeat(40));
    expect(fitText(e, { max: 50, min: 10 }, textMeasurer(1000))).toEqual({ size: 25, truncated: false });
    expect(e.textContent).toBe('x'.repeat(40));
  });
  it('si en el mínimo no entra, trunca por palabras con … como último recurso', () => {
    const e = el('uno dos tres cuatro cinco seis');
    const r = fitText(e, { max: 50, min: 10 }, textMeasurer(150));
    expect(r).toEqual({ size: 10, truncated: true });
    expect(e.textContent).toBe('uno dos tres…');
    expect(size(e) * e.textContent!.length).toBeLessThanOrEqual(150);
  });
  it('re-ajustar parte del texto completo original', () => {
    const e = el('uno dos tres cuatro cinco seis');
    fitText(e, { max: 50, min: 10 }, textMeasurer(150));
    fitText(e, { max: 50, min: 10 }, textMeasurer(10_000));
    expect(e.textContent).toBe('uno dos tres cuatro cinco seis');
  });
});

describe('fitList', () => {
  const list = (n: number) => { const ul = document.createElement('ul'); for (let i = 0; i < n; i++) ul.append(document.createElement('li')); return ul; };
  /** fits if size × item count <= capacity */
  const listMeasurer = (cap: number): Measurer => ({ setSize: domMeasurer.setSize, fits: (el) => size(el) * el.children.length <= cap });
  it('usa el tamaño fijo, sin achicarlo, si entran todos', () => {
    const ul = list(10);
    expect(fitList(ul, 20, listMeasurer(200))).toEqual({ size: 20, removed: 0 });
    expect(ul.children).toHaveLength(10);
  });
  it('con el tamaño fijo saca items del final hasta que entre (deja al menos uno)', () => {
    const ul = list(10);
    expect(fitList(ul, 20, listMeasurer(110))).toEqual({ size: 20, removed: 5 });
    expect(ul.children).toHaveLength(5);
    const one = list(3);
    fitList(one, 20, listMeasurer(1));
    expect(one.children).toHaveLength(1);
  });
});

describe('fitRegions', () => {
  it('ajusta los textos con max en vh y min en px; las listas usan el máximo como tamaño fijo', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-fit="text" data-max="5" data-min="10">' + 'x'.repeat(40) + '</p><ul data-fit="list" data-max="4"><li></li><li></li></ul><span>libre</span>';
    const m: Measurer = { setSize: domMeasurer.setSize, fits: (el) => size(el) * (el.tagName === 'UL' ? el.children.length * 10 : el.textContent!.length) <= 1000 };
    fitRegions(root, m, 1000);
    expect(root.querySelector('p')!.style.fontSize).toBe('25px');
    expect(root.querySelector('ul')!.style.fontSize).toBe('40px');
    expect(root.querySelector('span')!.style.fontSize).toBe('');
  });
});

describe('mensajes recortados', () => {
  const box = (sw: number, cw: number, sh = 0, ch = 0) => {
    const e = document.createElement('div');
    Object.defineProperties(e, { scrollWidth: { value: sw }, clientWidth: { value: cw }, scrollHeight: { value: sh }, clientHeight: { value: ch } });
    return e;
  };
  it('domMeasurer: no entra si alguna línea [data-clip] está recortada', () => {
    const ul = box(100, 100);
    const line = box(300, 200);
    line.setAttribute('data-clip', '');
    ul.append(line);
    expect(domMeasurer.fits(ul)).toBe(false);
    expect(domMeasurer.fitsBox!(ul)).toBe(true);
    const ok = box(100, 100);
    const l2 = box(150, 200);
    l2.setAttribute('data-clip', '');
    ok.append(l2);
    expect(domMeasurer.fits(ok)).toBe(true);
  });
  const ul5 = () => { const ul = document.createElement('ul'); for (let i = 0; i < 5; i++) ul.append(document.createElement('li')); return ul; };
  it('mensajes recortados a lo ancho (con …) no sacan items: solo cuenta que entren a lo alto', () => {
    const m: Measurer = { setSize: domMeasurer.setSize, fitsBox: (el) => size(el) * el.children.length <= 40, fits: () => false };
    const ul = ul5();
    expect(fitList(ul, 8, m)).toEqual({ size: 8, removed: 0 });
    expect(ul.children).toHaveLength(5);
  });
  it('fitRegions respeta además un máximo en vw (data-maxw)', () => {
    const root = document.createElement('div');
    root.innerHTML = '<ul data-fit="list" data-max="4" data-maxw="2"><li></li></ul>';
    fitRegions(root, { setSize: domMeasurer.setSize, fits: () => true }, 1000, 500);
    expect(root.querySelector('ul')!.style.fontSize).toBe('10px');
  });
});

describe('texto y formato', () => {
  it('respeta textos dentro del límite y trunca por palabras', () => {
    expect(truncateText('hola', 10)).toBe('hola');
    expect(truncateText('x'.repeat(10), 10)).toBe('x'.repeat(10));
    expect(truncateText('uno dos tres cuatro', 10)).toBe('uno dos…');
    expect(truncateText('uno dos,   tres cuatro', 12)).toBe('uno dos,…');
    expect(truncateText('uno\ndos tres', 6)).toBe('uno…');
  });
  it('corta palabras demasiado largas sin superar el máximo', () => {
    expect(truncateText('a ' + 'x'.repeat(50), 10)).toBe('a xxxxxxx…');
    expect(truncateText('x'.repeat(20), 10)).toBe('x'.repeat(9) + '…');
  });
  it('no parte emojis compuestos ni pares sustitutos', () => {
    expect(truncateText('👍🏽'.repeat(20), 5)).toBe('👍🏽'.repeat(4) + '…');
    const family = truncateText('👨‍👩‍👧'.repeat(10) + ' fin', 4);
    expect(family).toBe('👨‍👩‍👧'.repeat(3) + '…');
    expect(graphemes(family)).toHaveLength(4);
    const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
    expect(loneSurrogate.test(truncateText('𝔘𝔫𝔦𝔠𝔬𝔡𝔢 '.repeat(30), 33))).toBe(false);
    expect(graphemes('👍🏽'.repeat(3))).toHaveLength(3);
  });
  it('formatea sats enteros y autores abreviados, escapando HTML', () => {
    expect(sats(2_100_999)).toBe((2100).toLocaleString('es-AR'));
    expect(shortKey('abcdefgh12345678wxyz')).toBe('abcdefgh…wxyz');
    expect(shortKey()).toBe('anónimo');
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
  it('muestra tiempo relativo sin valores negativos', () => {
    vi.useFakeTimers(); vi.setSystemTime(1_000_000_000);
    const now = 1_000_000;
    expect(ago(now - 5)).toBe('hace 5s');
    expect(ago(now - 120)).toBe('hace 2 min');
    expect(ago(now - 7200)).toBe('hace 2 h');
    expect(ago(now + 50)).toBe('hace 0s');
  });
  it('convierte entre ISO y datetime-local en UTC-3', () => {
    expect(toArInput('2026-10-13T00:00:00-03:00')).toBe('2026-10-13T00:00');
    expect(toArInput('2026-10-14T00:30:00Z')).toBe('2026-10-13T21:30');
    expect(toArInput('basura')).toBe('');
    expect(fromArInput('2026-10-14T21:30')).toBe('2026-10-14T21:30:00-03:00');
    expect(fromArInput('')).toBeNull();
  });
});

describe('configuración estática', () => {
  it('solo carga opciones del cliente, no ajustes administrables ni opciones retiradas', async () => {
    const remote = { relays: ['wss://example.com'], sceneDurations: { post: 3 }, videoMode: 'clip', videoEveryCycles: 8, videoClipSeconds: 5, announcement: 'old', startLine: 'old', keyboardNav: true, talks: [], noteUriTemplate: 'old' };
    const c = await loadConfig((async () => ({ ok: true, json: async () => remote })) as any);
    expect(c.relays).toEqual(remote.relays);
    for (const key of Object.keys(remote).filter((key) => key !== 'relays')) expect(c).not.toHaveProperty(key);
  });
  it('mezcla opciones estáticas con defaults y permite ajustar largo de posts y ventana reciente', async () => {
    const fetchFn = vi.fn(async () => ({ ok: true, json: async () => ({ hashtags: ['x'], postMaxChars: 140, topRecentHours: 1 }) }));
    const c = await loadConfig(fetchFn as any);
    expect(fetchFn).toHaveBeenCalledWith('/config.json', { cache: 'no-store' });
    expect(c).toMatchObject({ hashtags: ['x'], postMaxChars: 140, topRecentHours: 1, relays: defaultConfig.relays });
    expect(defaultConfig.postMaxChars).toBe(210);
    expect(defaultConfig.topRecentHours).toBe(3);
  });
  it('usa defaults si la respuesta HTTP o la red fallan', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadConfig((async () => ({ ok: false, status: 404 })) as any)).toEqual(defaultConfig);
    expect(await loadConfig((async () => { throw new Error('offline'); }) as any)).toEqual(defaultConfig);
  });
  it('la configuración publicada usa relays wss únicos, incluyendo los receipts de LaWallet/Primal', () => {
    expect(shipped.relays).toContain('wss://relay-nwc.rizful.com');
    expect(new Set(shipped.relays).size).toBe(shipped.relays.length);
    for (const relay of shipped.relays) expect(new URL(relay).protocol).toBe('wss:');
    for (const key of Object.keys(shipped)) expect(Object.hasOwn(defaultConfig, key)).toBe(true);
  });
});
