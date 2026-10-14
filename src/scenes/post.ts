import { renderSVG } from 'uqr';
import type { Scene } from '../rotator';
import type { PostStats, ZapStore } from '../nostr/store';
import { live } from './live';
import { fitRegions } from '../fit';
import { esc, sats } from '../util';

export interface PostSceneOptions { publicUrl: string }

export const EMPTY_POSTS = 'Todavía no hay posts con #lacrypta / #labitconf';
export const MAX_POSTS = 6;
export const QR_CAPTION = 'Escaneá y abrí esto en tu celular';

/** Posts más nuevos primero (desempate por id): mismo store → mismo orden. */
export function recentPosts(store: ZapStore, n = MAX_POSTS): PostStats[] {
  return store.stats().filter((s) => s.post)
    .sort((a, b) => b.post!.created_at - a.post!.created_at || (a.postId < b.postId ? -1 : 1))
    .slice(0, n);
}

const row = (s: PostStats) => `<li class="post-row"><p class="excerpt" data-clip>${esc(s.post!.content)}</p><div class="row-total">⚡ ${sats(s.msats)}<small> sats</small></div></li>`;

/** Escena de posts: lista determinística (mensaje + total) + un único QR a la app. */
export function postScene(store: ZapStore, duration: number, opts: PostSceneOptions = { publicUrl: `${globalThis.location?.origin ?? ''}/` }): Scene {
  let qrHtml = '';
  const qr = () => (qrHtml ||= `<aside class="qr-box"><figure class="qr" data-uri="${esc(opts.publicUrl)}">${renderSVG(opts.publicUrl, { ecc: 'M', border: 2, whiteColor: '#ffffff', blackColor: '#000000' })}<figcaption>${QR_CAPTION}</figcaption></figure></aside>`);
  return {
    name: 'post',
    duration,
    render(root) {
      const draw = () => {
        const list = recentPosts(store);
        root.innerHTML = (list.length
          ? `<section class="posts"><ul class="post-list" data-fit="list" data-max="3.2" data-maxw="2.4" data-min="12">${list.map(row).join('')}</ul></section>`
          : `<div class="empty-state"><p class="empty-msg" data-fit="text" data-max="7" data-min="16">${EMPTY_POSTS}</p></div>`) + qr();
        fitRegions(root);
      };
      return live(store, draw);
    },
  };
}
