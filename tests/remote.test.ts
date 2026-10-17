import { describe, expect, it, vi } from 'vitest';
import { createRemote } from '../src/remote';
import { Announcement } from '../src/announcement';

const setup = (responses: unknown[]) => {
  const fetchFn = vi.fn(async () => {
    const r = responses.shift();
    if (r instanceof Error) throw r;
    if (r === 'bad') return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => r };
  });
  const announcement = new Announcement('de config');
  const remote = createRemote({ fetchFn: fetchFn as unknown as typeof fetch, announcement });
  return { fetchFn, announcement, remote };
};

describe('createRemote (polling de /api/settings)', () => {
  it('pide /api/settings sin caché y aplica anuncio', async () => {
    const { fetchFn, announcement, remote } = setup([{ announcement: 'Hola' }]);
    await remote.poll();
    expect(fetchFn).toHaveBeenCalledWith('/api/settings', { cache: 'no-store' });
    expect(announcement.text).toBe('Hola');
  });
  it('anuncio vacío en el server = sin anuncio', async () => {
    const { announcement, remote } = setup([{ announcement: '' }]);
    await remote.poll();
    expect(announcement.text).toBe('');
  });
  it('errores de red, HTTP o JSON raro no rompen ni cambian nada', async () => {
    const { announcement, remote } = setup([new Error('offline'), 'bad', { command: 'x' }, null]);
    for (let i = 0; i < 4; i++) await expect(remote.poll()).resolves.toBeUndefined();
    expect(announcement.text).toBe('de config');
  });
  it('start/stop hace polling periódico', async () => {
    vi.useFakeTimers();
    try {
      const { fetchFn, remote } = setup([{}, {}, {}]);
      const stop = remote.start(1000);
      await vi.advanceTimersByTimeAsync(2100);
      expect(fetchFn).toHaveBeenCalledTimes(3);
      stop();
      await vi.advanceTimersByTimeAsync(5000);
      expect(fetchFn).toHaveBeenCalledTimes(3);
    } finally { vi.useRealTimers(); }
  });
});
