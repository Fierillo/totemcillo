import type { Scene } from './rotator';
import type { Announcement } from './announcement';
import { positionAt, type ScheduleInputs } from '../shared/schedule';

export interface KioskInputs extends ScheduleInputs { announcement?: string; version: number }
export interface FollowerOptions { fetchFn?: typeof fetch; clock?: () => number; announcement?: Announcement; pollMs?: number }

const num = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const valid = (k: any): k is KioskInputs =>
  !!k && num(k.epoch) && num(k.version) && !!k.sceneDurations && typeof k.sceneDurations === 'object' &&
  num(k.videoEveryCycles) && k.videoEveryCycles >= 1 && num(k.videoClipSeconds) && num(k.videoDurationSec) && (k.videoMode === 'full' || k.videoMode === 'clip');

/**
 * El tótem sigue la agenda del servidor: la pide una vez (/api/kiosk), calcula las escenas localmente
 * (misma función que el servidor, con corrección de reloj) y cada `pollMs` mira sólo /api/version.
 */
export class Follower {
  private inputs: KioskInputs | null = null;
  private offset = 0;
  /** Últimas muestras de reloj [rtt, offset]; se usa la de menor RTT. */
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
   * Trae las entradas de la agenda y re-sincroniza el reloj.
   * /api/version y /api/kiosk pueden venir del CDN (hasta ~10 s viejos): por eso kiosk se pide con ?v=<version>
   * (otra clave de caché por versión) y la hora sale de /api/time, que nunca se cachea (precisión ~RTT/2).
   */
  async load(knownVersion?: number, sync = true): Promise<void> {
    try {
      const version = knownVersion ?? (await this.getJson('/api/version'))?.version;
      if (!num(version)) return;
      const k = await this.getJson(`/api/kiosk?v=${version}`);
      if (!valid(k)) return;
      if (sync && !(await this.syncTime()) && !this.samples.length) return;
      this.inputs = k;
      if (typeof k.announcement === 'string') this.o.announcement?.set(k.announcement);
      this.tick();
    } catch { /* sin red: se reintenta en el próximo chequeo */ }
  }

  get clockOffset() { return this.offset; }

  /**
   * Una muestra de /api/time (sin caché ni Redis). offset = hora servidor - punto medio local del pedido.
   * Se guardan las últimas 5 muestras y se usa la de menor RTT; muestras con RTT > 1 s se descartan (salvo la primera).
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

  /** Chequeo periódico: re-sync de reloj y, si cambió la versión (o nunca cargó), recarga. */
  async check(): Promise<void> {
    try {
      if (!this.inputs) return this.load();
      await this.syncTime();
      const v = await this.getJson('/api/version');
      if (num(v?.version) && v.version !== this.inputs.version) await this.load(v.version, false);
    } catch { /* ignorar */ }
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
    // La agenda ya fijó tramo y largo: el video sólo busca la posición (offset + transcurrido).
    if (scene.videoMode) scene.videoMode = 'full';
    const posMs = () => (p.videoOffset ?? 0) * 1000 + this.now() - p.sceneStartedAt;
    this.cleanup = scene.render(this.root, () => {}, { elapsedMs: (p.videoOffset ?? 0) * 1000 + elapsedMs, expectedSec: () => posMs() / 1000 });
  }

  async start(): Promise<void> {
    this.poller = setInterval(() => void this.check(), this.o.pollMs ?? 21_000);
    await this.load();
  }

  stop() {
    if (this.poller) clearInterval(this.poller);
    if (this.timer) clearTimeout(this.timer);
    this.cleanup?.();
  }
}
