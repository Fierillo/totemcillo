import type { Scene } from '../rotator';
import type { ZapStore } from '../nostr/store';
import { live } from './live';
import { fitRegions } from '../fit';
import { ago, esc, sats } from '../util';
import { authorHtml } from '../nostr/profiles';
import { appQr } from './post';

/** Scene 2: latest zaps received, with the shared app QR (when there is a URL). */
export function latestZapsScene(store: ZapStore, duration: number, publicUrl?: string): Scene {
  return {
    name: 'latestZaps',
    duration,
    render(root) {
      const draw = () => {
        const items = store.latestZaps(10).map((z) => {
          const p = store.posts.get(z.postId);
          return `<li><span class="amount">${sats(z.msats)}</span><span class="who" data-clip>${authorHtml(z.sender)}${z.comment ? ` — ${esc(z.comment)}` : ''}<small>${p ? esc(p.content.slice(0, 60)) : ''}</small></span><span class="muted">${ago(z.created_at)}</span></li>`;
        }).join('');
        root.innerHTML = `<h1>⚡ Últimos zaps</h1>` + (items
          ? `<ul class="zap-list" data-fit="list" data-max="3.2" data-maxw="4" data-min="14">${items}</ul>`
          : `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">Todavía no hay zaps</p>`) + (publicUrl ? appQr(publicUrl) : '');
        fitRegions(root);
      };
      return live(store, draw);
    },
  };
}
