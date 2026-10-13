import type { Config } from '../config';
import type { ZapStore } from '../nostr/store';
import type { Scene } from '../rotator';
import { postScene } from './post';
import { latestZapsScene } from './latestZaps';

/** Escenas activas. TODO: top10Historico, top10Ultimas3h, proximasCharlas, anuncio. */
export function buildScenes(cfg: Config, store: ZapStore): Scene[] {
  const d = cfg.sceneDurations;
  const scenes = Array.from({ length: cfg.postsPerCycle }, () => postScene(store, d.post ?? 15000, { relays: cfg.relays, template: cfg.noteUriTemplate }));
  scenes.push(latestZapsScene(store, d.latestZaps ?? 12000));
  return scenes;
}
