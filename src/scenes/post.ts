import { renderSVG } from 'uqr';
import type { Scene } from '../rotator';
import type { ZapStore } from '../nostr/store';
import type { Post } from '../nostr/types';
import { noteUri } from '../nostr/link';
import { live } from './live';
import { ago, esc, sats, shortKey } from '../util';

export interface LinkOptions { relays: string[]; template: string }

function qr(post: Post, link: LinkOptions): string {
  const uri = noteUri(post, link.relays, link.template);
  if (!uri) return '';
  const svg = renderSVG(uri, { ecc: 'M', border: 2, whiteColor: '#ffffff', blackColor: '#000000' });
  return `<figure class="qr" data-uri="${esc(uri)}">${svg}<figcaption>Escaneá y zapeá</figcaption></figure>`;
}

/** Escena 1: un post con su QR y su lista de zaps; rota entre posts en cada aparición. */
export function postScene(store: ZapStore, duration: number, link: LinkOptions = { relays: [], template: 'nostr:{nevent}' }): Scene {
  let cursor = 0;
  return {
    name: 'post',
    duration,
    ready: () => store.posts.size > 0,
    render(root) {
      const list = store.stats().filter((s) => s.post);
      const id = list[cursor++ % list.length].postId;
      const code = qr(store.posts.get(id)!, link);
      const draw = () => {
        const cur = store.stats().find((x) => x.postId === id)!;
        const zaps = cur.zaps.slice(0, 8).map((z) =>
          `<li><b>${sats(z.msats)}</b> sats · ${shortKey(z.sender)}${z.comment ? ` — <i>${esc(z.comment)}</i>` : ''}</li>`).join('');
        root.innerHTML = `
          <section class="post">
            <div class="post-head"><span class="author">${shortKey(cur.post!.pubkey)}</span><span class="muted">${ago(cur.post!.created_at)}</span></div>
            <div class="post-body">
              <p class="post-content">${esc(cur.post!.content)}</p>
              ${code}
            </div>
            <div class="total">⚡ ${sats(cur.msats)} sats</div>
          </section>
          <aside class="zaps">
            <h2>Zaps (${cur.zaps.length})</h2>
            <ul>${zaps || '<li class="muted">Todavía sin zaps. ¡Sé el primero!</li>'}</ul>
          </aside>`;
      };
      return live(store, draw);
    },
  };
}
