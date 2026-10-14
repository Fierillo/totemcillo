import { renderSVG } from 'uqr';
import type { Scene } from '../rotator';
import type { ZapStore } from '../nostr/store';
import type { Post } from '../nostr/types';
import { noteUri } from '../nostr/link';
import { live } from './live';
import { fitRegions } from '../fit';
import { ago, esc, sats, shortKey } from '../util';

export interface LinkOptions { relays: string[]; template: string }

export const EMPTY_POSTS = 'Todavía no hay posts con #lacrypta / #labitconf';

function qr(post: Post, link: LinkOptions): string {
  const uri = noteUri(post, link.relays, link.template);
  if (!uri) return '';
  const svg = renderSVG(uri, { ecc: 'M', border: 2, whiteColor: '#ffffff', blackColor: '#000000' });
  return `<figure class="qr" data-uri="${esc(uri)}">${svg}<figcaption>Escaneá y zapeá</figcaption></figure>`;
}

/** Escena 1: un post con su QR y su lista de zaps; rota entre posts. Sin posts muestra un estado vacío. */
export function postScene(store: ZapStore, duration: number, link: LinkOptions = { relays: [], template: 'nostr:{nevent}' }): Scene {
  let cursor = 0;
  const pick = () => {
    const list = store.stats().filter((s) => s.post);
    return list.length ? list[cursor++ % list.length].postId : null;
  };
  return {
    name: 'post',
    duration,
    render(root) {
      let id = pick();
      let code = id ? qr(store.posts.get(id)!, link) : '';
      const draw = () => {
        if (!id || !store.posts.has(id)) {
          id = pick();
          code = id ? qr(store.posts.get(id)!, link) : '';
        }
        if (!id) {
          root.innerHTML = `<div class="empty-state"><p class="empty-msg" data-fit="text" data-max="7" data-min="16">${EMPTY_POSTS}</p></div>`;
          fitRegions(root);
          return;
        }
        const cur = store.stats().find((x) => x.postId === id)!;
        const zaps = cur.zaps.slice(0, 8).map((z) =>
          `<li data-clip><b>${sats(z.msats)}</b> sats · ${shortKey(z.sender)}${z.comment ? ` — <i>${esc(z.comment)}</i>` : ''}</li>`).join('');
        root.innerHTML = `
          <section class="post">
            <div class="post-head"><span class="author" data-fit="text" data-max="3.5" data-min="12">${shortKey(cur.post!.pubkey)}</span><span class="muted">${ago(cur.post!.created_at)}</span></div>
            <div class="post-body">
              <p class="post-content" data-fit="text" data-max="7" data-min="14">${esc(cur.post!.content)}</p>
              ${code}
            </div>
            <div class="total">⚡ ${sats(cur.msats)} sats</div>
          </section>
          <aside class="zaps">
            <h2>Zaps (${cur.zaps.length})</h2>
            <ul data-fit="list" data-max="3.2" data-maxw="3.5" data-min="12">${zaps || '<li class="muted">Todavía sin zaps. ¡Sé el primero!</li>'}</ul>
          </aside>`;
        fitRegions(root);
      };
      return live(store, draw);
    },
  };
}
