import type { Config } from './config';
import type { ZapStore } from './nostr/store';
import type { Announcement } from './announcement';
import { noteUri } from './nostr/link';
import { recentPosts, EMPTY_POSTS } from './scenes/post';
import { EMPTY_ANUNCIO } from './scenes/anuncio';
import { ago, esc, sats } from './util';
import { authorHtml, profiles } from './nostr/profiles';
import { liveMarks } from './scenes/live';

export const isMobileViewport = (w: Pick<Window, 'matchMedia'> = window) => w.matchMedia('(max-width: 700px)').matches;

const empty = (t: string) => `<p class="muted m-empty">${t}</p>`;

/** Mobile view: everything stacked and scrollable, no rotation or QR, with a Zapear button per post. */
export function renderMobile(root: HTMLElement, store: ZapStore, cfg: Config, ann: Announcement): () => void {
  const MAX = 50;
  // Same live animations as the kiosk (new post / zap bolt) on the Posts cards.
  const marks = liveMarks(store, 'mobile', ['post', 'zap'], (id) => recentPosts(store, MAX).some((x) => x.postId === id));
  const draw = () => {
    const now = Math.floor(Date.now() / 1000);
    const list = recentPosts(store, MAX);
    marks.begin(list.map((x) => x.postId));
    const posts = list.map((s) => {
      const m = marks.attrs(s.postId);
      const uri = noteUri(s.post!, cfg.relays, 'nostr:{nevent}');
      const web = noteUri(s.post!, cfg.relays, 'https://njump.me/{nevent}');
      return `<article class="m-post${m.cls}" data-id="${esc(s.postId)}">
        <div class="m-meta">${authorHtml(s.post!.pubkey)}<span class="muted">${ago(s.post!.created_at)}</span></div>
        <p class="m-excerpt">${esc(s.post!.content)}</p>
        <div class="m-total">⚡ ${sats(s.msats)} sats${m.bolt}</div>
        ${uri && web ? `<div class="m-actions"><a class="zap-btn" href="${esc(uri)}">⚡ Zapear</a><a class="zap-alt" href="${esc(web)}" target="_blank" rel="noopener noreferrer">abrir en njump.me</a></div>` : ''}
      </article>`;
    }).join('');
    const latest = store.latestZaps(10).map((z) => `<li><b>${sats(z.msats)}</b> sats · ${authorHtml(z.sender)}${z.comment ? ` — ${esc(z.comment)}` : ''} <span class="muted">${ago(z.created_at)}</span></li>`).join('');
    const top = (since: number) => store.top(10, since).map((s, i) => `<li><b>#${i + 1}</b> ${sats(s.msats)} sats · ${esc(s.post!.content.slice(0, 80))}</li>`).join('');
    const topAll = top(0), topRecent = top(now - cfg.topRecentHours * 3600);
    root.innerHTML = `
      <section class="m-section"><h2>📣 Anuncio</h2>${ann.text ? `<p class="m-anuncio">${esc(ann.text)}</p>` : empty(EMPTY_ANUNCIO)}</section>
      <section class="m-section"><h2>Posts</h2>${posts || empty(EMPTY_POSTS)}</section>
      <section class="m-section"><h2>⚡ Últimos zaps</h2>${latest ? `<ul class="m-list">${latest}</ul>` : empty('Todavía no hay zaps')}</section>
      <section class="m-section"><h2>Top 10 zaps · histórico</h2>${topAll ? `<ol class="m-list">${topAll}</ol>` : empty('Todavía no hay zaps en este período')}</section>
      <section class="m-section"><h2>Top 10 zaps · últimas ${cfg.topRecentHours} horas</h2>${topRecent ? `<ol class="m-list">${topRecent}</ol>` : empty('Todavía no hay zaps en este período')}</section>`;
    marks.consume();
  };
  draw();
  const offs = [store.onChange(draw), ann.onChange(draw), profiles.onChange(draw), marks.off];
  return () => offs.forEach((f) => f());
}
