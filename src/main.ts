import './style.css';
import { loadConfig } from './config';
import { ZapStore } from './nostr/store';
import { startNostr } from './nostr/pool';
import { Rotator } from './rotator';
import { postScene } from './scenes/post';
import { latestZapsScene } from './scenes/latestZaps';

const cfg = await loadConfig();
document.getElementById('tags')!.textContent = cfg.hashtags.map((t) => `#${t}`).join(' ');
const store = new ZapStore(window.localStorage);
startNostr(cfg, store);

const scenes = [];
for (let i = 0; i < cfg.postsPerCycle; i++) scenes.push(postScene(store, cfg.sceneDurations.post ?? 15000));
scenes.push(latestZapsScene(store, cfg.sceneDurations.latestZaps ?? 12000));
// TODO: top10Historico, top10Ultimas3h, proximasCharlas, anuncio

new Rotator(document.getElementById('scene')!, scenes).start();
document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
