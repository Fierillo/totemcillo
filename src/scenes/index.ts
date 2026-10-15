import { publicUrlOf, type Config } from '../config';
import type { ZapStore } from '../nostr/store';
import type { Scene } from '../rotator';
import { Announcement } from '../announcement';
import { postScene } from './post';
import { latestZapsScene } from './latestZaps';
import { top10HistoricoScene } from './top10Historico';
import { top10Ultimas3hScene } from './top10Ultimas3h';
import { anuncioScene } from './anuncio';
import { videoScene } from './video';
import { DEFAULT_SCENE_MS } from '../../server/settings';

export const DEFAULT_DURATIONS = DEFAULT_SCENE_MS;

/** Escenas activas, todas siempre en rotación. TODO: proximasCharlas. */
export function buildScenes(cfg: Config, store: ZapStore, ann = new Announcement(cfg.announcement), origin = globalThis.location?.origin ?? ''): Scene[] {
  const d = { ...DEFAULT_DURATIONS, ...cfg.sceneDurations };
  const publicUrl = publicUrlOf(cfg, origin);
  return [
    postScene(store, d.post, { publicUrl }),
    latestZapsScene(store, d.latestZaps),
    top10HistoricoScene(store, d.top10Historico, publicUrl),
    top10Ultimas3hScene(store, d.top10Ultimas3h, cfg.topRecentHours, undefined, publicUrl),
    anuncioScene(ann, d.anuncio, publicUrl),
    videoScene(cfg.videoSrc, { everyCycles: cfg.videoEveryCycles, mode: cfg.videoMode, clipSeconds: cfg.videoClipSeconds }),
  ];
}
