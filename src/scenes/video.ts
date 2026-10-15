import type { Scene } from '../rotator';
import { esc } from '../util';

/** Corrección de deriva: tolerancia y salto (s), velocidades límite y cada cuánto se mide (ms). */
export const DRIFT = { tolerance: 0.25, seek: 1.5, minRate: 0.95, maxRate: 1.05, everyMs: 1000 };

export const EMPTY_VIDEO = 'Sin video configurado';
export type VideoMode = 'full' | 'clip';
export interface VideoOptions {
  errorDelayMs?: number; startTimeoutMs?: number; everyCycles?: number;
  /** full: entero desde 0; clip: `clipSeconds` desde un punto al azar. */
  mode?: VideoMode; clipSeconds?: number; random?: () => number;
}

/** Escena de video: pantalla completa y mudo, una vez desde 0; avisa `done` al terminar (o si falla). */
export function videoScene(src: string, { errorDelayMs = 2000, startTimeoutMs = 10000, everyCycles = 2, mode = 'full', clipSeconds = 21, random = Math.random }: VideoOptions = {}): Scene {
  const scene: Scene = {
    name: 'video',
    duration: 0,
    untilDone: true,
    everyCycles,
    videoMode: mode,
    clipSeconds,
    render(root, done = () => {}, ctx = {}) {
      let finished = false;
      const timers: ReturnType<typeof setTimeout>[] = [];
      const finish = () => { if (!finished) { finished = true; timers.forEach(clearTimeout); done(); } };
      const later = (ms: number) => timers.push(setTimeout(finish, ms));
      if (!src) {
        root.innerHTML = `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">${EMPTY_VIDEO}</p>`;
        later(errorDelayMs);
        return () => { finished = true; timers.forEach(clearTimeout); };
      }
      root.innerHTML = `<video class="scene-video-el" src="${esc(src)}" autoplay muted playsinline preload="auto"></video>`;
      const v = root.querySelector('video')!;
      v.muted = true;
      v.loop = false;
      try { v.currentTime = 0; } catch { /* sin metadata todavía */ }
      const startTimer = setTimeout(finish, startTimeoutMs);
      timers.push(startTimer);
      let end: number | null = null;
      let metaDone = false;
      const clip = scene.videoMode === 'clip' ? scene.clipSeconds ?? clipSeconds : 0;
      const off = Math.max(0, (ctx.elapsedMs ?? 0) / 1000);
      const onMeta = () => {
        const d = v.duration;
        if (metaDone || !Number.isFinite(d)) return;
        metaDone = true;
        if (clip && d > clip) {
          const c = ctx.clipStart;
          const resumed = c !== undefined && c >= 0 && c <= d - clip;
          const start = resumed ? c : random() * (d - clip);
          if (!resumed) ctx.onClipStart?.(start);
          if (off >= clip) return finish();
          end = start + clip;
          try { v.currentTime = start + off; } catch { /* ignorar */ }
          later((clip - off) * 1000);
        } else if (off > 0) {
          if (off >= d) return finish();
          try { v.currentTime = off; } catch { /* ignorar */ }
        }
      };
      // Deriva vs. el reloj del servidor (sin red): ajuste suave de velocidad o salto si es grande.
      let sync: ReturnType<typeof setInterval> | null = null;
      if (ctx.expectedSec) {
        sync = setInterval(() => {
          const d = v.duration;
          const exp = ctx.expectedSec!();
          if (!metaDone || finished || !Number.isFinite(d) || exp < 0 || exp >= d) return;
          const drift = v.currentTime - exp;
          if (Math.abs(drift) > DRIFT.seek) { try { v.currentTime = exp; } catch { /* ignorar */ } v.playbackRate = 1; }
          else if (Math.abs(drift) > DRIFT.tolerance) v.playbackRate = Math.min(DRIFT.maxRate, Math.max(DRIFT.minRate, 1 - drift * 0.1));
          else v.playbackRate = 1;
        }, DRIFT.everyMs);
      }
      v.addEventListener('loadedmetadata', onMeta);
      if (v.readyState >= 1) onMeta();
      v.addEventListener('timeupdate', () => {
        if (v.currentTime > 0) clearTimeout(startTimer);
        if (end !== null && v.currentTime >= end) finish();
      });
      v.addEventListener('ended', finish);
      v.addEventListener('error', () => later(errorDelayMs));
      void v.play?.()?.catch?.(() => {});
      return () => {
        finished = true;
        timers.forEach(clearTimeout);
        if (sync) clearInterval(sync);
        v.pause();
        v.removeAttribute('src');
        v.load?.();
      };
    },
  };
  return scene;
}
