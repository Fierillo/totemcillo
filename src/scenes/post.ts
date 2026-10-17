import { renderSVG } from 'uqr';
import type { Scene } from './types';
import type { PostStats, ZapStore } from '../nostr/store';
import { live, liveMarks } from './live';
import { fitRegions } from '../fit';
import { ago, esc, pending, sats } from '../util';
import { authorHtml } from '../nostr/profiles';

export interface PostSceneOptions { publicUrl: string }

export const EMPTY_POSTS = 'Todavía no hay posts con #lacrypta / #labitconf';
export const MAX_POSTS = 6;
export const QR_CAPTION = 'Escaneá y abrí esto en tu celular';

/** Newest posts first (ties broken by id): same store → same order. */
export function recentPosts(store: ZapStore, n = MAX_POSTS): PostStats[] {
  return store.stats().filter((s) => s.post)
    .sort((a, b) => b.post!.created_at - a.post!.created_at || (a.postId < b.postId ? -1 : 1))
    .slice(0, n);
}

/** Post row shared by the posts list and the rankings (`rank` adds the #N position). */
export const postRow = (s: PostStats, m: { cls: string }, ready: boolean, rank?: number) => `<li class="post-row${m.cls}" data-id="${esc(s.postId)}">
      ${rank ? `<span class="rank">#${rank}</span>` : ''}<div class="row-main">
        <div class="row-meta">${authorHtml(s.post!.pubkey)}<span class="ago muted">${ago(s.post!.created_at)}</span></div>
        <p class="excerpt" data-clip>${esc(s.post!.content)}</p>
      </div>
      <div class="row-total">⚡ ${pending(`${sats(s.msats)}<small> sats</small>`, ready)}</div>
    </li>`;

const qrCache = new Map<string, string>();
/** Single app QR (same component in posts, tops and announcement); generated once per URL. */
export function appQr(publicUrl: string): string {
  let h = qrCache.get(publicUrl);
  if (!h) {
    h = `<aside class="qr-box"><figure class="qr" data-uri="${esc(publicUrl)}">${renderSVG(publicUrl, { ecc: 'M', border: 2, whiteColor: '#ffffff', blackColor: '#000000' })}<figcaption>${QR_CAPTION}</figcaption></figure></aside>`;
    qrCache.set(publicUrl, h);
  }
  return h;
}

/** Posts scene: deterministic list (author, time, message and total) + a single app QR. */
export function postScene(store: ZapStore, opts: PostSceneOptions = { publicUrl: `${globalThis.location?.origin ?? ''}/` }): Scene {
  const qr = () => appQr(opts.publicUrl);
  return {
    name: 'post',
    render(root) {
      const marks = liveMarks(store, 'post', ['post', 'zap'], (id) => recentPosts(store).some((x) => x.postId === id));
      const draw = () => {
        const list = recentPosts(store);
        marks.begin(list.map((x) => x.postId));
        root.innerHTML = '<h1>Últimos posts</h1>' + (list.length
          ? `<section class="posts"><ul class="post-list" data-fit="list" data-max="3.6" data-maxw="3.6">${list.map((x) => postRow(x, marks.attrs(x.postId), store.ready)).join('')}</ul></section>`
          : `<div class="empty-state"><p class="empty-msg" data-fit="text" data-max="7" data-min="16">${EMPTY_POSTS}</p></div>`) + qr();
        fitRegions(root);
        marks.consume(root);
      };
      const off = live(store, draw);
      return () => { off(); marks.off(); };
    },
  };
}
