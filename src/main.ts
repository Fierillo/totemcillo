import './style.css';
import { loadConfig } from './config';
import { ZapStore } from './nostr/store';
import { startNostr } from './nostr/pool';
import { Rotator } from './rotator';
import { buildScenes } from './scenes';

const cfg = await loadConfig();
document.getElementById('tags')!.textContent = cfg.hashtags.map((t) => `#${t}`).join(' ');
const store = new ZapStore(window.localStorage, { postMaxChars: cfg.postMaxChars, maxAgeSec: cfg.postMaxAgeHours * 3600 });
store.startPruning();
startNostr(cfg, store);
new Rotator(document.getElementById('scene')!, buildScenes(cfg, store)).start();
document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
