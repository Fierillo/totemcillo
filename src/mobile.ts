import type { Config } from './config';
import type { ZapStore } from './nostr/store';
import type { Announcement } from './announcement';
import { noteUri } from './nostr/link';
import { recentPosts, latestOf, zapLine, EMPTY_POSTS } from './scenes/post';
import { EMPTY_ANUNCIO } from './scenes/anuncio';
import { ago, esc, sats, shortKey } from './util';

export const isMobileViewport = (w: Pick<Window, 'matchMedia'> = window) => w.matchMedia('(max-width: 700px)').matches;

const empty = (t: string) => `<p class="muted m-empty">${t}</p>`;

/** Vista de celular: todo apilado y scrolleable, sin rotación ni QR, con botón Zapear por post. */
export function renderMobile(root: HTMLElement, store: ZapStore, cfg: Config, ann: Announcement): () => void {
  const draw = () => {
    const now = Math.floor(Date.now() / 1000);
    const posts = recentPosts(store, 50).map((s) => {
      const uri = noteUri(s.post!, cfg.relays, 'nostr:{nevent}');
      const web = noteUri(s.post!, cfg.relays, 'https://njump.me/{nevent}');
      const zaps = latestOf(s, 2).map((z) => `<li>${zapLine(z)}</li>`).join('');
      return `<article class="m-post">
        <div class="m-meta"><span class="author">${shortKey(s.post!.pubkey)}</span><span class="muted">${ago(s.post!.created_at)}</span></div>
        <p class="m-excerpt">${esc(s.post!.content)}</p>
        <div class="m-total">⚡ ${sats(s.msats)} sats</div>
        ${zaps ? `<ul class="m-zaps">${zaps}</ul>` : ''}
        ${uri && web ? `<div class="m-actions"><a class="zap-btn" href="${esc(uri)}">⚡ Zapear</a><a class="zap-alt" href="${esc(web)}" target="_blank" rel="noopener noreferrer">abrir en njump.me</a></div>` : ''}
      </article>`;
    }).join('');
    const latest = store.latestZaps(10).map((z) => `<li><b>${sats(z.msats)}</b> sats · ${shortKey(z.sender)}${z.comment ? ` — ${esc(z.comment)}` : ''} <span class="muted">${ago(z.created_at)}</span></li>`).join('');
    const top = (since: number) => store.top(10, since).map((s, i) => `<li><b>#${i + 1}</b> ${sats(s.msats)} sats · ${esc(s.post!.content.slice(0, 80))}</li>`).join('');
    const topAll = top(0), topRecent = top(now - cfg.topRecentHours * 3600);
    root.innerHTML = `
      <section class="m-section"><h2>📣 Anuncio</h2>${ann.text ? `<p class="m-anuncio">${esc(ann.text)}</p>` : empty(EMPTY_ANUNCIO)}</section>
      <section class="m-section"><h2>Posts</h2>${posts || empty(EMPTY_POSTS)}</section>
      <section class="m-section"><h2>⚡ Últimos zaps</h2>${latest ? `<ul class="m-list">${latest}</ul>` : empty('Todavía no hay zaps')}</section>
      <section class="m-section"><h2>Top 10 histórico</h2>${topAll ? `<ol class="m-list">${topAll}</ol>` : empty('Todavía no hay zaps en este período')}</section>
      <section class="m-section"><h2>Top 10 · últimas ${cfg.topRecentHours} horas</h2>${topRecent ? `<ol class="m-list">${topRecent}</ol>` : empty('Todavía no hay zaps en este período')}</section>`;
  };
  draw();
  const offs = [store.onChange(draw), ann.onChange(draw)];
  return () => offs.forEach((f) => f());
}
