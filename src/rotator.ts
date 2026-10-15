export interface Scene {
  name: string;
  /** Duration in ms */
  duration: number;
  /** If true, the scene doesn't use `duration`: it ends when it calls `done`. */
  untilDone?: boolean;
  /** If > 1, the automatic rotation only shows it once every N cycles (arrows always reach it). */
  everyCycles?: number;
  /** Video scene: mode and clip length (s). */
  videoMode?: 'full' | 'clip';
  clipSeconds?: number;
  /** Draws the scene (including its empty state); returns the cleanup. */
  render: (root: HTMLElement, done?: () => void, ctx?: RenderContext) => void | (() => void);
}

/** Data to start a scene midway (video: seconds already elapsed). */
export interface RenderContext { elapsedMs?: number; clipStart?: number; onClipStart?: (sec: number) => void;
  /** Position (s) where the video should be per the server clock; enables drift correction. */
  expectedSec?: () => number }

/** Rotates through every scene, in order, without skipping any. */
export class Rotator {
  private idx = -1;
  private token = 0;
  private cycle = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: (() => void) | void = undefined;

  constructor(private root: HTMLElement, private scenes: Scene[]) {}

  start() { this.show(0); }

  /** Changes the duration of scenes with that name (applies from the next time they show). */
  setDuration(name: string, ms: number) {
    for (const s of this.scenes) if (s.name === name) s.duration = ms;
  }

  /** Changes how many cycles between appearances of scenes with that name. */
  setEveryCycles(name: string, n: number) {
    for (const s of this.scenes) if (s.name === name) s.everyCycles = n;
  }

  setVideoMode(name: string, mode: 'full' | 'clip') {
    for (const s of this.scenes) if (s.name === name) s.videoMode = mode;
  }

  setClipSeconds(name: string, sec: number) {
    for (const s of this.scenes) if (s.name === name) s.clipSeconds = sec;
  }

  stop() {
    this.token++;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.runCleanup();
  }

  /** Next distinct scene (skips the rest of the block with the same name); restarts the timer. */
  next() {
    const n = this.scenes.length;
    if (!n) return;
    const name = this.scenes[this.idx]?.name;
    for (let k = 1; k < n; k++) {
      const i = this.wrap(this.idx + k);
      if (this.scenes[i].name !== name) return this.show(i);
    }
    this.show(this.wrap(this.idx + 1));
  }

  /** Start of the previous scene block; restarts the timer. */
  prev() {
    const n = this.scenes.length;
    if (!n) return;
    const start = this.blockStart(this.idx);
    if (start === null) return this.show(this.wrap(this.idx - 1));
    this.show(this.blockStart(this.wrap(start - 1)) ?? this.wrap(start - 1));
  }

  /** First index of the contiguous block (same name) containing i; null if all share a name. */
  private blockStart(i: number): number | null {
    const n = this.scenes.length;
    const name = this.scenes[i].name;
    for (let k = 1; k < n; k++) {
      if (this.scenes[this.wrap(i - k)].name !== name) return this.wrap(i - k + 1);
    }
    return null;
  }

  private wrap(i: number) {
    const n = this.scenes.length;
    return ((i % n) + n) % n;
  }

  private show(i: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.runCleanup();
    if (!this.scenes.length) return;
    this.idx = i;
    const scene = this.scenes[i];
    this.root.className = `scene scene-${scene.name}`;
    this.root.innerHTML = '';
    const token = ++this.token;
    const advance = () => { if (token === this.token) this.show(this.autoNext()); };
    this.cleanup = scene.render(this.root, advance);
    if (!scene.untilDone) this.timer = setTimeout(advance, scene.duration);
  }

  /** Next index of the automatic rotation, skipping scenes not due this cycle. */
  private autoNext(): number {
    const n = this.scenes.length;
    let i = this.idx;
    for (let k = 0; k < n; k++) {
      i = this.wrap(i + 1);
      if (i === 0) this.cycle++;
      const every = this.scenes[i].everyCycles ?? 1;
      if (every <= 1 || this.cycle % every === 0) return i;
    }
    return this.wrap(this.idx + 1);
  }

  private runCleanup() { this.cleanup?.(); this.cleanup = undefined; }
}
