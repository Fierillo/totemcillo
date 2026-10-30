// Shared browser harness for the e2e flows (e2e/) and the layout suite (layout/):
// the built app on a vite preview server, Chrome, stubbed relay/LNURL/kiosk and the fixtures.
import { createServer, preview } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { finalizeEvent, getPublicKey } from 'nostr-tools/pure';

export const BASE = 'http://localhost:4179';
export const out = process.env.SHOTS ?? 'shots';
mkdirSync(out, { recursive: true });

export const now = Math.floor(Date.now() / 1000);
export const hex = (n) => n.toString(16).padStart(64, '0');
// Fixture author with a real Lightning address (kind 0 from a fake relay + LNURL stub): only zappable authors get ranked.
const SK = new Uint8Array(32).fill(7);
export const AUTHOR = getPublicKey(SK), RELAY = 'wss://relay.e2e.invalid/';
const PROFILE = finalizeEvent({ kind: 0, created_at: now, tags: [], content: JSON.stringify({ name: 'e2e', lud16: 'e2e@getalby.com' }) }, SK);

/** Starts the preview server (built app) and Chrome; `close()` stops both. */
export async function startApp() {
  const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
  const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });
  return { browser, close: async () => { await browser.close(); server.httpServer.close(); } };
}

/** Dev server (window.__totemDemo, live path) on :4180, already warmed so vite won't reload a page mid-test. */
export async function startDev(browser) {
  const env = process.env.NODE_ENV; process.env.NODE_ENV = 'development'; // preview() set production, which strips the dev demo
  const dev = await createServer({ server: { port: 4180, strictPort: true }, logLevel: 'silent' });
  await dev.listen(); process.env.NODE_ENV = env;
  const warm = await browser.newPage();
  await warm.goto('http://localhost:4180/');
  await warm.waitForFunction(() => window.__totemDemo, null, { timeout: 30000 }); // deps optimized: later pages load without reloading
  await warm.close();
  return { url: 'http://localhost:4180/', close: () => dev.close() };
}

// Mobile loading screen: wait until it fades out (it is capped at 8 s).
export const splashGone = (page) => page.waitForSelector('.m-splash', { state: 'detached', timeout: 12000 });
/** Waits until finite animations are over and the scrollers stopped moving for 5 frames. */
export const settled = (page) => page.waitForFunction(() => new Promise((ok) => {
  const pos = () => [...document.querySelectorAll('.m-reel, #mobile-top')].map((e) => e.scrollTop).join();
  const busy = () => document.getAnimations().some((a) => a.playState === 'running' && a.effect?.getComputedTiming().iterations !== Infinity);
  let last = pos(), still = 0;
  const tick = () => { const now = pos(); still = now === last && !busy() ? still + 1 : 0; last = now; if (still >= 5) ok(true); else requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
}), null, { timeout: 15000 });
/** Current #scene class. */
export const sceneOf = (page) => page.evaluate(() => document.getElementById('scene')?.className);
/** Waits (up to `ms`) until #scene has class `cls`; the caller asserts the final state. */
export const sceneIs = (page, cls, ms) => page.waitForFunction((c) => document.getElementById('scene')?.className === c, cls, { timeout: ms }).catch(() => {});

export async function zappableAuthor(page) {
  await page.routeWebSocket(RELAY, (ws) => ws.onMessage((m) => {
    const [type, sub, ...filters] = JSON.parse(m);
    if (type !== 'REQ') return;
    if (filters.some((f) => f.kinds?.includes(0) && f.authors?.includes(AUTHOR))) ws.send(JSON.stringify(['EVENT', sub, PROFILE]));
    ws.send(JSON.stringify(['EOSE', sub]));
  }));
  await page.route('https://getalby.com/.well-known/lnurlp/e2e', (r) => r.fulfill({ headers: { 'access-control-allow-origin': '*' },
    json: { tag: 'payRequest', allowsNostr: true, nostrPubkey: 'ef'.repeat(32), callback: 'https://getalby.com/lnurlp/e2e/callback', minSendable: 1000, maxSendable: 1e11, metadata: '[]' } }));
}

/** Opens a page with config.json stubbed (`config` merged over the base) and optional localStorage `data`. */
export async function openApp(browser, { viewport = { width: 1280, height: 720 }, mobile = false, dpr = 1, config = {}, data, zappable = false } = {}) {
  const page = await browser.newPage({ viewport, deviceScaleFactor: dpr, ...(mobile ? { hasTouch: true, isMobile: true } : {}) });
  if (zappable) await zappableAuthor(page);
  await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, ...(zappable ? { relays: [RELAY] } : {}), ...config } }));
  if (data) await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify(data));
  return page;
}

