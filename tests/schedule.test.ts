// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { positionAt, shiftSchedule, reanchor, SCHEDULE_DEFAULTS } from '../shared/schedule';
import { handle, type ApiRequest, type Deps } from '../server/api';
import { memoryStorage } from '../server/storage';
import { DEFAULT_SETTINGS, DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS, validatePatch, type Settings } from '../server/settings';
import { Follower } from '../src/follow';
import { Announcement } from '../src/announcement';
import type { Scene } from '../src/rotator';
import { videoScene } from '../src/scenes/video';

const D = { post: 1000, latestZaps: 2000, top10Historico: 1000, top10Ultimas3h: 1000, anuncio: 1000 }; // base 6000
const S = (o: Partial<Settings> = {}): Settings => ({ ...DEFAULT_SETTINGS, sceneDurations: D, videoEveryCycles: 2, videoMode: 'full', videoDurationSec: 10, epoch: 100_000, ...o });

describe('positionAt (determinístico)', () => {
  it('defaults: video de 88.4 s, cada 2 vueltas, full', () => {
    expect(SCHEDULE_DEFAULTS).toMatchObject({ videoEveryCycles: 2, videoMode: 'full', videoDurationSec: 88.4 });
  });
  it('recorre escenas con sus duraciones; la vuelta 0 incluye video, la 1 no', () => {
    const s = S();
    expect(positionAt(s, 100_000)).toEqual({ scene: 'post', index: 0, cycle: 0, sceneStartedAt: 100_000, sceneEndsAt: 101_000 });
    expect(positionAt(s, 102_999)).toMatchObject({ scene: 'latestZaps', index: 1, sceneStartedAt: 101_000, sceneEndsAt: 103_000 });
    expect(positionAt(s, 106_500)).toEqual({ scene: 'video', index: 5, cycle: 0, sceneStartedAt: 106_000, sceneEndsAt: 116_000, videoOffset: 0 });
    expect(positionAt(s, 116_000)).toMatchObject({ scene: 'post', cycle: 1, sceneStartedAt: 116_000 });
    expect(positionAt(s, 121_000)).toMatchObject({ scene: 'anuncio', cycle: 1 });
    expect(positionAt(s, 122_000)).toMatchObject({ scene: 'post', cycle: 2, sceneStartedAt: 122_000 }); // no video in cycle 1
    expect(positionAt(s, 128_000)).toMatchObject({ scene: 'video', cycle: 2 });
  });
  it('mismo resultado para cualquier llamada (sin estado) y funciona antes de epoch', () => {
    const s = S();
    expect(positionAt(s, 5_000_123)).toEqual(positionAt(s, 5_000_123));
    expect(positionAt(s, 99_000)).toMatchObject({ scene: 'anuncio', sceneEndsAt: 100_000 });
  });
  it('sin epoch usa 0', () => {
    const { epoch, ...rest } = S();
    expect(positionAt(rest as Settings, 0)).toMatchObject({ scene: 'post', sceneStartedAt: 0 });
  });
  it('modo clip: dura videoClipSeconds y el inicio es determinístico dentro de [0, dur-clip]', () => {
    const s = S({ videoMode: 'clip', videoClipSeconds: 4, videoDurationSec: 10 });
    const p = positionAt(s, 106_000);
    expect(p).toMatchObject({ scene: 'video', sceneEndsAt: 110_000 });
    expect(p.videoOffset).toBeGreaterThanOrEqual(0);
    expect(p.videoOffset).toBeLessThanOrEqual(6);
    expect(positionAt(s, 107_000).videoOffset).toBe(p.videoOffset);
    const offs = new Set(Array.from({ length: 10 }, (_, k) => positionAt(s, 106_000 + k * 2 * 10_000 + 10).videoOffset));
    expect(offs.size).toBeGreaterThan(1); // varies per cycle
  });
  it('clip más largo que el video: video entero', () => {
    expect(positionAt(S({ videoMode: 'clip', videoClipSeconds: 30 }), 106_000)).toMatchObject({ sceneEndsAt: 116_000, videoOffset: 0 });
  });
});

