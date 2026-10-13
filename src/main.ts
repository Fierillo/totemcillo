import './style.css';
import { loadConfig } from './config';
import { ZapStore } from './nostr/store';
import { startNostr } from './nostr/pool';
import { Rotator } from './rotator';
import { buildScenes } from './scenes';
import { bindKeyboard } from './keyboard';

const cfg = await loadConfig();
document.getElementById('tags')!.textContent = cfg.hashtags.map((t) => `#${t}`).join(' ');
const store = new ZapStore(window.localStorage, { postMaxChars: cfg.postMaxChars, maxAgeSec: cfg.postMaxAgeHours * 3600 });
store.startPruning();
startNostr(cfg, store);
const rotator = new Rotator(document.getElementById('scene')!, buildScenes(cfg, store));
rotator.start();
if (cfg.keyboardNav) bindKeyboard(rotator);
document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
