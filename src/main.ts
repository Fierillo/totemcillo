import './style.css';
import { loadConfig, postCutoff } from './config';
import { ZapStore } from './nostr/store';
import { startNostr } from './nostr/pool';
import { Follower } from './follow';
import { buildScenes, DEFAULT_DURATIONS } from './scenes';
import { Announcement } from './announcement';
import { createRemote } from './remote';
import { feedFor, showIndicator } from './livefeed';
import { isMobileViewport, renderMobile } from './mobile';

const cfg = await loadConfig();
document.getElementById('tags')!.textContent = cfg.hashtags.map((t) => `#${t}`).join(' ');
const cutoff = postCutoff(cfg); // línea de largada fija (config.startLine); sin poda por edad
const store = new ZapStore(window.localStorage, { postMaxChars: cfg.postMaxChars, cutoff });
startNostr(cfg, store, undefined, undefined, undefined, cutoff);
const announcement = new Announcement(cfg.announcement);
if (import.meta.env.DEV) void import('./demo').then((m) => m.installDemo(window, store)); // window.__totemDemo.post()/zap()
const scene = document.getElementById('scene')!;
const app = document.getElementById('app')!;

const noNav = { next() {}, prev() {}, setDuration() {}, setEveryCycles() {}, setVideoMode() {}, setClipSeconds() {} };

if (isMobileViewport()) {
  app.classList.add('is-mobile');
  document.documentElement.classList.add('is-mobile');
  scene.className = 'mobile';
  renderMobile(scene, store, cfg, announcement);
  createRemote({ nav: noNav, announcement, baseDurations: { ...DEFAULT_DURATIONS, ...cfg.sceneDurations }, baseVideoEveryCycles: cfg.videoEveryCycles, baseVideoMode: cfg.videoMode, baseVideoClipSeconds: cfg.videoClipSeconds }).start(cfg.settingsPollMs);
} else {
  // El servidor es la fuente de verdad: el tótem calcula la agenda que éste define. Flechas: /admin.
  const strip = document.getElementById('live-strip');
  if (strip) feedFor(store).setIndicator((e) => showIndicator(strip, e)); // ⚡/💬 abajo si el objetivo no está en pantalla
  // Una carga de la agenda + chequeo de versión cada settingsPollMs (incluye el anuncio).
  void new Follower(scene, buildScenes(cfg, store, announcement, window.location.origin), { announcement, pollMs: cfg.settingsPollMs }).start();
  document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
}


