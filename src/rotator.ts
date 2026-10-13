export interface Scene {
  name: string;
  /** Duración en ms */
  duration: number;
  /** Si devuelve false se saltea (p.ej. no hay datos). */
  ready?: () => boolean;
  render: (root: HTMLElement) => void | (() => void);
}

export const WAIT_MS = 3000;

/** Rota escenas automáticamente. */
export class Rotator {
  private idx = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: (() => void) | void = undefined;

  constructor(private root: HTMLElement, private scenes: Scene[]) {}

  start() { this.next(); }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.runCleanup();
  }

  /** Escena siguiente (reinicia el timer). */
  next() { this.go(1); }

  /** Escena anterior (reinicia el timer). */
  prev() { this.go(-1); }

  private go(dir: 1 | -1) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.runCleanup();
    const i = this.readyIndex(dir);
    if (i < 0) return this.waiting();
    this.idx = i;
    const scene = this.scenes[i];
    this.root.className = `scene scene-${scene.name}`;
    this.root.innerHTML = '';
    this.cleanup = scene.render(this.root);
    this.schedule(scene.duration);
  }

  private readyIndex(dir: 1 | -1) {
    const n = this.scenes.length;
    for (let k = 1; k <= n; k++) {
      const i = (((this.idx + dir * k) % n) + n) % n;
      const s = this.scenes[i];
      if (!s.ready || s.ready()) return i;
    }
    return -1;
  }

  private waiting() {
    this.root.className = 'scene';
    this.root.innerHTML = '<div class="empty">Esperando notas con #lacrypta y #labitconf…</div>';
    this.schedule(WAIT_MS);
  }

  private schedule(ms: number) { this.timer = setTimeout(() => this.next(), ms); }

  private runCleanup() { this.cleanup?.(); this.cleanup = undefined; }
}
