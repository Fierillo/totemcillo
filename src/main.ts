import './style.css';
import { loadConfig } from './config';
import { ZapStore } from './nostr/store';
import { startNostr } from './nostr/pool';
import { Rotator } from './rotator';
import { buildScenes } from './scenes';

const cfg = await loadConfig();
document.getElementById('tags')!.textContent = cfg.hashtags.map((t) => `#${t}`).join(' ');
const store = new ZapStore(window.localStorage);
startNostr(cfg, store);
new Rotator(document.getElementById('scene')!, buildScenes(cfg, store)).start();
document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
