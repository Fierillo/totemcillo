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

describe('noteUriTemplate', () => {
  it('por defecto nostr:{nevent} y se puede sobreescribir', async () => {
    expect(defaultConfig.noteUriTemplate).toBe('nostr:{nevent}');
    const f = async () => ({ ok: true, json: async () => ({ noteUriTemplate: 'https://njump.me/{nevent}' }) });
    expect((await loadConfig(f as any)).noteUriTemplate).toBe('https://njump.me/{nevent}');
  });
});

describe('postMaxChars', () => {
  it('por defecto 210 y se puede sobreescribir', async () => {
    expect(defaultConfig.postMaxChars).toBe(210);
    const f = async () => ({ ok: true, json: async () => ({ postMaxChars: 140 }) });
    expect((await loadConfig(f as any)).postMaxChars).toBe(140);
  });
});

describe('postMaxAgeHours', () => {
  it('por defecto 24 y se puede sobreescribir', async () => {
    expect(defaultConfig.postMaxAgeHours).toBe(24);
    const f = async () => ({ ok: true, json: async () => ({ postMaxAgeHours: 6 }) });
    expect((await loadConfig(f as any)).postMaxAgeHours).toBe(6);
  });
});

describe('keyboardNav', () => {
  it('por defecto true y se puede desactivar', async () => {
    expect(defaultConfig.keyboardNav).toBe(true);
    const f = async () => ({ ok: true, json: async () => ({ keyboardNav: false }) });
    expect((await loadConfig(f as any)).keyboardNav).toBe(false);
  });
});

import shipped from '../public/config.json';
describe('config.json publicada', () => {
  it('incluye el relay donde LaWallet publica los receipts de zaps hechos desde Primal', () => {
    expect(shipped.relays).toContain('wss://relay-nwc.rizful.com');
  });
});
