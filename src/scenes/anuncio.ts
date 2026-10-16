import type { Scene } from './types';
import type { Announcement } from '../announcement';
import { fitRegions } from '../fit';
import { esc } from '../util';
import { appQr } from './post';

export const EMPTY_ANUNCIO = 'Sin anuncios por ahora';

/** Special "Anuncio" scene: edited by the admin. Always in rotation (shows an empty state when empty). */
export function anuncioScene(ann: Announcement, publicUrl?: string): Scene {
  return {
    name: 'anuncio',
    render(root) {
      const draw = () => {
        root.innerHTML = `<h1>📣 Anuncio</h1>` + (ann.text
          ? `<p class="anuncio-msg" data-fit="text" data-max="9" data-min="18">${esc(ann.text)}</p>`
          : `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">${EMPTY_ANUNCIO}</p>`) + (publicUrl ? appQr(publicUrl) : '');
        const heading = root.querySelector('h1')!;
        root.style.setProperty('--announcement-heading', `${heading.offsetHeight + (parseFloat(getComputedStyle(heading).marginBottom) || 0)}px`);
        fitRegions(root);
      };
      draw();
      const off = ann.onChange(draw);
      window.addEventListener('resize', draw);
      return () => { off(); window.removeEventListener('resize', draw); };
    },
  };
}
