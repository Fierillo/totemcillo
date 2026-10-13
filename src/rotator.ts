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

  start() { this.show(0); }

  stop() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.runCleanup();
  }

  /** Siguiente escena distinta (saltea el resto del bloque con el mismo nombre); reinicia el timer. */
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

  /** Inicio del bloque de escenas anterior; reinicia el timer. */
  prev() {
    const n = this.scenes.length;
    if (!n) return;
    const start = this.blockStart(this.idx);
    if (start === null) return this.show(this.wrap(this.idx - 1));
    this.show(this.blockStart(this.wrap(start - 1)) ?? this.wrap(start - 1));
  }

  /** Primer índice del bloque contiguo (mismo nombre) que contiene i; null si todas se llaman igual. */
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
    this.cleanup = scene.render(this.root);
    this.timer = setTimeout(() => this.show(this.wrap(this.idx + 1)), scene.duration);
  }

  private runCleanup() { this.cleanup?.(); this.cleanup = undefined; }
}
