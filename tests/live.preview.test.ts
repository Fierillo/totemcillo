import { describe, expect, it, vi } from 'vitest';
import { createStateReporter, createPreviewFollower } from '../src/live-state';

const ok = (body: unknown) => ({ ok: true, json: async () => body });

describe('createStateReporter (tótem → /api/state)', () => {
  it('manda la escena actual por POST JSON', async () => {
    const fetchFn = vi.fn(async () => ok({}));
    const r = createStateReporter({ fetchFn: fetchFn as unknown as typeof fetch, current: () => ({ scene: 'video', index: 5, videoTime: 3.2 }) });
    await r.report();
    expect(fetchFn).toHaveBeenCalledWith('/api/state', expect.objectContaining({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ scene: 'video', index: 5, videoTime: 3.2 }) }));
  });
  it('errores de red no rompen', async () => {
    const r = createStateReporter({ fetchFn: (async () => { throw new Error('x'); }) as unknown as typeof fetch, current: () => ({ scene: 'post', index: 0, videoTime: null }) });
    await expect(r.report()).resolves.toBeUndefined();
  });
});

describe('createPreviewFollower (miniatura del admin)', () => {
  const setup = (states: unknown[], cur = { index: 0, videoTime: null as number | null }) => {
    const fetchFn = vi.fn(async () => { const s = states.shift(); if (s instanceof Error) throw s; return ok(s); });
    const view = { showIndex: vi.fn((i: number) => { cur.index = i; }), current: () => cur, seekVideo: vi.fn() };
    return { view, f: createPreviewFollower({ fetchFn: fetchFn as unknown as typeof fetch, view }), fetchFn };
  };
  it('pide /api/state sin caché y muestra la escena reportada si cambió', async () => {
    const { view, f, fetchFn } = setup([{ scene: 'top10Historico', index: 2, videoTime: null }, { scene: 'top10Historico', index: 2, videoTime: null }]);
    await f.poll();
    await f.poll();
    expect(fetchFn).toHaveBeenCalledWith('/api/state', { cache: 'no-store' });
    expect(view.showIndex).toHaveBeenCalledOnce();
    expect(view.showIndex).toHaveBeenCalledWith(2);
  });
  it('en el video sigue el tiempo si se desfasa más de 2 s', async () => {
    const { view, f } = setup([{ scene: 'video', index: 5, videoTime: 30 }, { scene: 'video', index: 5, videoTime: 31 }], { index: 5, videoTime: 29.5 });
    await f.poll();
    expect(view.seekVideo).not.toHaveBeenCalled();
    view.current().videoTime = 10;
    await f.poll();
    expect(view.seekVideo).toHaveBeenCalledWith(31);
  });
  it('sin estado, estado raro o error: no hace nada', async () => {
    const { view, f } = setup([{ scene: null, index: null }, { index: 'x' }, new Error('off'), null]);
    for (let i = 0; i < 4; i++) await expect(f.poll()).resolves.toBeUndefined();
    expect(view.showIndex).not.toHaveBeenCalled();
  });
});
