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

describe('navegación por escenas distintas (bloques con el mismo nombre)', () => {
  const sc = (name: string, label: string) => ({ name, duration: 1000, render: vi.fn((r: HTMLElement) => { r.textContent = label; }) }) as Scene;
  const rotation = () => [sc('post', 'p1'), sc('post', 'p2'), sc('post', 'p3'), sc('latestZaps', 'z'), sc('top', 't')];
  it('→ salta al siguiente nombre distinto desde cualquier post del bloque', () => {
    const r = new Rotator(root, rotation());
    r.start();
    r.next();
    expect(root.textContent).toBe('z');
    const r2 = new Rotator(root, rotation());
    r2.start();
    vi.advanceTimersByTime(1000);
    expect(root.textContent).toBe('p2');
    r2.next();
    expect(root.textContent).toBe('z');
  });
  it('← va al inicio del bloque anterior y da la vuelta', () => {
    const r = new Rotator(root, rotation());
    r.start();
    r.next();
    r.prev();
    expect(root.textContent).toBe('p1');
    vi.advanceTimersByTime(1000);
    expect(root.textContent).toBe('p2');
    r.prev();
    expect(root.textContent).toBe('t');
    r.next();
    expect(root.textContent).toBe('p1');
  });
  it('la rotación automática sigue mostrando cada post del bloque', () => {
    new Rotator(root, rotation()).start();
    const seen = [root.textContent];
    for (let i = 0; i < 5; i++) { vi.advanceTimersByTime(1000); seen.push(root.textContent); }
    expect(seen).toEqual(['p1', 'p2', 'p3', 'z', 't', 'p1']);
  });
  it('si todas las escenas se llaman igual, → y ← avanzan de a una', () => {
    const r = new Rotator(root, [sc('post', 'a'), sc('post', 'b')]);
    r.start();
    r.next();
    expect(root.textContent).toBe('b');
    r.prev();
    expect(root.textContent).toBe('a');
  });
});

describe('Rotator.setDuration (cambio remoto de tiempos)', () => {
  it('cambia la duración desde la próxima vez que se muestra la escena', () => {
    const a = mk('a'), b = mk('b');
    const r = new Rotator(root, [a.s, b.s]);
    r.start();
    r.setDuration('a', 5000);
    vi.advanceTimersByTime(1000);
    expect(root.textContent).toBe('b');
    vi.advanceTimersByTime(1000);
    expect(root.textContent).toBe('a');
    vi.advanceTimersByTime(4999);
    expect(root.textContent).toBe('a');
    vi.advanceTimersByTime(1);
    expect(root.textContent).toBe('b');
  });
});

describe('Rotator: escenas que terminan solas (untilDone)', () => {
  const selfTimed = () => {
    let done: (() => void) | undefined;
    const cleanup = vi.fn();
    const s: Scene = { name: 'v', duration: 1000, untilDone: true, render: vi.fn((r: HTMLElement, d?: () => void) => { r.textContent = 'v'; done = d; return cleanup; }) };
    return { s, cleanup, done: () => done?.() };
  };
  it('no avanza por tiempo; avanza cuando la escena llama done', () => {
    const a = mk('a'), v = selfTimed();
    new Rotator(root, [v.s, a.s]).start();
    vi.advanceTimersByTime(10 * 60_000);
    expect(root.textContent).toBe('v');
    v.done();
    expect(root.textContent).toBe('a');
    expect(v.cleanup).toHaveBeenCalledOnce();
  });
  it('las flechas la saltean igual y un done viejo no hace nada', () => {
    const a = mk('a'), b = mk('b'), v = selfTimed();
    const r = new Rotator(root, [v.s, a.s, b.s]);
    r.start();
    const staleDone = v.done;
    r.next();
    expect(root.textContent).toBe('a');
    staleDone();
    expect(root.textContent).toBe('a');
  });
});

describe('Rotator: escenas cada N vueltas (everyCycles)', () => {
  it('la rotación automática muestra la escena en la 1ª vuelta, la saltea en la 2ª y vuelve en la 3ª (N=2)', () => {
    const a = mk('a'), b = mk('b'), v = mk('v', 1000, { everyCycles: 2 });
    new Rotator(root, [a.s, b.s, v.s]).start();
    const seen: string[] = [root.textContent!];
    for (let i = 0; i < 8; i++) { vi.advanceTimersByTime(1000); seen.push(root.textContent!); }
    expect(seen).toEqual(['a', 'b', 'v', 'a', 'b', 'a', 'b', 'v', 'a']);
  });
  it('con las flechas se puede llegar igual', () => {
    const a = mk('a'), b = mk('b'), v = mk('v', 1000, { everyCycles: 2 });
    const r = new Rotator(root, [a.s, b.s, v.s]);
    r.start();
    vi.advanceTimersByTime(3000); // a b v a  → 2ª vuelta
    expect(root.textContent).toBe('a');
    r.prev();
    expect(root.textContent).toBe('v');
    r.next();
    r.next();
    expect(root.textContent).toBe('b');
    r.next();
    expect(root.textContent).toBe('v');
  });
  it('setEveryCycles cambia N en caliente (N=1 = todas las vueltas)', () => {
    const a = mk('a'), v = mk('v', 1000, { everyCycles: 2 });
    const r = new Rotator(root, [a.s, v.s]);
    r.setEveryCycles('v', 1);
    r.start();
    const seen: string[] = [root.textContent!];
    for (let i = 0; i < 4; i++) { vi.advanceTimersByTime(1000); seen.push(root.textContent!); }
    expect(seen).toEqual(['a', 'v', 'a', 'v', 'a']);
  });
});
