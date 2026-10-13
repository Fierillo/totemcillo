export interface Scene {
  name: string;
  /** Duración en ms */
  duration: number;
  /** Si devuelve false se saltea (p.ej. no hay datos). */
  ready?: () => boolean;
  render: (root: HTMLElement) => void | (() => void);
}

/** Rota escenas automáticamente. */
export class Rotator {
  private idx = -1;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: (() => void) | void = undefined;

  constructor(private root: HTMLElement, private scenes: Scene[]) {}

  start() { this.next(); }
  stop() { if (this.timer) clearTimeout(this.timer); this.cleanup?.(); }

  next() {
    this.cleanup?.();
    const n = this.scenes.length;
    let scene: Scene | undefined;
    for (let i = 1; i <= n; i++) {
      const s = this.scenes[(this.idx + i) % n];
      if (!s.ready || s.ready()) { this.idx = (this.idx + i) % n; scene = s; break; }
    }
    if (!scene) {
      this.root.innerHTML = '<div class="empty">Esperando notas con #lacrypta y #labitconf…</div>';
      this.timer = setTimeout(() => this.next(), 3000);
      return;
    }
    this.root.className = `scene scene-${scene.name}`;
    this.root.innerHTML = '';
    this.cleanup = scene.render(this.root);
    this.timer = setTimeout(() => this.next(), scene.duration);
  }
}
