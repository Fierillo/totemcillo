import { describe, expect, it } from 'vitest';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';

describe('buildScenes', () => {
  it('post + últimos zaps + tops + anuncio (siempre, con estado vacío), con duraciones de config', () => {
    const s = buildScenes({ ...defaultConfig, sceneDurations: { post: 7, latestZaps: 9, anuncio: 5 } }, new ZapStore());
    expect(s.map((x) => [x.name, x.duration])).toEqual([['post', 7], ['latestZaps', 9], ['top10Historico', 21000], ['top10Ultimas3h', 21000], ['anuncio', 5], ['video', 0]]);
  });
  it('usa duraciones por defecto si faltan', () => {
    const s = buildScenes({ ...defaultConfig, sceneDurations: {} }, new ZapStore());
    expect(s.map((x) => x.duration)).toEqual([21000, 21000, 21000, 21000, 21000, 0]);
  });
  it('public/config.json: todas las escenas duran 21 s por defecto (el video no tiene duración)', async () => {
    const { readFileSync } = await import('node:fs');
    const json = JSON.parse(readFileSync(new URL('../public/config.json', import.meta.url), 'utf8'));
    expect(json.sceneDurations).toEqual({ post: 21000, latestZaps: 21000, top10Historico: 21000, top10Ultimas3h: 21000, anuncio: 21000 });
  });
  it('config: publicUrl vacío (= origin) y polling de settings cada 4 s', () => {
    expect(defaultConfig.publicUrl).toBe('');
    expect(defaultConfig.settingsPollMs).toBe(4000);
  });
});
