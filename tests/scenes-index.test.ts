import { describe, expect, it } from 'vitest';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';

describe('buildScenes', () => {
  it('renderizadores en orden de agenda', () => {
    const s = buildScenes(defaultConfig, new ZapStore());
    expect(s.map((x) => x.name)).toEqual(['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio', 'video']);
  });
  it('los renderizadores no mantienen duraciones locales', () => {
    const s = buildScenes(defaultConfig, new ZapStore());
    for (const scene of s) expect(scene).not.toHaveProperty('duration');
  });
  it('config pública no duplica las duraciones administrables', async () => {
    const { readFileSync } = await import('node:fs');
    const json = JSON.parse(readFileSync(new URL('../public/config.json', import.meta.url), 'utf8'));
    expect(json).not.toHaveProperty('sceneDurations');
  });
  it('config: publicUrl vacío (= origin) y polling de settings cada 4 s', () => {
    expect(defaultConfig.publicUrl).toBe('');
    expect(defaultConfig.settingsPollMs).toBe(21000);
  });
});
