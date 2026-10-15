import type { ZapStore } from '../nostr/store';
import type { Scene } from './types';
import { topScene } from './top';

/** Top 10 posts by sats (only posts since the server's start line). */
export const top10HistoricoScene = (store: ZapStore, publicUrl?: string): Scene =>
  topScene({ name: 'top10Historico', title: 'Top 10 zaps · histórico', store, since: () => 0, publicUrl });
