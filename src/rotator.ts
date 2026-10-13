export interface Scene {
  name: string;
  /** Duración en ms */
  duration: number;
  /** Dibuja la escena (incluido su estado vacío); devuelve la limpieza. */
  render: (root: HTMLElement) => void | (() => void);
}

/** Rota por todas las escenas, en orden, sin saltear ninguna. */
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
    const n = this.scenes.length;
    if (!n) return;
    this.idx = (((this.idx + dir) % n) + n) % n;
    const scene = this.scenes[this.idx];
    this.root.className = `scene scene-${scene.name}`;
    this.root.innerHTML = '';
    this.cleanup = scene.render(this.root);
    this.timer = setTimeout(() => this.next(), scene.duration);
  }

  private runCleanup() { this.cleanup?.(); this.cleanup = undefined; }
}
