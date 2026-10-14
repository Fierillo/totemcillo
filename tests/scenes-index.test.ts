import { describe, expect, it } from 'vitest';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';

describe('buildScenes', () => {
  it('post + últimos zaps + tops + anuncio (siempre, con estado vacío), con duraciones de config', () => {
    const s = buildScenes({ ...defaultConfig, sceneDurations: { post: 7, latestZaps: 9, anuncio: 5 } }, new ZapStore());
    expect(s.map((x) => [x.name, x.duration])).toEqual([['post', 7], ['latestZaps', 9], ['top10Historico', 12000], ['top10Ultimas3h', 12000], ['anuncio', 5]]);
  });
  it('usa duraciones por defecto si faltan', () => {
    const s = buildScenes({ ...defaultConfig, sceneDurations: {} }, new ZapStore());
    expect(s.map((x) => x.duration)).toEqual([15000, 12000, 12000, 12000, 10000]);
  });
  it('config: publicUrl vacío (= origin) y polling de settings cada 4 s', () => {
    expect(defaultConfig.publicUrl).toBe('');
    expect(defaultConfig.settingsPollMs).toBe(4000);
  });
});
