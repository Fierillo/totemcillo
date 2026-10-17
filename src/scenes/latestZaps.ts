import type { Scene } from './types';
import type { ZapStore } from '../nostr/store';
import { live, liveMarks } from './live';
import { fitRegions } from '../fit';
import { ago, esc, sats } from '../util';
import { authorHtml } from '../nostr/profiles';
import { appQr } from './post';

/** Scene 2: latest zaps received, with the shared app QR (when there is a URL). */
export function latestZapsScene(store: ZapStore, publicUrl?: string): Scene {
  return {
    name: 'latestZaps',
    render(root) {
      const marks = liveMarks(store, 'latestZaps', ['zap'], (id) => store.latestZaps(10).some((z) => z.postId === id));
      const draw = () => {
        const list = store.latestZaps(10);
        marks.begin(list.map((z) => z.postId));
        const seen = new Set<string>(); // only the newest row of a post is its new zap
        const items = list.map((z) => {
          const p = store.posts.get(z.postId);
          const m = seen.has(z.postId) ? '' : marks.attrs(z.postId).cls;
          seen.add(z.postId);
          return `<li class="${m.trim()}" data-id="${esc(z.postId)}"><span class="amount">${sats(z.msats)}</span><span class="who" data-clip>${authorHtml(z.sender)}${z.comment ? ` — ${esc(z.comment)}` : ''}<small>${p ? esc(p.content.slice(0, 60)) : ''}</small></span><span class="muted">${ago(z.created_at)}</span></li>`;
        }).join('');
        root.innerHTML = `<h1>⚡ Últimos zaps</h1>` + (items
          ? `<ul class="zap-list" data-fit="list" data-max="3.6" data-maxw="3.6">${items}</ul>`
          : `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">Todavía no hay zaps</p>`) + (publicUrl ? appQr(publicUrl) : '');
        fitRegions(root);
        marks.consume(root);
      };
      const off = live(store, draw);
      return () => { off(); marks.off(); };
    },
  };
}
