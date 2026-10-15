import type { Scene } from '../rotator';
import type { Announcement } from '../announcement';
import { fitRegions } from '../fit';
import { esc } from '../util';
import { appQr } from './post';

export const EMPTY_ANUNCIO = 'Sin anuncios por ahora';

/** Escena especial "Anuncio": la edita el admin. Siempre en rotación (vacía muestra un estado vacío). */
export function anuncioScene(ann: Announcement, duration: number, publicUrl?: string): Scene {
  return {
    name: 'anuncio',
    duration,
    render(root) {
      const draw = () => {
        root.innerHTML = `<h1>📣 Anuncio</h1>` + (ann.text
          ? `<p class="anuncio-msg" data-fit="text" data-max="9" data-min="18">${esc(ann.text)}</p>`
          : `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">${EMPTY_ANUNCIO}</p>`) + (publicUrl ? appQr(publicUrl) : '');
        fitRegions(root);
      };
      draw();
      const off = ann.onChange(draw);
      window.addEventListener('resize', draw);
      return () => { off(); window.removeEventListener('resize', draw); };
    },
  };
}
