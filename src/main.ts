import './style.css';
import { loadConfig, postCutoff } from './config';
import { DEFAULT_SETTINGS, DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS } from '../shared/settings';
import { ZapStore, type Moderation } from './nostr/store';
import { createPool, followCutoff, startNostr } from './nostr/pool';
import { configureProfiles } from './nostr/profiles';
import { Follower } from './follow';
import { buildScenes } from './scenes';
import { Announcement } from './announcement';
import { createRemote } from './remote';
import { feedFor, showIndicator } from './livefeed';
import { isMobileViewport, renderMobile } from './mobile';

const cfg = await loadConfig();
const cutoff = postCutoff({ startLine: DEFAULT_START_LINE });
const store = new ZapStore(window.localStorage, { postMaxChars: cfg.postMaxChars, cutoff, zapProviders: DEFAULT_ZAP_PROVIDERS });
const pool = createPool();
configureProfiles(pool, cfg.relays, window.localStorage, document);
const feed = followCutoff((c) => startNostr(cfg, store, pool, undefined, undefined, c), cutoff);
// Moderation, providers and start line come from the server; if the line moves earlier, refetch from the relays.
const moderate = (m: Moderation) => { store.setModeration(m); feed.setCutoff(postCutoff({ startLine: m.startLine ?? '' })); };
const announcement = new Announcement(DEFAULT_SETTINGS.announcement);
if (import.meta.env.DEV) void import('./demo').then((m) => m.installDemo(window, store)); // window.__totemDemo.post()/zap()
const scene = document.getElementById('scene')!;
const app = document.getElementById('app')!;

if (isMobileViewport()) {
  app.classList.add('is-mobile');
  document.documentElement.classList.add('is-mobile');
  scene.className = 'mobile';
  renderMobile(scene, store, cfg, announcement);
  createRemote({ announcement, onModeration: moderate }).start(cfg.settingsPollMs);
} else {
  // The server is the source of truth: the totem computes the schedule it defines. Arrows: /admin.
  const strip = document.getElementById('live-strip');
  if (strip) feedFor(store).setIndicator((e) => showIndicator(strip, e)); // ⚡/💬 at the bottom if the target is not on screen
  // One schedule load + a version check every settingsPollMs (includes the announcement).
  void new Follower(scene, buildScenes(cfg, store, announcement, window.location.origin), { announcement, pollMs: cfg.settingsPollMs, onModeration: moderate }).start();
  document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
}
