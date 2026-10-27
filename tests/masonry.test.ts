import { describe, it, expect } from 'vitest';
import { masonry } from '../src/masonry';

const GAP = 10;
const boxes = (heights: number[], limits: number[]) => masonry(heights, limits, GAP).map((p, i) => p && ({ ...p, bottom: p.top + heights[i] })).filter((p) => p !== null);

describe('masonry: cajas del alto de su contenido, apiladas por columna', () => {
  it('cada caja va a la columna más baja: una caja corta no deja hueco debajo (la siguiente arranca a un gap)', () => {
    const b = boxes([30, 100, 40, 20], [1000, 1000]);
    expect(b.map(({ col, top }) => [col, top])).toEqual([[0, 0], [1, 0], [0, 40], [0, 90]]);
  });
  it('orden de lectura: cada caja empieza a la misma altura o más abajo que la anterior; a igual altura, más a la derecha', () => {
    const h = [50, 20, 80, 10, 35, 60, 15, 45, 70, 25];
    const b = boxes(h, [400, 400, 400]);
    for (let i = 1; i < b.length; i++) expect(b[i].top > b[i - 1].top || (b[i].top === b[i - 1].top && b[i].col > b[i - 1].col)).toBe(true);
  });
  it('sin solapes: dentro de una columna, cada caja empieza al menos un gap debajo de la anterior', () => {
    const h = [50, 20, 80, 10, 35, 60, 15, 45];
    const b = boxes(h, [300, 300, 300]);
    [0, 1, 2].forEach((c) => {
      const col = b.filter((x) => x.col === c);
      for (let i = 1; i < col.length; i++) expect(col[i].top).toBeGreaterThanOrEqual(col[i - 1].bottom + GAP);
    });
  });
  it('ninguna caja pasa el límite de su columna (las columnas bajo el QR terminan antes)', () => {
    const limits = [300, 300, 120];
    const b = boxes([50, 50, 50, 50, 50, 50, 50, 50, 50, 50], limits);
    b.forEach((x) => expect(x.bottom).toBeLessThanOrEqual(limits[x.col]));
    expect(b.filter((x) => x.col === 2)).toHaveLength(2);
  });
  it('una columna que se llenó no recibe después una caja más chica (no rompe el orden de lectura)', () => {
    const b = boxes([100, 90, 100, 10], [500, 150]);
    expect(b.map((x) => x.col)).toEqual([0, 1, 0, 0]);
  });
  it('una caja que no entra en ninguna columna queda afuera (null) y las siguientes siguen llenando', () => {
    expect(masonry([100, 300, 40], [150, 150], GAP)).toEqual([{ col: 0, top: 0 }, null, { col: 1, top: 0 }]);
  });
  it('una caja que queda afuera no cierra columnas: el hueco lo llena la siguiente que entra (caso 1024x434)', () => {
    // three open columns plus a short one under the QR: a tall box fits nowhere, the next short ones still go in
    expect(masonry([166, 70, 95, 166, 70, 94], [245, 245, 245, 91], GAP)).toEqual([
      { col: 0, top: 0 }, { col: 1, top: 0 }, { col: 2, top: 0 }, null, { col: 3, top: 0 }, { col: 1, top: 80 }]);
  });
});