describe('flechas: shiftSchedule', () => {
  it('next arranca la escena siguiente ahora; prev la anterior', () => {
    const s = S();
    const n = shiftSchedule(s, 100_500, 'next');
    expect(positionAt(n, 100_500)).toMatchObject({ scene: 'latestZaps', sceneStartedAt: 100_500, sceneEndsAt: 102_500 });
    const p = shiftSchedule(n, 101_000, 'prev');
    expect(positionAt(p, 101_000)).toMatchObject({ scene: 'post', sceneStartedAt: 101_000 });
    const pp = shiftSchedule(s, 100_200, 'prev'); // before post: announcement from the previous cycle
    expect(positionAt(pp, 100_200)).toMatchObject({ scene: 'anuncio', sceneStartedAt: 100_200 });
  });
});

describe('reanchor al cambiar duraciones', () => {
  it('la escena actual conserva su inicio', () => {
    const s = S();
    const cur = positionAt(s, 101_500); // latestZaps since 101_000
    const next = reanchor(s, { ...s, sceneDurations: { ...D, post: 5000 } }, 101_500);
    expect(positionAt(next, 101_500)).toMatchObject({ scene: 'latestZaps', sceneStartedAt: cur.sceneStartedAt, sceneEndsAt: 103_000 });
  });
});

const PASS = 'clave';
const deps = (over: Partial<Deps> = {}): Deps => ({ storage: memoryStorage(), env: { ADMIN_PASSWORD: PASS, SESSION_SECRET: 's'.repeat(32) }, now: () => 1_000_000, ...over });
const req = (method: string, path: string, body?: unknown, headers: Record<string, string> = {}): ApiRequest =>
  ({ method, path, body, ip: '1.1.1.1', headers: { 'content-type': 'application/json', ...headers } });

describe('/api/kiosk (sólo lectura)', () => {
  it('GET devuelve las entradas de la agenda, anuncio y versión (sin hora: es cacheable)', async () => {
    const r = await handle(req('GET', '/api/kiosk'), deps());
    expect(r.status).toBe(200);
    expect(r.body).toEqual({ epoch: 0, sceneDurations: {}, videoEveryCycles: 2, videoMode: 'full', videoClipSeconds: 21, videoDurationSec: 88.4, announcement: '', version: 0, hiddenPosts: [], bannedPubkeys: [], zapProviders: DEFAULT_ZAP_PROVIDERS, startLine: DEFAULT_START_LINE });
    expect(r.headers['cache-control']).toBe('public, max-age=0, s-maxage=5, stale-while-revalidate=5');
  });
  it('GET /api/time: hora del servidor, nunca cacheada y sin tocar el storage', async () => {
    const storage = { get: vi.fn(), set: vi.fn(), incr: vi.fn() };
    const r = await handle(req('GET', '/api/time'), deps({ storage: storage as any }));
    expect(r.body).toEqual({ now: 1_000_000 });
    expect(r.headers['cache-control']).toBe('no-store');
    expect(storage.get).not.toHaveBeenCalled();
  });
  it('endpoints de admin nunca se cachean (el GET público de settings: ver cache-hardening)', async () => {
    for (const [m, path] of [['GET', '/api/session'], ['POST', '/api/login'], ['POST', '/api/logout'], ['PUT', '/api/settings']])
      expect((await handle(req(m, path, {}), deps())).headers['cache-control'], path).toBe('no-store');
  });
  it('GET /api/version: diminuto y cacheable unos segundos en el CDN', async () => {
    const r = await handle(req('GET', '/api/version'), deps());
    expect(r.body).toEqual({ version: 0 });
    expect(r.headers['cache-control']).toBe('public, max-age=0, s-maxage=5, stale-while-revalidate=5');
    expect((await handle(req('PUT', '/api/version', {}), deps())).status).toBe(405);
  });
  it('cada cambio de admin (incluidas flechas) incrementa version', async () => {
    const d = deps();
    const login = await handle(req('POST', '/api/login', { password: PASS }), d);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    await handle(req('PUT', '/api/settings', { announcement: 'hola' }, { cookie }), d);
    await handle(req('PUT', '/api/settings', { command: 'next' }, { cookie }), d);
    expect((await handle(req('GET', '/api/version'), d)).body).toEqual({ version: 2 });
    expect((await handle(req('GET', '/api/kiosk'), d)).body).toMatchObject({ announcement: 'hola', version: 2 });
  });
  it('PUT/POST no existen (405)', async () => {
    expect((await handle(req('PUT', '/api/kiosk', { index: 0 }), deps())).status).toBe(405);
    expect((await handle(req('POST', '/api/kiosk', {}), deps())).status).toBe(405);
  });
  it('flecha de admin mueve la posición del servidor; settings no aceptan epoch de afuera', async () => {
    let now = 1_000_000;
    const d = deps({ now: () => now });
    const login = await handle(req('POST', '/api/login', { password: PASS }), d);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const pos = async () => positionAt((await handle(req('GET', '/api/kiosk'), d)).body as any, now);
    const before = await pos();
    now += 10;
    expect((await handle(req('PUT', '/api/settings', { command: 'next' }, { cookie }), d)).status).toBe(200);
    const after = await pos();
    expect(after.sceneStartedAt).toBe(now);
    expect(after.index).not.toBe(before.index);
    const v = validatePatch({ epoch: 5 });
    expect(v.ok && 'epoch' in v.patch).toBe(false);
  });
  it('cambiar duraciones re-ancla: la escena actual no salta', async () => {
    let now = 1_234_567;
    const d = deps({ now: () => now });
    const login = await handle(req('POST', '/api/login', { password: PASS }), d);
    const cookie = String(login.headers['set-cookie']).split(';')[0];
    const pos = async () => positionAt((await handle(req('GET', '/api/kiosk'), d)).body as any, now);
    const before = await pos();
    await handle(req('PUT', '/api/settings', { sceneDurations: { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000, anuncio: 60000 } }, { cookie }), d);
    const after = await pos();
    expect([after.scene, after.sceneStartedAt]).toEqual([before.scene, before.sceneStartedAt]);
  });
  it('videoDurationSec es configurable y validado', () => {
    expect(validatePatch({ videoDurationSec: 88.4 })).toEqual({ ok: true, patch: { videoDurationSec: 88.4 } });
    expect(validatePatch({ videoDurationSec: 0 }).ok).toBe(false);
    expect(validatePatch({ videoDurationSec: 'x' }).ok).toBe(false);
  });
});

