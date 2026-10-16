import type { Config } from './config';
import type { ZapStore } from './nostr/store';
import type { Announcement } from './announcement';
import { noteUri } from './nostr/link';
import { recentPosts, EMPTY_POSTS } from './scenes/post';
import { EMPTY_ANUNCIO } from './scenes/anuncio';
import { ago, esc, pending, sats } from './util';
import { authorHtml } from './nostr/profiles';
import { live, liveMarks } from './scenes/live';

export const isMobileViewport = (w: Pick<Window, 'matchMedia'> = window) => w.matchMedia('(max-width: 700px)').matches;

const empty = (t: string) => `<p class="muted m-empty">${t}</p>`;
/** Pending text/images use skeleton blocks. */
const skel = (cls: string) => `<span class="skel ${cls}" aria-hidden="true"></span>`;
const SKEL_POST = `<article class="m-post m-skel-post" aria-hidden="true">${skel('m-skel-avatar')}${skel('m-skel-line')}${skel('m-skel-line m-skel-short')}</article>`;
const SKEL_ROWS = `<div class="m-skel-rows" aria-hidden="true">${skel('m-skel-line')}${skel('m-skel-line m-skel-short')}${skel('m-skel-line')}</div>`;

/** Mobile feed with persistent section tabs, no rotation or QR. */
export function renderMobile(root: HTMLElement, store: ZapStore, cfg: Config, ann: Announcement): () => void {
  const MAX = 50;
  const tabs = [{ id: 'posts', label: 'Posts' }, { id: 'zaps', label: 'Zaps' }, { id: 'top', label: 'Top histórico' }, { id: 'recent', label: `Top ${cfg.topRecentHours}h` }];
  let selected = 'posts';
  const panel = (id: string, title: string, body: string) => `<section class="m-section" id="mobile-${id}" role="tabpanel" aria-labelledby="tab-${id}" ${selected === id ? '' : 'hidden'}><h2>${title}</h2>${body}</section>`;
  // Same live animations as the kiosk (new post / zap bolt) on the Posts cards.
  const marks = liveMarks(store, 'mobile', ['post', 'zap'], (id) => recentPosts(store, MAX).some((x) => x.postId === id));
  const draw = () => {
    const now = Math.floor(Date.now() / 1000);
    const loading = !store.ready;
    const list = recentPosts(store, MAX);
    marks.begin(list.map((x) => x.postId));
    const posts = list.map((s) => {
      const m = marks.attrs(s.postId);
      const uri = noteUri(s.post!, cfg.relays, 'nostr:{nevent}');
      const web = noteUri(s.post!, cfg.relays, 'https://njump.me/{nevent}');
      return `<article class="m-post${m.cls}" data-id="${esc(s.postId)}">
        <div class="m-meta">${authorHtml(s.post!.pubkey)}<span class="muted">${ago(s.post!.created_at)}</span></div>
        <p class="m-excerpt">${esc(s.post!.content)}</p>
        <div class="m-post-footer"><div class="m-total">⚡ ${pending(`${sats(s.msats)} sats`, store.ready)}${m.bolt}</div>
        ${uri && web ? `<div class="m-actions"><a class="zap-btn" href="${esc(uri)}">⚡ Zapear</a><a class="zap-alt" href="${esc(web)}" target="_blank" rel="noopener noreferrer">abrir en njump.me</a></div>` : ''}
        </div>
      </article>`;
    }).join('');
    const latest = store.latestZaps(10).map((z) => `<li><b>${sats(z.msats)}</b> sats · ${authorHtml(z.sender)}${z.comment ? ` — ${esc(z.comment)}` : ''} <span class="muted">${ago(z.created_at)}</span></li>`).join('');
    const top = (since: number) => store.top(10, since).map((s, i) => `<li><b>#${i + 1}</b> ${pending(`${sats(s.msats)} sats`, store.ready)} · ${esc(s.post!.content.slice(0, 80))}</li>`).join('');
    const topAll = top(0), topRecent = top(now - cfg.topRecentHours * 3600);
    const focused = root.contains(root.ownerDocument.activeElement) ? root.ownerDocument.activeElement?.getAttribute('data-tab') : null;
    root.innerHTML = `<section class="m-section m-announcement"><h2>📣 Anuncio</h2>${ann.text ? `<p class="m-anuncio">${esc(ann.text)}</p>` : empty(EMPTY_ANUNCIO)}</section>`
      + `<nav class="m-tabs" role="tablist" aria-label="Secciones">${tabs.map((t) => `<button type="button" role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-controls="mobile-${t.id}" aria-selected="${selected === t.id}" tabindex="${selected === t.id ? 0 : -1}">${t.label}</button>`).join('')}</nav>`
      + panel('posts', 'Posts', posts || (loading ? SKEL_POST.repeat(2) : empty(EMPTY_POSTS)))
      + panel('zaps', '⚡ Últimos zaps', latest ? `<ul class="m-list">${latest}</ul>` : loading ? SKEL_ROWS : empty('Todavía no hay zaps'))
      + panel('top', 'Top 10 zaps · histórico', topAll ? `<ol class="m-list">${topAll}</ol>` : loading ? SKEL_POST.repeat(2) : empty('Todavía no hay zaps en este período'))
      + panel('recent', `Top 10 zaps · últimas ${cfg.topRecentHours} horas`, topRecent ? `<ol class="m-list">${topRecent}</ol>` : loading ? SKEL_POST.repeat(2) : empty('Todavía no hay zaps en este período'));
    if (focused) root.querySelector<HTMLButtonElement>(`[data-tab="${focused}"]`)?.focus({ preventScroll: true });
    marks.consume();
  };
  const select = (id: string) => {
    if (!tabs.some((t) => t.id === id) || selected === id) return;
    selected = id;
    draw();
    root.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  };
  const click = (e: MouseEvent) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (id) select(id);
  };
  const keydown = (e: KeyboardEvent) => {
    const id = (e.target as Element).closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (!id || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === id);
    select(tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].id);
  };
  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  const offs = [live(store, draw), ann.onChange(draw), marks.off];
  return () => { offs.forEach((f) => f()); root.removeEventListener('click', click); root.removeEventListener('keydown', keydown); };
}
