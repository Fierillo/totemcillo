import { describe, expect, it } from 'vitest';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';

describe('buildScenes', () => {
  it('una sola escena de post (sin repetir) + últimos zaps + tops, con duraciones de config', () => {
    const s = buildScenes({ ...defaultConfig, postsPerCycle: 3, sceneDurations: { post: 7, latestZaps: 9 } } as any, new ZapStore());
    expect(s.map((x) => [x.name, x.duration])).toEqual([['post', 7], ['latestZaps', 9], ['top10Historico', 12000], ['top10Ultimas3h', 12000]]);
  });
  it('usa duraciones por defecto si faltan', () => {
    const s = buildScenes({ ...defaultConfig, sceneDurations: {} }, new ZapStore());
    expect(s.map((x) => x.duration)).toEqual([15000, 12000, 12000, 12000]);
  });
  it('la config ya no tiene postsPerCycle', () => {
    expect('postsPerCycle' in defaultConfig).toBe(false);
  });
});
