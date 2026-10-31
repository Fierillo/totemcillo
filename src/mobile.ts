import type { Config } from './config';
import type { PostStats, ZapStore } from './nostr/store';
import type { Announcement } from './announcement';
import { noteUri } from './nostr/link';
import { recentPosts, EMPTY_POSTS } from './scenes/post';
import { EMPTY_ANUNCIO } from './scenes/anuncio';
import { ago, esc, pending, sats } from './util';
import { authorHtml } from './nostr/profiles';
import { live, liveMarks } from './scenes/live';
import { showIndicator } from './livefeed';
import { FX } from './fx';
import type { LiveEvent } from './nostr/store';
import { domMeasurer, fitText, type Measurer } from './fit';
import { loadPendingZap, openZapDialog, type InvoiceRequester } from './zap-dialog';
import { BOLT, BOLT_OFF, boltSats } from './bolt';
import { imagesHtml, imagesOf, textWithoutImages } from './media';
import { COMPOSE_FAB, NO_MARKS, SKEL_POST, SKEL_ROWS, empty, panel as panelHtml, scrubber as scrubberHtml } from './mobile-templates';

export const isMobileViewport = (w: Pick<Window, 'matchMedia'> = window) => w.matchMedia('(max-width: 700px)').matches;

/** Post text size range (px): shrinks to fit its area, truncates only below the minimum. */
export const MOBILE_FONT = { max: 32, min: 10 };
export const MOBILE_POST_MAX_CHARS = 2000; // full posts on phones, still bounded for localStorage (maxPosts × this)
import { zappability, type CanZap } from './zapcache';
import { bootSplash, SPLASH_MS, type SplashMs } from './mobile-splash';
export { SPLASH_MS } from './mobile-splash';
import { loadView, storeView, type MobileView } from './mobile-view';
export { MOBILE_VIEW_KEY } from './mobile-view';

/** Mobile view: full-screen latest posts feed and a Top ranking by zaps, plus a write button; no rotation or QR. */
export interface MobileOptions {
  requestInvoice?: InvoiceRequester;
  /** Opens the anonymous message box. */
  compose?: () => void;
  measure?: Measurer;
  /** Can this author receive zaps? (red bolt, out of Top otherwise) */
  canZap?: CanZap;
  splashMs?: SplashMs;
}