const mk = (name: string) => ({ name, duration: 1000, render: vi.fn((r: HTMLElement) => { r.textContent = name; }) }) as Scene;
let root: HTMLElement;
const T0 = 1_700_000_000_000;
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(T0); root = document.createElement('div'); });
afterEach(() => vi.useRealTimers());

describe('Follower: agenda local, el servidor manda', () => {
  // base 6000 ms + 10 s video in cycle 0 (see D)
  const inputs = (o: object = {}) => ({ epoch: 0, sceneDurations: D, videoEveryCycles: 2, videoMode: 'full', videoClipSeconds: 21, videoDurationSec: 10, announcement: 'hola', version: 1, serverNow: 500, ...o });
  const names = ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio'];
  const scenes = () => [...names.map(mk), videoScene('/v.webm')];
  // /api/kiosk (cacheable) carries no time; the time comes from /api/time (no cache). Fixture serverNow = server time.
  const api = (k: any, version?: { version: number }) => {
    const st = { k, version: version ?? { version: k.version } };
    const f = vi.fn(async (url: string) => ({ ok: true, json: async () => {
      if (url.startsWith('/api/kiosk')) { const { serverNow, ...rest } = st.k; return rest; }
      if (url === '/api/time') return { now: st.k.serverNow };
      return st.version;
    } }));
    return { f, st };
  };
  const urls = (f: any) => f.mock.calls.map((c: any[]) => c[0]);
  const LOAD = (v: number) => ['/api/version', '/api/kiosk', '/api/time'];
  it('un solo fetch al cargar; las escenas avanzan localmente sin más pedidos', async () => {
    const { f } = api(inputs());
    const ann = new Announcement('');
    const fol = new Follower(root, scenes(), { fetchFn: f as any, clock: () => Date.now() - T0 + 500, announcement: ann, pollMs: 30_000 });
    await fol.start();
    expect(root.textContent).toBe('post');
    expect(ann.text).toBe('hola');
    await vi.advanceTimersByTimeAsync(600);
    expect(root.textContent).toBe('latestZaps');
    await vi.advanceTimersByTimeAsync(4000);
    expect(root.textContent).toBe('anuncio');
    expect(urls(f)).toEqual(LOAD(1));
  });
  it('corrige el desfase de reloj con serverNow', async () => {
    const { f } = api(inputs({ serverNow: 101_500 }));
    const fol = new Follower(root, scenes(), { fetchFn: f as any, clock: () => 7, pollMs: 30_000 });
    await fol.start();
    expect(root.className).toBe(`scene scene-${positionAt(inputs() as any, 101_500).scene}`);
    expect(root.className).not.toBe(`scene scene-${positionAt(inputs() as any, 7).scene}`);
  });
  it('cada pollMs consulta sólo /api/version; si cambió, vuelve a pedir /api/kiosk', async () => {
    const { f, st } = api(inputs());
    const fol = new Follower(root, scenes(), { fetchFn: f as any, clock: () => Date.now() - T0 + 500, pollMs: 30_000 });
    await fol.start();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(urls(f)).toEqual([...LOAD(1), '/api/time', '/api/version']); // clock re-sync on every check
    st.version = { version: 2 };
    st.k = inputs({ version: 2, epoch: 30_500 + 1000 - 6000, serverNow: 60_500 }); // admin moved the schedule
    await vi.advanceTimersByTimeAsync(30_000);
    expect(urls(f)).toEqual([...LOAD(1), '/api/time', '/api/version', '/api/time', '/api/version', '/api/kiosk']);
    expect(root.className).toBe(`scene scene-${positionAt(st.k as any, 60_500).scene}`);
  });
  it('caché viejo de /api/kiosk (versión menor que la anunciada) no rompe: se vuelve a pedir a los ~3 s', async () => {
    const { f, st } = api(inputs(), { version: 2 }); // CDN returned kiosk v1 even though version says 2
    await new Follower(root, scenes(), { fetchFn: f as any, clock: () => Date.now() - T0 + 500, pollMs: 30_000 }).start();
    st.k = inputs({ version: 2 });
    await vi.advanceTimersByTimeAsync(3_100);
    // the stale copy is re-requested ~3 s later, without waiting for the next poll
    expect(urls(f)).toEqual([...LOAD(2), '/api/kiosk']);
  });
  it('video: arranca en videoOffset + transcurrido', async () => {
    const { f } = api(inputs({ videoMode: 'clip', videoClipSeconds: 4, serverNow: 7000 }));
    await new Follower(root, scenes(), { fetchFn: f as any, clock: () => 7000, pollMs: 30_000 }).start();
    const v = root.querySelector('video')!;
    Object.defineProperty(v, 'duration', { value: 10, configurable: true });
    v.dispatchEvent(new Event('loadedmetadata'));
    const p = positionAt(inputs({ videoMode: 'clip', videoClipSeconds: 4 }) as any, 7000);
    expect(v.currentTime).toBeCloseTo(p.videoOffset! + 1, 5);
  });
  it('usa el fetch global sin cambiarle el this', async () => {
    vi.stubGlobal('fetch', function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError('Illegal invocation');
      return Promise.resolve({ ok: true, json: async () => ({ ...inputs(), now: 500 }) });
    });
    await new Follower(root, scenes(), { clock: () => 500, pollMs: 30_000 }).start();
    vi.unstubAllGlobals();
    expect(root.textContent).toBe('post');
  });
  it('error de red al cargar: no rompe y reintenta en el próximo poll', async () => {
    let fail = true;
    const f = vi.fn(async (url: string) => { if (fail) throw new Error('x'); return { ok: true, json: async () => (url.startsWith('/api/kiosk') ? inputs() : url === '/api/time' ? { now: 500 } : { version: 1 }) }; });
    await new Follower(root, scenes(), { fetchFn: f as any, clock: () => 500, pollMs: 30_000 }).start();
    expect(root.textContent).toBe('');
    fail = false;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(root.textContent).toBe('post');
  });
});

