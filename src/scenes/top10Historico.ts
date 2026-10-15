import type { ZapStore } from '../nostr/store';
import type { Scene } from '../rotator';
import { topScene } from './top';

/** Top 10 de posts por sats (sólo posts desde config.startLine). */
export const top10HistoricoScene = (store: ZapStore, duration: number): Scene =>
  topScene({ name: 'top10Historico', title: 'Top 10 zaps · histórico', store, duration, since: () => 0 });
