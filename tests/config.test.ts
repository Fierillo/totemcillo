import { describe, expect, it, vi } from 'vitest';
import { defaultConfig, loadConfig } from '../src/config';

describe('loadConfig', () => {
  it('mergea config.json sobre defaults', async () => {
    const f = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ hashtags: ['x'] }) }));
    const c = await loadConfig(f as any);
    expect(f).toHaveBeenCalledWith('/config.json', { cache: 'no-store' });
    expect(c.hashtags).toEqual(['x']);
    expect(c.relays).toEqual(defaultConfig.relays);
  });
  it('usa defaults si la respuesta no es ok o fetch falla', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(await loadConfig((async () => ({ ok: false, status: 404 })) as any)).toEqual(defaultConfig);
    expect(await loadConfig((async () => { throw new Error('offline'); }) as any)).toEqual(defaultConfig);
  });
  it('defaults sensatos', () => {
    expect(defaultConfig.hashtags).toEqual(['lacrypta', 'labitconf']);
    expect(defaultConfig.relays).toHaveLength(3);
  });
});
