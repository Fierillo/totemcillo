import { renderSVG } from 'uqr';
import type { Scene } from '../rotator';
import type { PostStats, ZapStore } from '../nostr/store';
import type { Post } from '../nostr/types';
import { noteUri } from '../nostr/link';
import { live } from './live';
import { fitRegions } from '../fit';
import { ago, esc, sats, shortKey } from '../util';

export interface LinkOptions { relays: string[]; template: string }

export const EMPTY_POSTS = 'Todavía no hay posts con #lacrypta / #labitconf';
/** Posts visibles a la vez (1 destacado con QR + 4). */
export const MAX_CARDS = 5;
/** Últimos zaps que muestra cada tarjeta. */
export const ZAPS_PER_CARD = 3;

function qr(post: Post, link: LinkOptions): string {
  const uri = noteUri(post, link.relays, link.template);
  if (!uri) return '';
  const svg = renderSVG(uri, { ecc: 'M', border: 2, whiteColor: '#ffffff', blackColor: '#000000' });
  return `<figure class="qr" data-uri="${esc(uri)}">${svg}<figcaption>Escaneá y zapeá</figcaption></figure>`;
}

/** Posts más nuevos primero (desempate por id): mismo store → mismo orden. */
export function recentPosts(store: ZapStore, n = MAX_CARDS): PostStats[] {
  return store.stats().filter((s) => s.post)
    .sort((a, b) => b.post!.created_at - a.post!.created_at || (a.postId < b.postId ? -1 : 1))
    .slice(0, n);
}

function card(s: PostStats, featured: boolean, link: LinkOptions): string {
  const zaps = [...s.zaps].sort((a, b) => b.created_at - a.created_at || (a.id < b.id ? -1 : 1)).slice(0, ZAPS_PER_CARD)
    .map((z) => `<li data-clip><b>${sats(z.msats)}</b> · ${shortKey(z.sender)}${z.comment ? ` — <i>${esc(z.comment)}</i>` : ''}</li>`).join('');
  const code = featured ? qr(s.post!, link) : '';
  return `<article class="card${featured ? ' featured' : ''}" data-id="${esc(s.postId)}">
      <header class="card-head"><span class="author" data-fit="text" data-max="3" data-maxw="1.8" data-min="11">${shortKey(s.post!.pubkey)}</span><span class="muted ago">${ago(s.post!.created_at)}</span></header>
      <div class="card-body"><p class="card-content" data-fit="text" data-max="${featured ? 5 : 3.6}" data-min="11">${esc(s.post!.content)}</p>${code}</div>
      <ul class="card-zaps" data-fit="list" data-max="2.6" data-maxw="2" data-min="12">${zaps || '<li class="muted">Todavía sin zaps. ¡Sé el primero!</li>'}</ul>
      <div class="card-total">⚡ ${sats(s.msats)} sats</div>
    </article>`;
}

/** Escena de posts: grilla determinística con los posts más nuevos; el primero va destacado con el QR. */
export function postScene(store: ZapStore, duration: number, link: LinkOptions = { relays: [], template: 'nostr:{nevent}' }): Scene {
  return {
    name: 'post',
    duration,
    render(root) {
      const draw = () => {
        const list = recentPosts(store);
        root.innerHTML = list.length
          ? `<div class="post-grid" data-n="${list.length}">${list.map((s, i) => card(s, i === 0, link)).join('')}</div>`
          : `<div class="empty-state"><p class="empty-msg" data-fit="text" data-max="7" data-min="16">${EMPTY_POSTS}</p></div>`;
        fitRegions(root);
      };
      return live(store, draw);
    },
  };
}
