import type { Scene } from '../rotator';
import { esc } from '../util';

export const EMPTY_VIDEO = 'Sin video configurado';
export interface VideoOptions { errorDelayMs?: number; startTimeoutMs?: number; everyCycles?: number }

/** Escena de video: pantalla completa y mudo, una vez desde 0; avisa `done` al terminar (o si falla). */
export function videoScene(src: string, { errorDelayMs = 2000, startTimeoutMs = 10000, everyCycles = 2 }: VideoOptions = {}): Scene {
  return {
    name: 'video',
    duration: 0,
    untilDone: true,
    everyCycles,
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
      v.addEventListener('timeupdate', () => { if (v.currentTime > 0) clearTimeout(startTimer); });
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
}
