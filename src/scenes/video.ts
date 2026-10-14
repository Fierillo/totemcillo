import type { Scene } from '../rotator';
import { esc } from '../util';

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
    render(root, done = () => {}) {
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
      const clip = scene.videoMode === 'clip' ? scene.clipSeconds ?? clipSeconds : 0;
      const onMeta = () => {
        const d = v.duration;
        if (!clip || end !== null || !Number.isFinite(d) || d <= clip) return;
        const start = random() * (d - clip);
        end = start + clip;
        try { v.currentTime = start; } catch { /* ignorar */ }
        later(clip * 1000);
      };
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
        v.pause();
        v.removeAttribute('src');
        v.load?.();
      };
    },
  };
  return scene;
}