export function renderMobile(root: HTMLElement, store: ZapStore, cfg: Config, ann: Announcement, { requestInvoice, compose, measure = domMeasurer, canZap, splashMs = SPLASH_MS }: MobileOptions = {}): () => void {
  const MAX = 50;
  const tabs = [{ id: 'posts', label: 'Últimos posts' }, { id: 'top', label: 'Top posts' }];
  const view: MobileView = loadView();
  let selected = tabs.some((t) => t.id === view.tab) ? view.tab! : 'posts';
  const expanded = new Set<string>(view.open ?? []); // Top rows opened in place
  const save = () => {
    view.post ??= recentPosts(store, 1)[0]?.postId;
    storeView({ ...view, tab: selected, open: [...expanded] });
  };
  const SEEN = 'totemcillo:ann-seen'; // last announcement text the user opened
  const seen = () => { try { return localStorage.getItem(SEEN); } catch { return null; } };
  let annOpen = false;
  let newer = false; // a post arrived above the one being read
  let dragging = false; // finger on the side scrubber
  const boot = bootSplash(root.ownerDocument, splashMs, () => recentPosts(store, MAX).every((s) => zap.settled(s.post!.pubkey)), () => draw());
  // Same check as the zap: the author's wallet (lud16/lud06) must answer as LNURL-pay with allowsNostr, from an allowed provider.
  const zap = zappability(canZap, () => { if (!closed) draw(); });
  // Top only ranks authors confirmed zappable: unknown ones wait (no row that pops in and then vanishes), red ones never enter.
  const topRows = () => store.top(MAX, 0).filter((s) => zap.ok(s.post!.pubkey));
  const scrubber = (n: number, i: number) => scrubberHtml(n, i, dragging);
  const panel = (id: string, title: string, body: string) => panelHtml(id, title, body, selected);
  const setScrub = (i: number) => {
    const bar = root.querySelector<HTMLElement>('[data-scrub]'), n = Number(bar?.getAttribute('aria-valuemax'));
    if (!bar) return;
    bar.setAttribute('aria-valuenow', String(i + 1));
    bar.querySelector<HTMLElement>('.m-scrub-thumb')!.style.top = `${(i / (n - 1)) * 100}%`;
    bar.querySelector('.m-scrub-bubble')!.textContent = `${i + 1} / ${n}`;
  };
  /** Jumps the feed to post `i`; the newest turns auto-follow back on (like scrolling there). */
  const jump = (i: number) => {
    const reel = root.querySelector<HTMLElement>('.m-reel'), el = reel?.children[Math.max(0, Math.min(reel.children.length - 1, i))] as HTMLElement | undefined;
    if (!reel || !el) return;
    view.post = el.dataset.id;
    reel.scrollTop = el.offsetTop;
    if (newer && el === reel.children[0]) { newer = false; root.querySelector('[data-newer]')?.remove(); }
    setScrub([...reel.children].indexOf(el));
    save();
  };
  let closeZap: (() => void) | undefined;
  // Same live animations as the kiosk (new post / zap strike) on the Posts cards.
  const marks = liveMarks(store, 'mobile', ['post', 'zap'], (id) => (selected === 'posts' ? recentPosts(store, MAX) : topRows()).some((x) => x.postId === id)); // Top: the real effects on its rows too
  /** Post card shared by the feed and the expanded Top rows; the zap button lives in the right-side action column. */
  const card = (s: PostStats, m: { cls: string }) => {
    const web = noteUri(s.post!, cfg.relays, 'https://njump.me/{nevent}');
    const c = web ? zap.cls(s.post!.pubkey) : ''; // hidden bolt while unknown, fade once answered
    return `<article class="m-post${m.cls}" data-id="${esc(s.postId)}"><div class="m-body">
        <div class="m-meta">${authorHtml(s.post!.pubkey)}<span class="muted">${ago(s.post!.created_at)}</span></div>
        <p class="m-excerpt">${esc(textWithoutImages(s.post!.content))}</p>${imagesHtml(imagesOf(s.post!), 'm-media')}
        ${web ? `<div class="m-post-footer"><a class="zap-alt" href="${esc(web)}" target="_blank" rel="noopener noreferrer">abrir en njump.me</a></div>` : ''}</div>
        ${web ? `<div class="m-side">${zap.off(s.post!.pubkey)
          ? `<button class="zap-btn m-total is-unzappable${c}" type="button" aria-disabled="true" aria-label="No se puede zapear: el autor no tiene una wallet que acepte zaps">${BOLT_OFF}</button>`
          : `<button class="zap-btn m-total${c}" type="button" data-zap="${esc(s.postId)}" aria-haspopup="dialog" aria-label="Zapear · ${sats(s.msats)} sats">${BOLT}${s.msats > 0 ? `<b class="m-zap-sats">${pending(`${sats(s.msats)} sats`, store.ready)}</b>` : ''}</button>`}</div>
        <button class="m-zap-cta btn btn-lime" type="button" data-zap="${esc(s.postId)}" aria-haspopup="dialog"${zap.off(s.post!.pubkey) ? ' disabled' : ''}>Zapear</button>` : ''}
      </article>`;
  };
  /** Top row: amount first, message on one line; tapping toggles the full card in place. */
  let listed: Set<string> | undefined; // Top ids at the last draw: a row that wasn't there enters like a new totem card
  const row = (s: PostStats) => {
    const open = expanded.has(s.postId), m = selected === 'top' && !boot.booting ? marks.attrs(s.postId).cls.replace(' is-new', '') : '';
    const enter = listed && !listed.has(s.postId) ? ' is-new' : '';
    return `<li class="m-top-row${m}${enter}" data-id="${esc(s.postId)}"><button type="button" class="m-top-head" data-row="${esc(s.postId)}" aria-expanded="${open}">`
      + `<b class="m-top-sats">${boltSats(s.msats, store.ready, '', '')}</b><span class="m-top-line">${esc(textWithoutImages(s.post!.content))}</span></button>${open ? card(s, NO_MARKS) : ''}</li>`;
  };
  const annHtml = () => {
    const unread = !!ann.text && ann.text !== seen() ? ' class="is-unread"' : '';
    return `<section class="m-section m-announcement"><h2><button type="button" data-ann aria-expanded="${annOpen}" aria-controls="m-ann-body"${unread}>📣 Anuncio</button></h2>`
      + `<div class="m-ann-body" id="m-ann-body" ${annOpen ? '' : 'hidden'}>${ann.text ? `<p class="m-anuncio">${esc(ann.text)}</p>` : empty(EMPTY_ANUNCIO)}</div></section>`;
  };
  const tabsHtml = () => `<nav class="m-tabs" role="tablist" aria-label="Secciones">${tabs.map((t) => `<button type="button" role="tab" id="tab-${t.id}" data-tab="${t.id}" aria-controls="mobile-${t.id}" aria-selected="${selected === t.id}" tabindex="${selected === t.id ? 0 : -1}">${t.label}</button>`).join('')}</nav>`;
  const postsHtml = (list: PostStats[], loading: boolean) => {
    const posts = list.map((s) => card(s, selected === 'posts' && !boot.booting ? marks.attrs(s.postId) : NO_MARKS)).join('');
    const reel = posts ? `<div class="m-reel">${posts}</div>${scrubber(list.length, Math.max(0, list.findIndex((x) => x.postId === view.post)))}` : loading ? SKEL_POST.repeat(2) : empty(EMPTY_POSTS);
    return panel('posts', 'Últimos posts', (newer ? '<button type="button" class="m-newer btn btn-lime" data-newer>↑ Ver último post</button>' : '') + reel);
  };
  const topHtml = (loading: boolean) => {
    const topList = topRows(), top = topList.map(row).join('');
    if (store.ready) listed = new Set(topList.map((x) => x.postId));
    return panel('top', 'Top posts', top ? `<ol class="m-top">${top}</ol>` : loading || store.top(MAX, 0).some((s) => zap.pending(s.post!.pubkey)) ? SKEL_ROWS : empty('Todavía no hay zaps'));
  };
  /** A redraw keeps the reel on the same post (plus any scroll in progress) and the Top panel where it was. */
  const keepScroll = (oldTop: number | undefined, drift: number) => {
    const reel = root.querySelector<HTMLElement>('.m-reel'), at = view.post && reel?.querySelector<HTMLElement>(`[data-id="${CSS.escape(view.post)}"]`);
    if (reel && at) reel.scrollTop = at.offsetTop + drift;
    else if (reel && oldTop !== undefined) reel.scrollTop = oldTop;
    const topPanel = root.querySelector<HTMLElement>('#mobile-top');
    if (topPanel) topPanel.scrollTop = view.topScroll ?? 0;
  };
  const draw = () => {
    boot.drew();
    const old = root.querySelector<HTMLElement>('.m-reel'), oldAt = view.post && old?.querySelector<HTMLElement>(`[data-id="${CSS.escape(view.post)}"]`);
    const oldTop = old?.scrollTop; // read before the redraw detaches it (a detached element's scrollTop is 0)
    const drift = oldTop !== undefined && oldAt ? oldTop - oldAt.offsetTop : 0; // a scroll in progress survives the redraw
    const list = recentPosts(store, MAX);
    marks.begin(list.map((x) => x.postId));
    const focused = root.contains(root.ownerDocument.activeElement) ? root.ownerDocument.activeElement?.getAttribute('data-tab') : null;
    root.innerHTML = annHtml() + tabsHtml() + postsHtml(list, !store.ready) + topHtml(!store.ready) + COMPOSE_FAB;
    if (focused) root.querySelector<HTMLButtonElement>(`[data-tab="${focused}"]`)?.focus({ preventScroll: true });
    root.querySelectorAll<HTMLElement>('.m-post .m-excerpt').forEach((el) => fitText(el, MOBILE_FONT, measure));
    keepScroll(oldTop, drift);
    marks.consume(boot.booting ? root.ownerDocument.createDocumentFragment() : root, true); // phone: the bolt hits the middle of the box; while loading the marks are dropped
  };
  /** Switches tab; `reveal` scrolls that post's card into view (if listed there) instead of going to the top. */
  const select = (id: string, reveal?: string) => {
    if (!tabs.some((t) => t.id === id) || (selected === id && !reveal)) return;
    if (selected !== id) {
      selected = id;
      draw();
      save();
      root.querySelector<HTMLButtonElement>(`[data-tab="${id}"]`)?.focus({ preventScroll: true });
    }
    const card = reveal ? [...root.querySelectorAll<HTMLElement>(`#mobile-${id} .m-post`)].find((el) => el.dataset.id === reveal) : undefined;
    if (card) card.scrollIntoView({ block: 'center' });
    else window.scrollTo(0, 0);
  };
  const click = (e: MouseEvent) => {
    const postId = (e.target as Element).closest<HTMLElement>('[data-zap]')?.dataset.zap;
    const post = postId && store.posts.get(postId);
    // Paid: back to Posts with the card in view before the feed decides where the zap animates (strike there, not the burst).
    if (post) { closeZap?.(); closeZap = openZapDialog(post, cfg.relays, requestInvoice, store, { onPaid: () => select('posts', post.id) }); }
    const id = (e.target as Element).closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (id) select(id);
    const rowId = (e.target as Element).closest<HTMLElement>('[data-row]')?.dataset.row;
    if (rowId) { if (!expanded.delete(rowId)) expanded.add(rowId); draw(); save(); }
    if ((e.target as Element).closest('[data-compose]')) compose?.();
    if ((e.target as Element).closest('[data-newer]')) { newer = false; view.post = recentPosts(store, 1)[0]?.postId; draw(); save(); }
    if ((e.target as Element).closest('[data-ann]')) {
      annOpen = !annOpen;
      if (annOpen && ann.text) try { localStorage.setItem(SEEN, ann.text); } catch { /* storage unavailable */ }
      draw();
    }
  };
  const scrubAt = (e: PointerEvent) => {
    const bar = (e.target as Element).closest<HTMLElement>('[data-scrub]');
    if (!bar) return;
    const r = bar.getBoundingClientRect(), n = Number(bar.getAttribute('aria-valuemax'));
    jump(Math.min(n - 1, Math.max(0, Math.floor(((e.clientY - r.top) / (r.height || 1)) * n))));
  };
  const pointer = (e: PointerEvent) => {
    const bar = (e.target as Element).closest<HTMLElement>('[data-scrub]');
    if (e.type === 'pointerdown' && bar) { dragging = true; bar.classList.add('is-dragging'); bar.setPointerCapture?.(e.pointerId); e.preventDefault(); scrubAt(e); }
    else if (e.type === 'pointermove' && dragging) scrubAt(e);
    else if ((e.type === 'pointerup' || e.type === 'pointercancel') && dragging) { dragging = false; root.querySelector('[data-scrub]')?.classList.remove('is-dragging'); }
  };
  const keydown = (e: KeyboardEvent) => {
    const bar = (e.target as Element).closest<HTMLElement>('[data-scrub]');
    if (bar && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); jump(Number(bar.getAttribute('aria-valuenow')) - 1 + (e.key === 'ArrowDown' ? 1 : -1)); return; }
    const id = (e.target as Element).closest<HTMLElement>('[data-tab]')?.dataset.tab;
    if (!id || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
    e.preventDefault();
    const i = tabs.findIndex((t) => t.id === id);
    select(tabs[e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length].id);
  };
  /** Remembers which feed post is on screen and how far Top is scrolled. */
  const scroll = (e: Event) => {
    const el = e.target as HTMLElement;
    if (el.classList?.contains('m-reel')) {
      view.post = (el.children[Math.round(el.scrollTop / (el.clientHeight || 1))] as HTMLElement | undefined)?.dataset.id ?? view.post;
      if (newer && view.post === recentPosts(store, 1)[0]?.postId) { newer = false; root.querySelector('[data-newer]')?.remove(); }
      if (!dragging) setScrub(Math.round(el.scrollTop / (el.clientHeight || 1)));
    } else if (el.id === 'mobile-top') view.topScroll = el.scrollTop;
    else return;
    save();
  };
  /** Live post/zap: the totem's icon (bubble / bolt) drops in from the top and leaves in a random direction. */
  const fx = root.ownerDocument.createElement('div');
  fx.className = 'm-live';
  fx.setAttribute('aria-hidden', 'true');
  root.ownerDocument.body.append(fx);
  const onLive = (e: LiveEvent) => {
    if (boot.booting) return; // events that arrive while loading play no effect
    if (e.type === 'post' && view.post && view.post !== e.postId) {
      // At the newest post: follow the new one; scrolled away: stay put and offer the arrow.
      const prev = recentPosts(store, 2).find((x) => x.postId !== e.postId)?.postId;
      if (view.post === prev && !newer) { view.post = e.postId; save(); } else newer = true;
    }
    if (selected === 'top' || (e.type === 'post' && !newer)) return; // Top: real effects on the rows instead; // following the newest: just move there, no icon (zaps always show theirs)
    const a = Math.random() * 2 * Math.PI, el = showIndicator(fx, e, { ms: FX.dropMs, zaps: true });
    el?.style.setProperty('--ex', `${Math.round(Math.cos(a) * 60)}vw`);
    el?.style.setProperty('--ey', `${Math.round(Math.sin(a) * 60)}vh`);
  };
  root.addEventListener('click', click);
  root.addEventListener('keydown', keydown);
  const ptr = ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'] as const;
  ptr.forEach((k) => root.addEventListener(k, pointer));
  root.addEventListener('scroll', scroll, true);
  const offLive = store.onLive(onLive);
  let closed = false;
  // Re-fit once web fonts load (text measured with the fallback font may overflow after the swap).
  (root.ownerDocument as { fonts?: { ready: Promise<unknown> } }).fonts?.ready.then(() => { if (!closed) draw(); });
  const offs = [live(store, draw), ann.onChange(draw), marks.off, offLive, () => fx.remove(), () => { boot.close(); zap.stop(); }, () => { closed = true; root.removeEventListener('scroll', scroll, true); ptr.forEach((k) => root.removeEventListener(k, pointer)); }];
  // Reopen an unpaid invoice from before a reload (same invoice, no new request).
  const resume = loadPendingZap();
  if (resume) closeZap = openZapDialog({ id: resume.postId, pubkey: resume.pubkey, content: '', created_at: 0 }, cfg.relays, requestInvoice, store, { resume, onPaid: () => select('posts', resume.postId) });
  return () => { offs.forEach((f) => f()); closeZap?.(); root.removeEventListener('click', click); root.removeEventListener('keydown', keydown); };
}
