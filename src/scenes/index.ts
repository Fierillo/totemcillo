import { publicUrlOf, type Config } from '../config';
import type { ZapStore } from '../nostr/store';
import type { Scene } from './types';
import { Announcement } from '../announcement';
import { postScene } from './post';
import { latestZapsScene } from './latestZaps';
import { top10HistoricoScene } from './top10Historico';
import { top10Ultimas3hScene } from './top10Ultimas3h';
import { anuncioScene } from './anuncio';
import { videoScene } from './video';
import { DEFAULT_SETTINGS } from '../../shared/settings';

/** Scene renderers in shared schedule order. */
export function buildScenes(cfg: Config, store: ZapStore, ann = new Announcement(DEFAULT_SETTINGS.announcement), origin = globalThis.location?.origin ?? ''): Scene[] {
  const publicUrl = publicUrlOf(cfg, origin);
  return [
    postScene(store, { publicUrl }),
    latestZapsScene(store, publicUrl),
    top10HistoricoScene(store, publicUrl),
    top10Ultimas3hScene(store, cfg.topRecentHours, undefined, publicUrl),
    anuncioScene(ann, publicUrl),
    videoScene(cfg.videoSrc),
  ];
}
