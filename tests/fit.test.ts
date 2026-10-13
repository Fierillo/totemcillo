// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { domMeasurer, fitList, fitRegions, fitText, type Measurer } from '../src/fit';

const size = (el: HTMLElement) => parseFloat(el.style.fontSize);
/** Medidor falso: "entra" si tamaño × largo del texto <= capacidad. */
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
  /** entra si tamaño × cantidad de items <= capacidad */
  const listMeasurer = (cap: number): Measurer => ({ setSize: domMeasurer.setSize, fits: (el) => size(el) * el.children.length <= cap });
  it('achica la fuente de la lista hasta que entren todos', () => {
    const ul = list(10);
    expect(fitList(ul, { max: 40, min: 10 }, listMeasurer(200))).toEqual({ size: 20, removed: 0 });
    expect(ul.children).toHaveLength(10);
  });
  it('en el mínimo saca items del final hasta que entre (deja al menos uno)', () => {
    const ul = list(10);
    expect(fitList(ul, { max: 40, min: 10 }, listMeasurer(55))).toEqual({ size: 10, removed: 5 });
    expect(ul.children).toHaveLength(5);
    const one = list(3);
    fitList(one, { max: 40, min: 10 }, listMeasurer(1));
    expect(one.children).toHaveLength(1);
  });
});

describe('fitRegions', () => {
  it('ajusta los [data-fit] con max en vh y min en px', () => {
    const root = document.createElement('div');
    root.innerHTML = '<p data-fit="text" data-max="5" data-min="10">' + 'x'.repeat(40) + '</p><ul data-fit="list" data-max="4" data-min="8"><li></li><li></li></ul><span>libre</span>';
    const m: Measurer = { setSize: domMeasurer.setSize, fits: (el) => size(el) * (el.tagName === 'UL' ? el.children.length * 10 : el.textContent!.length) <= 1000 };
    fitRegions(root, m, 1000);
    expect(root.querySelector('p')!.style.fontSize).toBe('25px');
    expect(root.querySelector('ul')!.style.fontSize).toBe('40px');
    expect(root.querySelector('span')!.style.fontSize).toBe('');
  });
});
