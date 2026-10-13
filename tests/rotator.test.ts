// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rotator, type Scene } from '../src/rotator';

const mk = (name: string, ready = true, duration = 1000) => {
  const cleanup = vi.fn();
  const s: Scene = { name, duration, ready: () => ready, render: vi.fn((r: HTMLElement) => { r.textContent = name; return cleanup; }) };
  return { s, cleanup };
};
let root: HTMLElement;
beforeEach(() => { vi.useFakeTimers(); root = document.createElement('div'); });
afterEach(() => vi.useRealTimers());

describe('Rotator', () => {
  it('rota en orden respetando duraciones y limpiando la escena anterior', () => {
    const a = mk('a'), b = mk('b', true, 2000);
    new Rotator(root, [a.s, b.s]).start();
    expect(root.textContent).toBe('a');
    expect(root.className).toBe('scene scene-a');
    vi.advanceTimersByTime(999);
    expect(root.textContent).toBe('a');
    vi.advanceTimersByTime(1);
    expect(root.textContent).toBe('b');
    expect(a.cleanup).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(2000);
    expect(root.textContent).toBe('a');
  });
  it('saltea escenas sin datos', () => {
    const a = mk('a'), b = mk('b', false), c = mk('c');
    new Rotator(root, [a.s, b.s, c.s]).start();
    vi.advanceTimersByTime(1000);
    expect(root.textContent).toBe('c');
    vi.advanceTimersByTime(1000);
    expect(root.textContent).toBe('a');
    expect(b.s.render).not.toHaveBeenCalled();
  });
  it('muestra espera si ninguna está lista y reintenta cada 3s', () => {
    let ready = false;
    const s: Scene = { name: 'x', duration: 1000, ready: () => ready, render: vi.fn((r: HTMLElement) => { r.textContent = 'x'; }) };
    new Rotator(root, [s]).start();
    expect(root.querySelector('.empty')?.textContent).toContain('Esperando');
    ready = true;
    vi.advanceTimersByTime(2999);
    expect(s.render).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(root.textContent).toBe('x');
  });
  it('escena sin ready() siempre se muestra; stop limpia y frena', () => {
    const cleanup = vi.fn();
    const s: Scene = { name: 'y', duration: 1000, render: vi.fn(() => cleanup) };
    const r = new Rotator(root, [s]);
    r.start();
    r.stop();
    expect(cleanup).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(s.render).toHaveBeenCalledOnce();
  });
});

describe('navegación manual', () => {
  it('next() avanza ya, limpia la escena y reinicia el timer', () => {
    const a = mk('a'), b = mk('b'), c = mk('c');
    const r = new Rotator(root, [a.s, b.s, c.s]);
    r.start();
    vi.advanceTimersByTime(600);
    r.next();
    expect(root.textContent).toBe('b');
    expect(a.cleanup).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(600);
    expect(root.textContent).toBe('b');
    vi.advanceTimersByTime(400);
    expect(root.textContent).toBe('c');
  });
  it('prev() retrocede saltando escenas sin datos, da la vuelta y reinicia el timer', () => {
    const a = mk('a'), b = mk('b', false), c = mk('c');
    const r = new Rotator(root, [a.s, b.s, c.s]);
    r.start();
    r.prev();
    expect(root.textContent).toBe('c');
    expect(a.cleanup).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(500);
    r.prev();
    expect(root.textContent).toBe('a');
    expect(c.cleanup).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(999);
    expect(root.textContent).toBe('a');
    vi.advanceTimersByTime(1);
    expect(root.textContent).toBe('c');
    expect(b.s.render).not.toHaveBeenCalled();
  });
  it('prev() sin escenas listas muestra la espera', () => {
    const r = new Rotator(root, [mk('x', false).s]);
    r.start();
    r.prev();
    expect(root.querySelector('.empty')).not.toBeNull();
  });
});