describe('re-sync de reloj y corrección de deriva del video', () => {
  it('cada chequeo re-sincroniza con /api/time quedándose con la muestra de menor RTT e ignorando outliers', async () => {
    let t = 0;
    const plan = [ // [rtt ms, server time when responding]
      [400, 1_000_000], // load: offset ≈ 1_000_000 - 200 - 0 → noisy
      [20, 1_100_000], // good sample
      [3000, 9_999_999], // outlier: huge RTT
    ];
    let i = 0;
    const f = vi.fn(async (url: string) => {
      if (url === '/api/time') { const [rtt, srv] = plan[Math.min(i++, plan.length - 1)]; t += rtt; return { ok: true, json: async () => ({ now: srv - rtt / 2 + rtt / 2 }) }; }
      return { ok: true, json: async () => (url.startsWith('/api/kiosk') ? { epoch: 0, sceneDurations: {}, videoEveryCycles: 2, videoMode: 'full', videoClipSeconds: 21, videoDurationSec: 88.4, announcement: '', version: 1 } : { version: 1 }) };
    });
    const fol = new Follower(root, [], { fetchFn: f as any, clock: () => t, pollMs: 21_000 });
    await fol.start();
    t = 50_000;
    await vi.advanceTimersByTimeAsync(21_000);
    const good = 1_100_000 - 50_010; // server time - local midpoint (50_000..50_020)
    expect(fol.clockOffset).toBe(good);
    await vi.advanceTimersByTimeAsync(21_000);
    expect(fol.clockOffset).toBe(good); // the outlier doesn't override it
    expect(f.mock.calls.filter((c: any[]) => c[0] === '/api/time')).toHaveLength(3);
  });
  const meta = (v: HTMLVideoElement, d = 88) => { Object.defineProperty(v, 'duration', { value: d, configurable: true }); v.dispatchEvent(new Event('loadedmetadata')); };
  const run = (expected: number) => {
    const e = { v: expected };
    videoScene('/v.webm').render(root, vi.fn(), { elapsedMs: expected * 1000, expectedSec: () => e.v });
    const v = root.querySelector('video')!;
    meta(v);
    return { v, e };
  };
  it('deriva chica (>0,25 s): ajusta playbackRate suave (0,95–1,05); deriva mínima: 1', () => {
    const { v } = run(10);
    v.currentTime = 9.5; // behind
    vi.advanceTimersByTime(1000);
    expect(v.playbackRate).toBeGreaterThan(1);
    expect(v.playbackRate).toBeLessThanOrEqual(1.05);
    v.currentTime = 10.5; // ahead
    vi.advanceTimersByTime(1000);
    expect(v.playbackRate).toBeLessThan(1);
    expect(v.playbackRate).toBeGreaterThanOrEqual(0.95);
    v.currentTime = 10.1;
    vi.advanceTimersByTime(1000);
    expect(v.playbackRate).toBe(1);
  });
  it('deriva grande (>1,5 s): salto directo a la posición esperada', () => {
    const { v, e } = run(10);
    e.v = 20; v.currentTime = 12;
    vi.advanceTimersByTime(1000);
    expect(v.currentTime).toBe(20);
    expect(v.playbackRate).toBe(1);
  });
  it('sin expectedSec (uso normal) no toca la reproducción', () => {
    videoScene('/v.webm').render(root, vi.fn());
    const v = root.querySelector('video')!;
    meta(v); v.currentTime = 5;
    vi.advanceTimersByTime(3000);
    expect([v.currentTime, v.playbackRate]).toEqual([5, 1]);
  });
  it('el Follower le pasa al video la posición esperada según el reloj corregido', async () => {
    let t = 7000;
    const inputs = { epoch: 0, sceneDurations: D, videoEveryCycles: 2, videoMode: 'full', videoClipSeconds: 21, videoDurationSec: 10, announcement: '', version: 1 };
    const f = vi.fn(async (url: string) => ({ ok: true, json: async () => (url === '/api/time' ? { now: t } : url.startsWith('/api/kiosk') ? inputs : { version: 1 }) }));
    const names = ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio'];
    await new Follower(root, [...names.map(mk), videoScene('/v.webm')], { fetchFn: f as any, clock: () => t, pollMs: 21_000 }).start();
    const v = root.querySelector('video')!;
    meta(v, 10);
    expect(v.currentTime).toBe(1);
    t = 9000; v.currentTime = 0.5; // expected 3 s → jump
    vi.advanceTimersByTime(1000);
    expect(v.currentTime).toBe(3);
  });
});
