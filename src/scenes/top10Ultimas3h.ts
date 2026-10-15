import type { ZapStore } from '../nostr/store';
import type { Scene } from '../rotator';
import { topScene } from './top';

/** Top 10 by sats received in the last `hours` hours. `now` in ms (injectable). */
export const top10Ultimas3hScene = (store: ZapStore, duration: number, hours = 3, now: () => number = Date.now, publicUrl?: string): Scene =>
  topScene({
    name: 'top10Ultimas3h',
    title: `Top 10 zaps · últimas ${hours} horas`,
    store,
    duration,
    since: () => Math.floor(now() / 1000) - hours * 3600,
    publicUrl,
  });
