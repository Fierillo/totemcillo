import type { Scene } from './scenes/types';
import type { Announcement } from './announcement';
import type { Moderation } from './nostr/store';
import { moderationOf } from './moderation-lists';
import { positionAt, shiftSchedule, type ScheduleInputs } from '../shared/schedule';
import type { Action } from '../shared/settings';

interface KioskInputs extends ScheduleInputs { announcement?: string; version: number; hiddenPosts?: string[]; bannedPubkeys?: string[]; zapProviders?: string[]; startLine?: string }
interface FollowerOptions { fetchFn?: typeof fetch; clock?: () => number; announcement?: Announcement; pollMs?: number;
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
  /** Dev arrows: local time shift onto the chosen scene; while paused the clock doesn't advance the rotation. */
  private shift = 0;
  paused = false;

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

  private now() { return this.clock() + this.offset + this.shift; }

  /** Dev only, this screen only (nothing is written to the server): shows the previous/next scene of the rotation and stops following the clock. */
  step(action: Action, pause = true) {
    if (!this.inputs) return;
    // Same target as the /admin arrows: shifting epoch back by Δ equals looking Δ ahead in time.
    this.shift += (this.inputs.epoch ?? 0) - shiftSchedule(this.inputs, this.now(), action).epoch!; // shiftSchedule always sets epoch
    this.paused = pause;
    this.tick();
  }

  /** Keyboard: jumps (this screen only) to the next occurrence of scene `index`; the rotation keeps going from there. */
  show(index: number) {
    if (!this.inputs || !this.scenes[index]) return;
    for (let i = 0; i < this.scenes.length * 4 && positionAt(this.inputs, this.now()).index !== index; i++)
      this.shift += (this.inputs.epoch ?? 0) - shiftSchedule(this.inputs, this.now(), 'next').epoch!;
    this.tick();
  }

  /** Back to the scene the clock says now. */
  resume() {
    this.shift = 0;
    this.paused = false;
    this.tick();
  }

  private tick() {
    if (!this.inputs) return;
    if (this.timer) clearTimeout(this.timer);
    const p = positionAt(this.inputs, this.now());
    if (!this.paused) this.timer = setTimeout(() => this.tick(), Math.max(0, p.sceneEndsAt - this.now()) + 20);
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

/** Totem keyboard: ArrowRight/ArrowLeft = next/previous scene, 1..N = that scene, f = fullscreen (ignored with modifiers or while typing). */
export function sceneKeys(doc: Document, follower: Follower): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    if ((e.target as Element | null)?.closest?.('input, textarea, select, [contenteditable]')) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') follower.step(e.key === 'ArrowRight' ? 'next' : 'prev', false);
    else if (/^[1-9]$/.test(e.key)) follower.show(Number(e.key) - 1);
    else if (e.key === 'f' || e.key === 'F') toggleFullscreen(doc);
  };
  doc.addEventListener('keydown', onKey);
  return () => doc.removeEventListener('keydown', onKey);
}

type FsDoc = Document & { webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void; webkitFullscreenEnabled?: boolean };
type FsEl = HTMLElement & { webkitRequestFullscreen?: () => void };
const fsElement = (d: FsDoc) => d.fullscreenElement ?? d.webkitFullscreenElement ?? null;

/** Enters/leaves fullscreen with the standard API, webkit-prefixed fallback (older Safari/Android). */
export function toggleFullscreen(doc: Document): void {
  const d = doc as FsDoc, el = d.documentElement as FsEl;
  if (fsElement(d)) void (d.exitFullscreen ? d.exitFullscreen().catch(() => {}) : d.webkitExitFullscreen?.());
  else void (el.requestFullscreen ? el.requestFullscreen().catch(() => {}) : el.webkitRequestFullscreen?.());
}

const FS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>';

/** Discreet fullscreen toggle appended to `parent`; null (no button) when the Fullscreen API is unsupported. */
export function fullscreenButton(doc: Document, parent: Element): HTMLButtonElement | null {
  const d = doc as FsDoc, el = d.documentElement as FsEl;
  if (!el.requestFullscreen && !el.webkitRequestFullscreen) return null;
  const btn = doc.createElement('button');
  btn.type = 'button';
  btn.className = 'fs-toggle';
  btn.innerHTML = FS_ICON;
  const sync = () => { const label = fsElement(d) ? 'Salir de pantalla completa' : 'Pantalla completa'; btn.setAttribute('aria-label', label); btn.title = label; };
  sync();
  doc.addEventListener('fullscreenchange', sync);
  doc.addEventListener('webkitfullscreenchange', sync);
  btn.addEventListener('click', () => toggleFullscreen(doc));
  parent.append(btn);
  return btn;
}
