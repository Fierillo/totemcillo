// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GAIN_MS, LEADER_MS, strike, STRIKE_MS } from '../src/strike';

/** Row on screen: happy-dom has no layout, so the bounding rect is stubbed (the layout engine is the boundary). */
const row = (rect = { left: 100, top: 500, width: 200, height: 50 }) => {
  const el = document.body.appendChild(document.createElement('li'));
  el.getBoundingClientRect = () => ({ ...rect, right: rect.left + rect.width, bottom: rect.top + rect.height, x: rect.left, y: rect.top }) as DOMRect;
  return el;
};
/** Endless pseudo-random sequence from a seed (different seeds, different bolts). */
const seq = (seed: number) => () => (seed = (seed * 16807) % 2147483647) / 2147483647;
const points = (d: string) => d.split('M').filter(Boolean)[0].trim().split(/\s*L\s*/).map((p) => p.split(',').map(Number));
const mainPath = (svg: Element) => svg.querySelector('path.core')!.getAttribute('d')!;

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('rayo real sobre el post zapeado', () => {
  it('cae como un trazo quebrado desde arriba de la pantalla hasta el borde superior del post', () => {
    const svg = strike(row(), () => 0.5)!;
    expect(svg.isConnected).toBe(true);
    expect(svg.classList.contains('strike')).toBe(true);
    const pts = points(mainPath(svg));
    expect(pts[0][1]).toBe(0); // starts at the top of the viewport
    expect(pts.at(-1)).toEqual([200, 500]); // lands on the post's top edge
    expect(pts.length).toBeGreaterThan(8); // jagged, not a straight line
    expect(svg.querySelector('path.branch')!.getAttribute('d')).toMatch(/^M/); // at least one short branch
  });

  it('en el celu (center): cae en el centro del box del mensaje, vertical y horizontal', () => {
    const svg = strike(row(), seq(7), STRIKE_MS, '+21 sats', true)!;
    expect(points(mainPath(svg)).at(-1)).toEqual([200, 525]);
    expect([svg.querySelector('circle.impact')!.getAttribute('cx'), svg.querySelector('circle.impact')!.getAttribute('cy')]).toEqual(['200', '525']);
    expect(document.querySelector<HTMLElement>('.strike-gain')!.style.top).toBe('525px');
  });

  it('el SVG mide lo mismo que su viewBox, en el viewport de layout (no innerWidth/innerHeight, que cambian con el zoom del celu)', () => {
    const de = document.documentElement;
    const cw = vi.spyOn(de, 'clientWidth', 'get').mockReturnValue(390), ch = vi.spyOn(de, 'clientHeight', 'get').mockReturnValue(844);
    try {
      const svg = strike(row(), () => 0.5, STRIKE_MS, undefined, true)!;
      expect(svg.getAttribute('viewBox')).toBe('0 0 390 844');
      expect([svg.style.width, svg.style.height]).toEqual(['390px', '844px']); // 1 unit = 1 CSS px, like the "+N sats" label
    } finally { cw.mockRestore(); ch.mockRestore(); }
  });

  it('cada rayo es distinto: otra secuencia al azar da otro trazo (en producción usa Math.random)', () => {
    const target = row();
    const a = mainPath(strike(target, seq(1))!);
    const b = mainPath(strike(target, seq(2))!);
    expect(a).not.toBe(b);
    expect(mainPath(strike(target, seq(1))!)).toBe(a); // only the random sequence decides the shape
  });

  it('surge de arriba hacia abajo: el líder se dibuja, cada rama nace al llegar a su bifurcación y el impacto cae en el post', () => {
    const svg = strike(row(), seq(3))!;
    const main = points(mainPath(svg));
    expect(svg.style.getPropertyValue('--leader')).toBe(`${LEADER_MS}ms`);
    for (const p of svg.querySelectorAll('path')) expect(p.getAttribute('pathLength')).toBe('1'); // dash animation in path units
    const branches = [...svg.querySelectorAll<SVGPathElement>('path.branch')];
    expect(branches.length).toBeGreaterThan(0);
    for (const b of branches) {
      const fork = main.findIndex(([x, y]) => `${x},${y}` === points(b.getAttribute('d')!)[0].join());
      expect(fork).toBeGreaterThan(0);
      expect(b.style.animationDelay).toBe(`${Math.round((LEADER_MS * fork) / (main.length - 1))}ms`);
    }
    const hit = svg.querySelector('circle.impact')!;
    expect([hit.getAttribute('cx'), hit.getAttribute('cy')]).toEqual(main.at(-1)!.map(String));
  });

  it('es breve: desaparece solo enseguida', () => {
    vi.useFakeTimers();
    strike(row());
    expect(document.querySelectorAll('svg.strike')).toHaveLength(1);
    vi.advanceTimersByTime(STRIKE_MS);
    expect(document.querySelector('svg.strike')).toBeNull();
    expect(STRIKE_MS).toBeGreaterThan(LEADER_MS);
  });

  it('con monto: "+N sats" nace en el punto de impacto y dura un poco más que el rayo', () => {
    vi.useFakeTimers();
    strike(row(), () => 0.5, STRIKE_MS, '+21 sats');
    const gain = document.querySelector<HTMLElement>('.strike-gain')!;
    expect(gain.textContent).toBe('+21 sats');
    expect([gain.style.left, gain.style.top]).toEqual(['200px', '500px']); // impact point
    expect(gain.style.animationDelay).toBe(`${LEADER_MS}ms`); // shows up when the leader lands
    vi.advanceTimersByTime(STRIKE_MS);
    expect(gain.isConnected).toBe(true);
    vi.advanceTimersByTime(GAIN_MS - STRIKE_MS);
    expect(document.querySelector('.strike-gain')).toBeNull();
    strike(row());
    expect(document.querySelector('.strike-gain')).toBeNull(); // no amount, no label
  });

  it('no cae sobre un post oculto (pestaña inactiva del móvil)', () => {
    const tab = document.body.appendChild(document.createElement('section'));
    tab.hidden = true;
    const el = tab.appendChild(row());
    expect(strike(el)).toBeNull();
    expect(document.querySelector('svg.strike')).toBeNull();
  });
});
