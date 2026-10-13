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
