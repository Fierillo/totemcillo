import { loadConfig, postCutoff } from './config';
import { DEFAULT_SETTINGS, DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS } from '../shared/settings';
import { ZapStore, type Moderation } from './nostr/store';
import { createPool, followCutoff, profileLoader, startNostr } from './nostr/pool';
import { LnurlResolver } from './nostr/lnurl';
import { configureProfiles } from './nostr/profiles';
import { Follower } from './follow';
import { buildScenes } from './scenes';
import { Announcement } from './announcement';
import { createRemote } from './remote';
import { feedFor, showIndicator } from './livefeed';
import { isMobileViewport, renderMobile } from './mobile';
import { zapFx } from './zap-fx';

const cfg = await loadConfig();
const cutoff = postCutoff({ startLine: DEFAULT_START_LINE });
const store = new ZapStore(window.localStorage, { postMaxChars: cfg.postMaxChars, cutoff, zapProviders: DEFAULT_ZAP_PROVIDERS });
const pool = createPool();
configureProfiles(pool, cfg.relays, window.localStorage, document);
const feed = followCutoff((c) => startNostr(cfg, store, pool, undefined, undefined, c), cutoff);
// Moderation, providers and start line come from the server; if the line moves earlier, refetch from the relays.
const moderate = (m: Moderation) => { store.setModeration(m); feed.setCutoff(postCutoff({ startLine: m.startLine ?? '' })); };
const announcement = new Announcement(DEFAULT_SETTINGS.announcement);
// Dev only (tree-shaken from production): window.__totemDemo.post()/zap() and the "+ post" / "+ zap" buttons.
if (import.meta.env.DEV) void import('./demo').then((m) => m.demoButtons(document, m.installDemo(window, store), import.meta.env.DEV));
const scene = document.getElementById('scene')!;
const app = document.getElementById('app')!;
zapFx(store); // ⚡ + sats whenever a zap arrives, regardless of the scene on screen

if (isMobileViewport()) {
  app.classList.add('is-mobile');
  document.documentElement.classList.add('is-mobile');
  scene.className = 'mobile';
  const wallet = new LnurlResolver(profileLoader(pool, cfg.relays), undefined, undefined, () => store.moderation.zapProviders ?? DEFAULT_ZAP_PROVIDERS);
  renderMobile(scene, store, cfg, announcement, (post, sats) => wallet.requestInvoice(post, sats, cfg.relays));
  createRemote({ announcement, onModeration: moderate }).start(cfg.settingsPollMs);
} else {
  // The server is the source of truth: the totem computes the schedule it defines. Arrows: /admin.
  const strip = document.getElementById('live-strip');
  if (strip) feedFor(store).setIndicator((e) => showIndicator(strip, e)); // ⚡/💬 at the bottom if the target is not on screen
  // One schedule load + a version check every settingsPollMs (includes the announcement).
  void new Follower(scene, buildScenes(cfg, store, announcement, window.location.origin), { announcement, pollMs: cfg.settingsPollMs, onModeration: moderate }).start();
  document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
}
