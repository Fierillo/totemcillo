import type { Scene } from './types';
import { esc } from '../util';

/** Drift correction: tolerance and jump (s), rate limits and measurement interval (ms). */
const DRIFT = { tolerance: 0.25, seek: 1.5, minRate: 0.95, maxRate: 1.05, everyMs: 1000 };
export const EMPTY_VIDEO = 'Sin video configurado';

/** Playback only: the shared schedule owns clip selection and all scene transitions. */
export function videoScene(src: string): Scene {
  return {
    name: 'video',
    render(root, ctx = {}) {
      if (!src) {
        root.innerHTML = `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">${EMPTY_VIDEO}</p>`;
        return;
      }
      root.innerHTML = `<video class="scene-video-el" src="${esc(src)}" autoplay muted playsinline preload="auto"></video>`;
      const v = root.querySelector('video')!;
      v.muted = true;
      v.loop = false;
      let ready = false;
      const onMeta = () => {
        if (ready || !Number.isFinite(v.duration)) return;
        ready = true;
        const sec = Math.max(0, (ctx.elapsedMs ?? 0) / 1000);
        if (sec < v.duration) { try { v.currentTime = sec; } catch { /* ignore */ } }
      };
      v.addEventListener('loadedmetadata', onMeta);
      if (v.readyState >= 1) onMeta();
      const sync = ctx.expectedSec ? setInterval(() => {
        const exp = ctx.expectedSec!();
        if (!ready || exp < 0 || exp >= v.duration) return;
        const drift = v.currentTime - exp;
        if (Math.abs(drift) > DRIFT.seek) { try { v.currentTime = exp; } catch { /* ignore */ } v.playbackRate = 1; }
        else if (Math.abs(drift) > DRIFT.tolerance) v.playbackRate = Math.min(DRIFT.maxRate, Math.max(DRIFT.minRate, 1 - drift * 0.1));
        else v.playbackRate = 1;
      }, DRIFT.everyMs) : null;
      void v.play?.()?.catch?.(() => {});
      return () => {
        if (sync) clearInterval(sync);
        v.removeEventListener('loadedmetadata', onMeta);
        v.pause();
        v.removeAttribute('src');
        v.load?.();
      };
    },
  };
}
