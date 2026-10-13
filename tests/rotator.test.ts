// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Rotator, type Scene } from '../src/rotator';

const mk = (name: string, duration = 1000, extra: object = {}) => {
  const cleanup = vi.fn();
  const s = { name, duration, render: vi.fn((r: HTMLElement) => { r.textContent = name; return cleanup; }), ...extra } as Scene;
  return { s, cleanup };
};
let root: HTMLElement;
beforeEach(() => { vi.useFakeTimers(); root = document.createElement('div'); });
afterEach(() => vi.useRealTimers());

describe('Rotator', () => {
  it('rota en orden respetando duraciones y limpiando la escena anterior', () => {
    const a = mk('a'), b = mk('b', 2000);
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
  it('no saltea escenas aunque no tengan datos (sin mensaje global de espera)', () => {
    const a = mk('a'), b = mk('b', 1000, { ready: () => false }), c = mk('c');
    new Rotator(root, [a.s, b.s, c.s]).start();
    vi.advanceTimersByTime(1000);
    expect(root.textContent).toBe('b');
    vi.advanceTimersByTime(1000);
    expect(root.textContent).toBe('c');
    expect(root.querySelector('.empty')).toBeNull();
  });
  it('stop limpia y frena', () => {
    const a = mk('a');
    const r = new Rotator(root, [a.s]);
    r.start();
    r.stop();
    expect(a.cleanup).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(5000);
    expect(a.s.render).toHaveBeenCalledOnce();
  });
  it('sin escenas no hace nada', () => {
    expect(() => new Rotator(root, []).start()).not.toThrow();
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
  it('prev() retrocede por todas las escenas (incluso sin datos), da la vuelta y reinicia el timer', () => {
    const a = mk('a'), b = mk('b', 1000, { ready: () => false }), c = mk('c');
    const r = new Rotator(root, [a.s, b.s, c.s]);
    r.start();
    r.prev();
    expect(root.textContent).toBe('c');
    vi.advanceTimersByTime(500);
    r.prev();
    expect(root.textContent).toBe('b');
    expect(c.cleanup).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(999);
    expect(root.textContent).toBe('b');
    vi.advanceTimersByTime(1);
    expect(root.textContent).toBe('c');
  });
});
