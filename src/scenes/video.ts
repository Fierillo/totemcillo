import type { Scene } from '../rotator';
import { esc } from '../util';

export const EMPTY_VIDEO = 'Sin video configurado';

/** Escena de video: pantalla completa, mudo, en loop. */
export function videoScene(src: string, duration: number): Scene {
  return {
    name: 'video',
    duration,
    render(root) {
      if (!src) {
        root.innerHTML = `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">${EMPTY_VIDEO}</p>`;
        return;
      }
      root.innerHTML = `<video class="scene-video-el" src="${esc(src)}" autoplay muted loop playsinline preload="auto"></video>`;
      const v = root.querySelector('video')!;
      v.muted = true;
      void v.play?.()?.catch?.(() => {});
      return () => { v.pause(); v.removeAttribute('src'); v.load?.(); };
    },
  };
}
