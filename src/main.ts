import './style.css';
import { loadConfig, postCutoff } from './config';
import { DEFAULT_ZAP_PROVIDERS } from '../server/settings';
import { ZapStore, type Moderation } from './nostr/store';
import { followCutoff, startNostr, type PoolLike } from './nostr/pool';
import { SimplePool } from 'nostr-tools/pool';
import { installAvatarFallback, profiles } from './nostr/profiles';
import { Follower } from './follow';
import { buildScenes, DEFAULT_DURATIONS } from './scenes';
import { Announcement } from './announcement';
import { createRemote } from './remote';
import { feedFor, showIndicator } from './livefeed';
import { isMobileViewport, renderMobile } from './mobile';

const cfg = await loadConfig();
const cutoff = postCutoff(cfg); // fixed start line (config.startLine); no age-based pruning
const store = new ZapStore(window.localStorage, { postMaxChars: cfg.postMaxChars, cutoff, zapProviders: DEFAULT_ZAP_PROVIDERS });
const pool = new SimplePool() as unknown as PoolLike;
// kind:0 profiles (alias + picture) from the same relays, batched and cached in localStorage.
profiles.configure({ query: (authors) => pool.querySync(cfg.relays, { kinds: [0], authors }, { maxWait: 4000 }), storage: window.localStorage });
installAvatarFallback(document);
const feed = followCutoff((c) => startNostr(cfg, store, pool, undefined, undefined, c), cutoff);
// Moderation, providers and start line come from the server; if the line moves earlier, refetch from the relays.
const moderate = (m: Moderation) => { store.setModeration(m); feed.setCutoff(postCutoff({ startLine: m.startLine ?? '' })); };
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
  createRemote({ nav: noNav, announcement, baseDurations: { ...DEFAULT_DURATIONS, ...cfg.sceneDurations }, baseVideoEveryCycles: cfg.videoEveryCycles, baseVideoMode: cfg.videoMode, baseVideoClipSeconds: cfg.videoClipSeconds, onModeration: moderate }).start(cfg.settingsPollMs);
} else {
  // The server is the source of truth: the totem computes the schedule it defines. Arrows: /admin.
  const strip = document.getElementById('live-strip');
  if (strip) feedFor(store).setIndicator((e) => showIndicator(strip, e)); // ⚡/💬 at the bottom if the target is not on screen
  // One schedule load + a version check every settingsPollMs (includes the announcement).
  void new Follower(scene, buildScenes(cfg, store, announcement, window.location.origin), { announcement, pollMs: cfg.settingsPollMs, onModeration: moderate }).start();
  document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
}


