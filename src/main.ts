import './style.css';
import { loadConfig } from './config';
import { ZapStore } from './nostr/store';
import { startNostr } from './nostr/pool';
import { Rotator } from './rotator';
import { buildScenes, DEFAULT_DURATIONS } from './scenes';
import { bindKeyboard } from './keyboard';
import { Announcement } from './announcement';
import { createRemote } from './remote';
import { isMobileViewport, renderMobile } from './mobile';

const cfg = await loadConfig();
document.getElementById('tags')!.textContent = cfg.hashtags.map((t) => `#${t}`).join(' ');
const store = new ZapStore(window.localStorage, { postMaxChars: cfg.postMaxChars, maxAgeSec: cfg.postMaxAgeHours * 3600 });
store.startPruning();
startNostr(cfg, store);
const announcement = new Announcement(cfg.announcement);
const scene = document.getElementById('scene')!;
const app = document.getElementById('app')!;

if (isMobileViewport()) {
  app.classList.add('is-mobile');
  document.documentElement.classList.add('is-mobile');
  scene.className = 'mobile';
  renderMobile(scene, store, cfg, announcement);
  createRemote({ nav: { next() {}, prev() {}, setDuration() {}, setEveryCycles() {}, setVideoMode() {}, setClipSeconds() {} }, announcement, baseDurations: { ...DEFAULT_DURATIONS, ...cfg.sceneDurations }, baseVideoEveryCycles: cfg.videoEveryCycles, baseVideoMode: cfg.videoMode, baseVideoClipSeconds: cfg.videoClipSeconds }).start(cfg.settingsPollMs);
} else {
  const rotator = new Rotator(scene, buildScenes(cfg, store, announcement, window.location.origin));
  rotator.start();
  if (cfg.keyboardNav) bindKeyboard(rotator);
  createRemote({ nav: rotator, announcement, baseDurations: { ...DEFAULT_DURATIONS, ...cfg.sceneDurations }, baseVideoEveryCycles: cfg.videoEveryCycles, baseVideoMode: cfg.videoMode, baseVideoClipSeconds: cfg.videoClipSeconds }).start(cfg.settingsPollMs);
  document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
}


