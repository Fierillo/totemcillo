import { describe, expect, it, vi } from 'vitest';
import { createRemote } from '../src/remote';
import { Announcement } from '../src/announcement';

const settings = (seq: number, action: string | null, extra: object = {}) => ({ announcement: '', sceneDurations: {}, command: { seq, action }, ...extra });
const setup = (responses: unknown[]) => {
  const fetchFn = vi.fn(async () => {
    const r = responses.shift();
    if (r instanceof Error) throw r;
    if (r === 'bad') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => r };
  });
  const nav = { next: vi.fn(), prev: vi.fn(), setDuration: vi.fn(), setEveryCycles: vi.fn(), setVideoMode: vi.fn(), setClipSeconds: vi.fn() };
  const announcement = new Announcement('de config');
  const remote = createRemote({ fetchFn: fetchFn as unknown as typeof fetch, nav, announcement, baseDurations: { post: 15000, latestZaps: 12000 }, baseVideoEveryCycles: 2, baseVideoMode: 'full', baseVideoClipSeconds: 21 });
  return { fetchFn, nav, announcement, remote };
};

describe('createRemote (polling de /api/settings)', () => {
  it('pide /api/settings sin caché', async () => {
    const { fetchFn, remote } = setup([settings(0, null)]);
    await remote.poll();
    expect(fetchFn).toHaveBeenCalledWith('/api/settings', { cache: 'no-store' });
  });
  it('el primer poll aplica anuncio y duraciones pero no ejecuta comandos viejos', async () => {
    const { nav, announcement, remote } = setup([settings(7, 'next', { announcement: 'Hola', sceneDurations: { post: 20000 } })]);
    await remote.poll();
    expect(nav.next).not.toHaveBeenCalled();
    expect(announcement.text).toBe('Hola');
    expect(nav.setDuration).toHaveBeenCalledWith('post', 20000);
  });
  it('ejecuta cada comando nuevo una sola vez', async () => {
    const { nav, remote } = setup([settings(1, 'next'), settings(2, 'next'), settings(2, 'next'), settings(3, 'prev')]);
    for (let i = 0; i < 4; i++) await remote.poll();
    expect(nav.next).toHaveBeenCalledOnce();
    expect(nav.prev).toHaveBeenCalledOnce();
  });
  it('si el admin borra una duración vuelve a la de config; ignora valores fuera de rango', async () => {
    const { nav, remote } = setup([settings(0, null, { sceneDurations: { post: 20000, latestZaps: 999999 } }), settings(0, null)]);
    await remote.poll();
    expect(nav.setDuration).not.toHaveBeenCalledWith('latestZaps', 999999);
    nav.setDuration.mockClear();
    await remote.poll();
    expect(nav.setDuration).toHaveBeenCalledWith('post', 15000);
  });
  it('aplica videoEveryCycles del admin (1–10); sin valor o inválido vuelve al de config', async () => {
    const { nav, remote } = setup([settings(0, null, { videoEveryCycles: 4 }), settings(0, null, { videoEveryCycles: 99 }), settings(0, null)]);
    await remote.poll();
    expect(nav.setEveryCycles).toHaveBeenLastCalledWith('video', 4);
    await remote.poll();
    expect(nav.setEveryCycles).toHaveBeenLastCalledWith('video', 2);
    nav.setEveryCycles.mockClear();
    await remote.poll();
    expect(nav.setEveryCycles).not.toHaveBeenCalled();
  });
  it('aplica videoMode del admin; sin valor o inválido vuelve al de config', async () => {
    const { nav, remote } = setup([settings(0, null, { videoMode: 'clip' }), settings(0, null, { videoMode: 'x' }), settings(0, null)]);
    await remote.poll();
    expect(nav.setVideoMode).toHaveBeenLastCalledWith('video', 'clip');
    await remote.poll();
    expect(nav.setVideoMode).toHaveBeenLastCalledWith('video', 'full');
    nav.setVideoMode.mockClear();
    await remote.poll();
    expect(nav.setVideoMode).not.toHaveBeenCalled();
  });
  it('aplica videoClipSeconds del admin (3–120); inválido o ausente vuelve al de config', async () => {
    const { nav, remote } = setup([settings(0, null, { videoClipSeconds: 30 }), settings(0, null, { videoClipSeconds: 999 })]);
    await remote.poll();
    expect(nav.setClipSeconds).toHaveBeenLastCalledWith('video', 30);
    await remote.poll();
    expect(nav.setClipSeconds).toHaveBeenLastCalledWith('video', 21);
  });
  it('anuncio vacío en el server = sin anuncio', async () => {
    const { announcement, remote } = setup([settings(0, null, { announcement: '' })]);
    await remote.poll();
    expect(announcement.text).toBe('');
  });
  it('errores de red, HTTP o JSON raro no rompen ni cambian nada', async () => {
    const { nav, announcement, remote } = setup([new Error('offline'), 'bad', { command: 'x' }, null]);
    for (let i = 0; i < 4; i++) await expect(remote.poll()).resolves.toBeUndefined();
    expect(announcement.text).toBe('de config');
    expect(nav.next).not.toHaveBeenCalled();
  });
  it('start/stop hace polling periódico', async () => {
    vi.useFakeTimers();
    const { fetchFn, remote } = setup([settings(0, null), settings(0, null), settings(0, null)]);
    const stop = remote.start(1000);
    await vi.advanceTimersByTimeAsync(2100);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(fetchFn).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