export const lorem = 'Bitcoin Lightning Nostr zap La Crypta LABITCONF comunidad Buenos Aires soberanía código abierto descentralización '.split(' ');
let long = '';
for (let i = 0; long.length < 1880; i++) long += lorem[i % lorem.length] + (i % 17 === 16 ? '\n' : ' ');
long += ' https://ejemplo.com/' + 'x'.repeat(100);
long = long.slice(0, 2000);
export { long };
export const posts = [
  { id: hex(1), pubkey: AUTHOR, content: long, created_at: now - 60 },
  { id: hex(2), pubkey: AUTHOR, content: 'POST VIEJO fuera de la ventana de 24 h', created_at: now - 25 * 3600 },
];
export const zaps = Array.from({ length: 40 }, (_, i) => ({
  id: hex(100 + i), postId: hex(1), sender: 'cd'.repeat(32), msats: (i + 1) * 21_000_000, domain: 'getalby.com',
  comment: 'Comentario larguísimo de prueba para el tótem '.repeat(6).slice(0, 280), created_at: now - i * 10,
}));
// Many ranked posts: the battle shows as many bars as fit.
for (let i = 0; i < 40; i++) {
  posts.push({ id: hex(300 + i), pubkey: AUTHOR, content: `Participante ${i + 1} de la batalla #lacrypta con un texto corto`, created_at: now - 120 - i });
  zaps.push({ id: hex(400 + i), postId: hex(300 + i), sender: 'cd'.repeat(32), msats: (40 - i) * 1_000_000, domain: 'getalby.com', comment: '', created_at: now - 100 - i });
}
zaps.push({ id: hex(999), postId: hex(2), sender: 'cd'.repeat(32), msats: 1e12, domain: 'getalby.com', comment: 'zap a post viejo', created_at: now - 25 * 3600 });
export const cfg = { relays: [], hashtags: ['lacrypta'] };
export const sceneDurations = { post: 3000, batalla: 60000, anuncio: 3000 };
export const comments = ['¡Grande La Crypta! 🧡', 'Vamos LABITCONF ⚡⚡', 'Excelente charla, gracias', 'pura vida', 'Zap desde Córdoba', '🔥🔥🔥', 'Nos vemos en el stand', 'Lightning > todo'];
export const five = Array.from({ length: 5 }, (_, i) => ({ id: hex(700 + i), pubkey: (i + 1).toString().repeat(64), content: `Post número ${i + 1} sobre #lacrypta y la LABITCONF, con un texto de largo normal para ver cómo entra`, created_at: now - (i + 1) * 300 }));
export const fiveZaps = five.flatMap((p, i) => Array.from({ length: Math.min(i + 1, 2) }, (_, j) => ({ id: hex(800 + i * 10 + j), postId: p.id, sender: (j + 1).toString().repeat(64), msats: (j + 1) * 21000, comment: comments[j], created_at: now - j * 20, domain: 'getalby.com' })));

