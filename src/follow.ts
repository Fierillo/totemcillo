import type { Scene } from './scenes/types';
import type { Announcement } from './announcement';
import type { Moderation } from './nostr/store';
import { moderationOf } from './moderation-lists';
import { positionAt, type ScheduleInputs } from '../shared/schedule';

export interface KioskInputs extends ScheduleInputs { announcement?: string; version: number; hiddenPosts?: string[]; bannedPubkeys?: string[]; zapProviders?: string[]; startLine?: string }
export interface FollowerOptions { fetchFn?: typeof fetch; clock?: () => number; announcement?: Announcement; pollMs?: number;
  /** Delay before re-requesting a kiosk older than /api/version announced (default 3 s). */
  staleRetryMs?: number;
  /** Moderation lists that come in /api/kiosk. */
  onModeration?: (m: Moderation) => void }

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const valid = (k: any): k is KioskInputs =>
  !!k && num(k.epoch) && num(k.version) && !!k.sceneDurations && typeof k.sceneDurations === 'object' &&
  num(k.videoEveryCycles) && k.videoEveryCycles >= 1 && num(k.videoClipSeconds) && num(k.videoDurationSec) && (k.videoMode === 'full' || k.videoMode === 'clip');

/**
 * The totem follows the server schedule: it fetches it once (/api/kiosk), computes scenes locally
 * (same function as the server, with clock correction) and every `pollMs` only checks /api/version.
 */
export class Follower {
  private inputs: KioskInputs | null = null;
  private offset = 0;
  /** Latest clock samples [rtt, offset]; the one with the lowest RTT is used. */
  private samples: [number, number][] = [];
  private key = '';
  private cleanup: (() => void) | void = undefined;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private poller: ReturnType<typeof setInterval> | null = null;
  private fetchFn: typeof fetch;
  private clock: () => number;

  constructor(private root: HTMLElement, private scenes: Scene[], private o: FollowerOptions = {}) {
    this.fetchFn = o.fetchFn ?? ((i, init) => fetch(i, init));
    this.clock = o.clock ?? Date.now;
  }

  private async getJson(url: string): Promise<any> {
    const res = await this.fetchFn(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  /**
   * Fetches the schedule inputs and re-syncs the clock.
   * /api/version and /api/kiosk may come from the CDN (up to ~10 s old). Both are requested without a query (the
   * server redirects any query, so it can't bust the cache); a kiosk older than the announced version is applied and
   * re-requested shortly after. The time comes from /api/time, which is never cached (precision ~RTT/2).
   */
  async load(knownVersion?: number, sync = true): Promise<void> {
    try {
      const version = knownVersion ?? (await this.getJson('/api/version'))?.version;
      if (!num(version)) return;
      const k = await this.getJson('/api/kiosk');
      if (!valid(k)) return;
      if (sync && !(await this.syncTime()) && !this.samples.length) return;
      this.inputs = k;
      if (typeof k.announcement === 'string') this.o.announcement?.set(k.announcement);
      this.o.onModeration?.(moderationOf(k));
      this.tick();
      if (k.version < version) this.retryStale(version);
    } catch { /* no network: retried on the next check */ }
  }

  private staleTimer: ReturnType<typeof setTimeout> | null = null;
  /** CDN still had the previous kiosk: try again soon (its cache lives ~5-10 s). */
  private retryStale(version: number) {
    if (this.staleTimer) return;
    this.staleTimer = setTimeout(() => { this.staleTimer = null; void this.load(version, false); }, this.o.staleRetryMs ?? 3000);
  }

  get clockOffset() { return this.offset; }

  /**
   * One /api/time sample (no cache, no Redis). offset = server time - local midpoint of the request.
   * Keeps the last 5 samples and uses the lowest RTT; samples with RTT > 1 s are discarded (except the first).
   */
  private async syncTime(): Promise<boolean> {
    try {
      const t0 = this.clock();
      const t = await this.getJson('/api/time');
      const t1 = this.clock();
      if (!num(t?.now)) return false;
      const rtt = t1 - t0;
      if (rtt > 1000 && this.samples.length) return false;
      this.samples = [...this.samples, [rtt, t.now - (t0 + t1) / 2] as [number, number]].slice(-5);
      this.offset = this.samples.reduce((a, b) => (b[0] < a[0] ? b : a))[1];
      return true;
    } catch { return false; }
  }

  /** Periodic check: clock re-sync and, if the version changed (or never loaded), reload. */
  async check(): Promise<void> {
    try {
      if (!this.inputs) return this.load();
      await this.syncTime();
      const v = await this.getJson('/api/version');
      if (num(v?.version) && v.version !== this.inputs.version) await this.load(v.version, false);
    } catch { /* ignore */ }
  }

  private now() { return this.clock() + this.offset; }

  private tick() {
    if (!this.inputs) return;
    if (this.timer) clearTimeout(this.timer);
    const p = positionAt(this.inputs, this.now());
    this.timer = setTimeout(() => this.tick(), Math.max(0, p.sceneEndsAt - this.now()) + 20);
    const key = `${p.cycle}:${p.index}:${p.sceneStartedAt}`;
    const scene = this.scenes[p.index];
    if (key === this.key || !scene || scene.name !== p.scene) return;
    this.key = key;
    this.cleanup?.();
    this.root.className = `scene scene-${scene.name}`;
    this.root.innerHTML = '';
    const elapsedMs = Math.max(0, this.now() - p.sceneStartedAt);
    // The schedule already fixed segment and length: the video only seeks to the position (offset + elapsed).
    const posMs = () => (p.videoOffset ?? 0) * 1000 + this.now() - p.sceneStartedAt;
    this.cleanup = scene.render(this.root, { elapsedMs: (p.videoOffset ?? 0) * 1000 + elapsedMs, expectedSec: () => posMs() / 1000 });
  }

  async start(): Promise<void> {
    this.poller = setInterval(() => void this.check(), this.o.pollMs ?? 21_000);
    await this.load();
  }

  stop() {
    if (this.poller) clearInterval(this.poller);
    if (this.staleTimer) clearTimeout(this.staleTimer);
    if (this.timer) clearTimeout(this.timer);
    this.cleanup?.();
  }
}
