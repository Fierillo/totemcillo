import type { Scene } from '../rotator';
import type { ZapStore } from '../nostr/store';
import { fitRegions } from '../fit';
import { live } from './live';
import { esc, sats, shortKey } from '../util';

export interface TopOptions { name: string; title: string; store: ZapStore; duration: number; since: () => number }

/** Escena genérica de ranking de posts (presentes en la ventana) por sats desde `since` (unix s). */
export function topScene(o: TopOptions): Scene {
  return {
    name: o.name,
    duration: o.duration,
    render(root) {
      const draw = () => {
        const rows = o.store.top(10, o.since()).map((s, i) => `
          <li>
            <span class="rank">#${i + 1}</span>
            <span class="amount">${sats(s.msats)}</span>
            <span class="who"><span class="excerpt">${esc(s.post!.content)}</span><small class="author">${shortKey(s.post!.pubkey)}</small></span>
          </li>`).join('');
        root.innerHTML = `<h1 class="top-title" data-fit="text" data-max="6" data-min="20">${esc(o.title)}</h1>
` + (rows
          ? `<ol class="top-list" data-fit="list" data-max="4" data-min="14">${rows}</ol>`
          : `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">Todavía no hay zaps en este período</p>`);
        fitRegions(root);
      };
      return live(o.store, draw);
    },
  };
}
