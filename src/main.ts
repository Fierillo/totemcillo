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
import { createStateReporter, createPreviewFollower } from './live-state';

const cfg = await loadConfig();
document.getElementById('tags')!.textContent = cfg.hashtags.map((t) => `#${t}`).join(' ');
const store = new ZapStore(window.localStorage, { postMaxChars: cfg.postMaxChars, maxAgeSec: cfg.postMaxAgeHours * 3600 });
store.startPruning();
startNostr(cfg, store);
const announcement = new Announcement(cfg.announcement);
const scene = document.getElementById('scene')!;
const app = document.getElementById('app')!;

const preview = new URLSearchParams(window.location.search).has('preview');
const remoteBase = { announcement, baseDurations: { ...DEFAULT_DURATIONS, ...cfg.sceneDurations }, baseVideoEveryCycles: cfg.videoEveryCycles, baseVideoMode: cfg.videoMode, baseVideoClipSeconds: cfg.videoClipSeconds };
const videoEl = () => scene.querySelector('video');

if (preview) {
  // Miniatura del admin: no rota, no reporta, no ejecuta comandos; sigue a /api/state.
  document.documentElement.classList.add('is-preview');
  const rotator = new Rotator(scene, buildScenes(cfg, store, announcement, window.location.origin), { auto: false });
  rotator.start();
  createRemote({ nav: { next() {}, prev() {}, setDuration() {}, setEveryCycles() {}, setVideoMode: (n, m) => rotator.setVideoMode(n, m), setClipSeconds: (n, s) => rotator.setClipSeconds(n, s) }, ...remoteBase }).start(cfg.settingsPollMs);
  createPreviewFollower({ view: {
    showIndex: (i) => rotator.showIndex(i),
    current: () => ({ index: rotator.current().index, videoTime: videoEl()?.currentTime ?? null }),
    seekVideo: (t) => { const v = videoEl(); if (v) v.currentTime = t; },
  } }).start(1000);
} else if (isMobileViewport()) {
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
  createStateReporter({ current: () => { const c = rotator.current(); return { scene: c.scene, index: c.index, videoTime: c.scene === 'video' ? videoEl()?.currentTime ?? null : null }; } }).start(2000);
  document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
}


