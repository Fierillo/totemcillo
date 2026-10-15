export interface Scene {
  name: string;
  /** Duración en ms */
  duration: number;
  /** Si es true, la escena no usa `duration`: termina cuando llama a `done`. */
  untilDone?: boolean;
  /** Si es > 1, la rotación automática la muestra sólo una de cada N vueltas (las flechas siempre llegan). */
  everyCycles?: number;
  /** Escena de video: modo y largo del clip (s). */
  videoMode?: 'full' | 'clip';
  clipSeconds?: number;
  /** Dibuja la escena (incluido su estado vacío); devuelve la limpieza. */
  render: (root: HTMLElement, done?: () => void, ctx?: RenderContext) => void | (() => void);
}

/** Datos para arrancar una escena a mitad (video: segundos ya transcurridos). */
export interface RenderContext { elapsedMs?: number; clipStart?: number; onClipStart?: (sec: number) => void;
  /** Posición (s) en que debería estar el video según el reloj del servidor; activa la corrección de deriva. */
  expectedSec?: () => number }

/** Rota por todas las escenas, en orden, sin saltear ninguna. */
export class Rotator {
  private idx = -1;
  private token = 0;
  private cycle = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private cleanup: (() => void) | void = undefined;

  constructor(private root: HTMLElement, private scenes: Scene[]) {}

  start() { this.show(0); }

  /** Cambia la duración de las escenas con ese nombre (rige desde la próxima vez que se muestren). */
  setDuration(name: string, ms: number) {
    for (const s of this.scenes) if (s.name === name) s.duration = ms;
  }

  /** Cambia cada cuántas vueltas aparecen las escenas con ese nombre. */
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
    const token = ++this.token;
    const advance = () => { if (token === this.token) this.show(this.autoNext()); };
    this.cleanup = scene.render(this.root, advance);
    if (!scene.untilDone) this.timer = setTimeout(advance, scene.duration);
  }

  /** Próximo índice de la rotación automática, salteando escenas que no tocan en esta vuelta. */
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