// The totem follows the server schedule (/api/kiosk + /api/version), not local timers or keys.
// `kiosk(page, durations, extra)` serves a stubbed schedule; `show(scene)` re-anchors `epoch` so that
// scene is on air right now and reloads the page (the totem computes the scene from epoch + server time).
const ORDER = ['post', 'batalla', 'anuncio', 'video'];
export const START_LINE = new Date((now - 24 * 3600) * 1000).toISOString(); // older fixtures fall before the start line
export async function kiosk(page, durations, extra = {}) {
  const base = await (await fetch(`${BASE}/api/kiosk`)).json();
  const st = { ...base, startLine: START_LINE, ...extra, sceneDurations: durations, epoch: Date.now(), version: 1 };
  await page.route('**/api/kiosk*', (r) => r.fulfill({ json: st }));
  await page.route('**/api/version*', (r) => r.fulfill({ json: { version: st.version } }));
  const durs = { post: 42000, batalla: 28000, anuncio: 10000, ...durations }; // DEFAULT_SCENE_MS
  if (!String(st.announcement ?? '').trim()) durs.anuncio = 0; // no announcement: the schedule skips its scene
  return {
    async show(scene, reload = true) {
      const i = ORDER.indexOf(scene);
      st.epoch = Date.now() - ORDER.slice(0, i).reduce((a, n) => a + durs[n], 0) - 200;
      if (reload) { await page.reload(); await page.waitForSelector(`.scene-${scene}`, { timeout: 15000 }); }
    },
  };
}

// Mobile feed: a post with very long words first, then the five regular posts, all from the zappable author.
const longWords = 'Supercalifragilisticoexpialidoso descentralización criptográficamente interoperabilidad #lacrypta habilidadesextraordinarias anticonstitucionalmente electroencefalografista otorrinolaringología '.repeat(2).slice(0, 210);
export const mobileFeed = [{ id: hex(77), pubkey: AUTHOR, content: longWords, created_at: now - 1 }, ...five.map((p) => ({ ...p, pubkey: AUTHOR }))];
/** Opens the phone view with the mobile feed loaded and waits until the splash is gone and the feed is still. */
export async function openMobile(browser, [width, height]) {
  const page = await openApp(browser, { viewport: { width, height }, mobile: true, zappable: true, config: { publicUrl: 'https://totem.lacrypta.ar/' }, data: { posts: mobileFeed, zaps: fiveZaps } });
  await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 });
  await page.goto(`${BASE}/`);
  return page;
}
export async function feedReady(page) {
  await splashGone(page);
  await page.waitForSelector('.mobile .m-reel .m-post');
  await settled(page);
}

/** Opens /admin and signs in with the dev password. */
export async function adminLogin(browser, viewport = { width: 1280, height: 720 }) {
  const page = await browser.newPage({ viewport });
  await page.goto(`${BASE}/admin`);
  await page.fill('input[type="password"]', 'admin');
  await page.click('button[type="submit"]');
  await page.waitForSelector('textarea[name="announcement"]', { timeout: 5000 });
  return page;
}
export const settings = (page) => page.evaluate(async () => (await fetch('/api/settings')).json());
export const session = (page) => page.evaluate(async () => (await fetch('/api/session')).json());
/** Clicks Guardar and waits for the status text. */
export async function save(page) {
  await page.evaluate(() => { document.querySelector('.status').textContent = ''; });
  await page.click('button.save');
  await page.waitForFunction(() => document.querySelector('.status')?.textContent, null, { timeout: 5000 });
  return page.evaluate(() => document.querySelector('.status').textContent);
}
// Like the dev '+ mix': messages of varied lengths (some take two-row boxes), some zapped.
const mixText = (n) => `#lacrypta ${lorem.join(' ').repeat(Math.ceil(n / 60)).slice(0, n)}`;
export const mixPosts = Array.from({ length: 14 }, (_, i) => ({ id: hex(700 + i), pubkey: AUTHOR, content: mixText([4, 40, 100, 200, 280][i % 5]), created_at: now - 60 - i * 5 }));
export const mixZaps = mixPosts.filter((_, i) => i % 3 === 0).map((p, i) => ({ id: hex(800 + i), postId: p.id, sender: 'cd'.repeat(32), msats: (i + 1) * 21_000, domain: 'getalby.com', comment: '', created_at: now - 30 - i }));
