import { describe, expect, it } from 'vitest';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';

describe('buildScenes', () => {
  it('N escenas de post + últimos zaps con duraciones de config', () => {
    const s = buildScenes({ ...defaultConfig, postsPerCycle: 2, sceneDurations: { post: 7, latestZaps: 9 } }, new ZapStore());
    expect(s.map((x) => [x.name, x.duration])).toEqual([['post', 7], ['post', 7], ['latestZaps', 9], ['top10Historico', 12000], ['top10Ultimas3h', 12000]]);
  });
  it('usa duraciones por defecto si faltan', () => {
    const s = buildScenes({ ...defaultConfig, postsPerCycle: 1, sceneDurations: {} }, new ZapStore());
    expect(s.map((x) => x.duration)).toEqual([15000, 12000, 12000, 12000]);
  });
});
