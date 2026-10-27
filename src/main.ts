import { loadConfig, postCutoff } from './config';
import { DEFAULT_SETTINGS, DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS } from '../shared/settings';
import { ZapStore, type Moderation } from './nostr/store';
import { createPool, followCutoff, profileLoader, startNostr } from './nostr/pool';
import { LnurlResolver } from './nostr/lnurl';
import { configureProfiles, profiles } from './nostr/profiles';
import { cachedCanZap } from './zapcache';
import { Follower } from './follow';
import { buildScenes } from './scenes';
import { Announcement } from './announcement';
import { createRemote } from './remote';
import { feedFor, showIndicator } from './livefeed';
import { isMobileViewport, MOBILE_POST_MAX_CHARS, renderMobile } from './mobile';
import { zapFx } from './zap-fx';
import { openCompose } from './compose';
import { installFx } from './fx';

installFx(document.documentElement);
const cfg = await loadConfig();
const cutoff = postCutoff({ startLine: DEFAULT_START_LINE });
const store = new ZapStore(window.localStorage, { postMaxChars: isMobileViewport() ? MOBILE_POST_MAX_CHARS : cfg.postMaxChars, cutoff, zapProviders: DEFAULT_ZAP_PROVIDERS });
const pool = createPool();
configureProfiles(pool, cfg.relays, window.localStorage, document);
const feed = followCutoff((c) => startNostr(cfg, store, pool, undefined, undefined, c), cutoff);
// Moderation, providers and start line come from the server; if the line moves earlier, refetch from the relays.
const moderate = (m: Moderation) => { store.setModeration(m); feed.setCutoff(postCutoff({ startLine: m.startLine ?? '' })); };
const announcement = new Announcement(DEFAULT_SETTINGS.announcement);
let follower: Follower | undefined; // totem only: mobile doesn't follow the clock
const devZappable = new Set<string>(); // dev only: authors of the "+ post ⚡" demo posts
const scene = document.getElementById('scene')!;
const wallet = new LnurlResolver(profileLoader(pool, cfg.relays), undefined, undefined, () => store.moderation.zapProviders ?? DEFAULT_ZAP_PROVIDERS);
// Same cached check on both views: the totem only uses it for the red bolt (no zapping there).
const canZap = cachedCanZap(async (pk) => (import.meta.env.DEV && devZappable.has(pk)) || !!(await wallet.resolveInfo(pk)), window.localStorage, undefined, (pk) => profiles.updatedAt(pk));
const app = document.getElementById('app')!;
zapFx(store); // ⚡ + sats at the bottom when the zapped post is not on screen

if (isMobileViewport()) {
  app.classList.add('is-mobile');
  document.documentElement.classList.add('is-mobile');
  scene.className = 'mobile';
  renderMobile(scene, store, cfg, announcement, {
    requestInvoice: (post, sats, message) => wallet.requestInvoice(post, sats, cfg.relays, message),
    compose: () => openCompose(cfg.hashtags, (ev) => Promise.any(pool.publish!(cfg.relays, ev))), // straight to the relays, never Redis
    canZap,
  });
  createRemote({ announcement, onModeration: moderate }).start(cfg.settingsPollMs);
} else {
  // The server is the source of truth: the totem computes the schedule it defines. Arrows: /admin.
  const strip = document.getElementById('live-strip');
  if (strip) feedFor(store).onMiss((e) => showIndicator(strip, e)); // 💬 in the lower band if the post is not on screen
  // One schedule load + a version check every settingsPollMs (includes the announcement).
  follower = new Follower(scene, buildScenes(cfg, store, announcement, window.location.origin, canZap), { announcement, pollMs: cfg.settingsPollMs, onModeration: moderate });
  void follower.start();
  document.addEventListener('dblclick', () => document.documentElement.requestFullscreen?.());
}
// Dev only (tree-shaken from production), wired once the totem's follower exists: window.__totemDemo.post()/zap(), the "+ post" / "+ zap" buttons and, on the totem, local scene arrows.
if (import.meta.env.DEV) void import('./demo').then((m) => m.demoButtons(document, m.installDemo(window, store, undefined, devZappable), import.meta.env.DEV, follower));
