import { publicUrlOf, type Config } from '../config';
import type { ZapStore } from '../nostr/store';
import type { Scene } from './types';
import { Announcement } from '../announcement';
import { postScene } from './post';
import { batallaScene } from './batalla';
import { anuncioScene } from './anuncio';
import { videoScene } from './video';
import { DEFAULT_SETTINGS } from '../../shared/settings';
import type { CanZap } from '../zapcache';

/** Scene renderers in shared schedule order: messages, zap battle, then the short pauses (announcement, video). */
export function buildScenes(cfg: Config, store: ZapStore, ann = new Announcement(DEFAULT_SETTINGS.announcement), origin = globalThis.location?.origin ?? '', canZap?: CanZap): Scene[] {
  const publicUrl = publicUrlOf(cfg, origin);
  return [
    postScene(store, { publicUrl, canZap }),
    batallaScene(store, cfg.topRecentHours, publicUrl, canZap),
    anuncioScene(ann, publicUrl),
    videoScene(cfg.videoSrc),
  ];
}
