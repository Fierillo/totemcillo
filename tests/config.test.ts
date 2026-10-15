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


describe('postMaxChars', () => {
  it('por defecto 210 y se puede sobreescribir', async () => {
    expect(defaultConfig.postMaxChars).toBe(210);
    const f = async () => ({ ok: true, json: async () => ({ postMaxChars: 140 }) });
    expect((await loadConfig(f as any)).postMaxChars).toBe(140);
  });
});



import shipped from '../public/config.json';
describe('config.json publicada', () => {
  it('incluye el relay donde LaWallet publica los receipts de zaps hechos desde Primal', () => {
    expect(shipped.relays).toContain('wss://relay-nwc.rizful.com');
  });
});

describe('cobertura de relays', () => {
  it('trae entre 25 y 35 relays wss únicos', () => {
    const r = shipped.relays;
    expect(r.length).toBeGreaterThanOrEqual(25);
    expect(r.length).toBeLessThanOrEqual(35);
    expect(new Set(r).size).toBe(r.length);
    for (const u of r) expect(u).toMatch(/^wss:\/\/[a-z0-9.-]+\/?$/);
  });
  it('quita los relays caídos', () => {
    for (const dead of ['wss://relay.snort.social', 'wss://yabu.me']) expect(shipped.relays).not.toContain(dead);
  });
});

it('solo carga opciones del cliente, no ajustes administrables ni opciones retiradas', async () => {
    const remote = { relays: ['wss://example.com'], sceneDurations: { post: 3 }, videoMode: 'clip', videoEveryCycles: 8, videoClipSeconds: 5, announcement: 'old', startLine: 'old', keyboardNav: true, talks: [], noteUriTemplate: 'old' };
    const c = await loadConfig((async () => ({ ok: true, json: async () => remote })) as any);
    expect(c.relays).toEqual(remote.relays);
    for (const key of Object.keys(remote).filter((key) => key !== 'relays')) expect(c).not.toHaveProperty(key);
  });
