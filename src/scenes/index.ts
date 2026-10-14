import type { Config } from '../config';
import type { ZapStore } from '../nostr/store';
import type { Scene } from '../rotator';
import { postScene } from './post';
import { latestZapsScene } from './latestZaps';
import { top10HistoricoScene } from './top10Historico';
import { top10Ultimas3hScene } from './top10Ultimas3h';

/** Escenas activas. TODO: proximasCharlas, anuncio. */
export function buildScenes(cfg: Config, store: ZapStore): Scene[] {
  const d = cfg.sceneDurations;
  return [
    postScene(store, d.post ?? 15000, { relays: cfg.relays, template: cfg.noteUriTemplate }),
    latestZapsScene(store, d.latestZaps ?? 12000),
    top10HistoricoScene(store, d.top10Historico ?? 12000),
    top10Ultimas3hScene(store, d.top10Ultimas3h ?? 12000, cfg.topRecentHours),
  ];
}
