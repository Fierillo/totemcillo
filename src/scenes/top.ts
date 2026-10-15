import type { Scene } from './types';
import type { ZapStore } from '../nostr/store';
import { fitRegions } from '../fit';
import { live, liveMarks } from './live';
import { esc, sats } from '../util';
import { authorHtml } from '../nostr/profiles';
import { appQr } from './post';

export interface TopOptions { name: string; title: string; store: ZapStore; since: () => number;
  /** App QR URL (as in posts); not shown without a URL. */
  publicUrl?: string }

/** Generic ranking scene of posts (in the window) by sats since `since` (unix s). */
export function topScene(o: TopOptions): Scene {
  return {
    name: o.name,
    render(root) {
      const marks = liveMarks(o.store, o.name, ['zap'], (id) => o.store.top(10, o.since()).some((x) => x.postId === id));
      const draw = () => {
        const list = o.store.top(10, o.since());
        marks.begin(list.map((x) => x.postId));
        const rows = list.map((s, i) => { const m = marks.attrs(s.postId); return `
          <li class="top-row${m.cls}" data-id="${esc(s.postId)}">
            <span class="rank">#${i + 1}</span>
            <span class="amount">${sats(s.msats)}</span>
            <span class="who"><span class="excerpt" data-clip>${esc(s.post!.content)}</span><small class="by">${authorHtml(s.post!.pubkey)}</small></span>${m.bolt}
          </li>`; }).join('');
        root.innerHTML = `<h1 class="top-title" data-fit="text" data-max="6" data-min="20">${esc(o.title)}</h1>
` + (rows
          ? `<ol class="top-list" data-fit="list" data-max="3.2" data-maxw="4" data-min="14">${rows}</ol>`
          : `<p class="empty-msg" data-fit="text" data-max="6" data-min="16">Todavía no hay zaps en este período</p>`) + (o.publicUrl ? appQr(o.publicUrl) : '');
        fitRegions(root);
        marks.consume();
      };
      const off = live(o.store, draw);
      return () => { off(); marks.off(); };
    },
  };
}
