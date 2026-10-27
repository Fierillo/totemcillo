import { renderSVG } from 'uqr';
import type { Scene } from './types';
import type { PostStats, ZapStore } from '../nostr/store';
import { live, liveMarks, rowEffects } from './live';
import { domMeasurer, fitRegions, largest, fitText, untruncate, type Measurer } from '../fit';
import { ago, esc, sats } from '../util';
import type { Zap } from '../nostr/types';
import { authorHtml } from '../nostr/profiles';
import { BOLT, BOLT_OFF, boltSats } from '../bolt';
import { zappability, type CanZap } from '../zapcache';

interface PostSceneOptions { publicUrl: string;
  /** Optional: authors that can't receive zaps get the red struck bolt and no sats. */
  canZap?: CanZap }

export const EMPTY_POSTS = 'Todavía no hay posts con #lacrypta';
/** Most boxes asked from the store; the fit keeps as many as fit at the legible font (like the battle's bars). */
export const MAX_BOXES = 24;
/** A message shrinks down to this share of the list font (never below BOX_MIN_PX) before its box grows to two rows: 60% keeps it readable next to its neighbours. */
export const BOX_MIN_RATIO = 0.6;
/** Legible floor (px): 12px still reads at arm's length on a totem screen; no message goes below it. */
export const BOX_MIN_PX = 12;
/** Comfortable list font (px): never below it, the list keeps fewer boxes instead. */
export const BOX_COMFORT_PX = 16;
/** …and on big windows it scales with the height (vh). */
const BOX_COMFORT_VH = 1.8; // ≈19px at 1080p: smaller boxes, more of them
/** Largest message font the list grows to while filling its area, in vh and vw. */
const BOX_MAX_VH = 3, BOX_MAX_VW = 2; // ≈32px at 1080p (was 43): no oversized boxes when few messages
/** Zap comments at least this long also show up as messages. */
export const LONG_COMMENT = 40;
export const QR_CAPTION = 'Escaneá y abrí esto en tu celular';

/** Newest posts first (ties broken by id): same store → same order. */
export function recentPosts(store: ZapStore, n = MAX_BOXES): PostStats[] {
  return store.stats().filter((s) => s.post)
    .sort((a, b) => b.post!.created_at - a.post!.created_at || (a.postId < b.postId ? -1 : 1))
    .slice(0, n);
}

interface RowOptions { cls: string; ready: boolean; zap: { off: boolean; cls: string } }
/** A post as a message box: author, age, excerpt and its bolt (red when off, blinking while pending, else live sats). */
const postRow = (s: PostStats, { cls, ready, zap }: RowOptions) => `<li class="post-row${cls}" data-id="${esc(s.postId)}">
      <div class="row-main">
        <div class="row-meta">${authorHtml(s.post!.pubkey)}<span class="ago muted">${ago(s.post!.created_at)}</span>${zap.off ? `<span class="row-total is-unzappable${zap.cls}" aria-label="No se puede zapear">${BOLT_OFF}</span>` : zap.cls.includes('bolt-pending') ? `<span class="row-total${zap.cls}" aria-label="Verificando si se puede zapear">${BOLT}</span>`
        : `<span class="row-total${zap.cls}">${boltSats(s.msats, ready, '<small> sats</small>')}</span>`}</div>
        <p class="excerpt" data-clip>${esc(s.post!.content.trim())}</p>
      </div>
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

/** A long zap comment as a message: who zapped, when, the comment and that zap's sats (no strike: it's not a post). */
const zapRow = (z: Zap, cls = '') => `<li class="post-row msg-zap${cls}" data-zap="${esc(z.id)}"><div class="row-main">
        <div class="row-meta">${authorHtml(z.sender)}<span class="ago muted">${ago(z.created_at)} · zap</span><span class="row-total">${BOLT} ${sats(z.msats)}<small> sats</small></span></div>
        <p class="excerpt" data-clip>${esc(z.comment.trim())}</p>
      </div>
    </li>`;

/**
 * Sets the box font and fits each message, per box: shrink its font (down to BOX_MIN_RATIO of the list's) in one cell,
 * else grow the box to two rows at the largest font that fits, else truncate there; its header (and sats) follows it.
 */
function sizeBoxes(ul: HTMLElement, size: number, m: Measurer) {
  m.setSize(ul, size);
  const min = Math.max(BOX_MIN_PX, Math.floor(size * BOX_MIN_RATIO));
  ul.dataset.boxMin = String(min); // the layout check tries two-row boxes in one cell at it
  const excerpts = [...ul.querySelectorAll<HTMLElement>('.excerpt')];
  // Batched: every message at the list font in one cell, then a single read; only the ones that don't fit go down the ladder.
  excerpts.forEach((el) => { el.closest('.post-row')?.classList.remove('is-long'); untruncate(el); m.setSize(el, size); });
  const misfits = excerpts.filter((el) => !m.fits(el));
  misfits.forEach((el) => {
    const box = el.closest<HTMLElement>('.post-row');
    if (fitText(el, { max: size, min }, m).truncated && box) {
      box.classList.add('is-long');
      fitText(el, { max: size, min }, m);
    }
  });
  excerpts.forEach((el) => {
    const meta = el.parentElement?.querySelector<HTMLElement>('.row-meta');
    if (meta) m.setSize(meta, parseFloat(el.style.fontSize));
  });
}

/** Column ends (px from the list's content edge) for a computed grid-template-columns. */
const trackEnds = (tracks: string, gap: number) => {
  let at = -gap;
  return tracks.split(' ').filter((t) => t.endsWith('px')).map((t) => (at += gap + parseFloat(t)));
};

/** The QR slot spans the last tracks the QR covers (bottom right), so the boxes take the rest, above it too. */
function placeQrSlot(root: HTMLElement, ul: HTMLElement) {
  const slot = ul.querySelector<HTMLElement>('.qr-slot'), qr = root.querySelector('.qr')?.getBoundingClientRect();
  if (!slot) return;
  const css = getComputedStyle(ul), list = ul.getBoundingClientRect();
  const cols = trackEnds(css.gridTemplateColumns, parseFloat(css.columnGap) || 0);
  const rowGap = parseFloat(css.rowGap) || 0, count = Number(ul.style.getPropertyValue('--rows')) || 1;
  const rowH = (ul.clientHeight - (parseFloat(css.paddingTop) || 0) - (parseFloat(css.paddingBottom) || 0) - (count - 1) * rowGap) / count;
  const rows = Array.from({ length: count }, (_, k) => (k + 1) * rowH + k * rowGap); // the equal rows of a list that fits
  const x = list.left + (parseFloat(css.paddingLeft) || 0), y = list.top + (parseFloat(css.paddingTop) || 0);
  const spanX = cols.filter((end) => x + end > (qr?.left ?? Infinity)).length, spanY = rows.filter((end) => y + end > (qr?.top ?? Infinity)).length;
  slot.hidden = !spanX || !spanY || spanX >= cols.length; // portrait: the QR sits below the list
  if (slot.hidden) return;
  slot.style.gridColumn = `span ${spanX} / -1`;
  slot.style.gridRow = `span ${spanY} / -1`;
}

/** Every visible box starts inside the explicit rows (none spilled into the zero-height overflow rows). */
const placedAll = (ul: HTMLElement) => {
  const bottom = ul.clientHeight - (parseFloat(getComputedStyle(ul).paddingBottom) || 0);
  return [...ul.querySelectorAll<HTMLElement>('.post-row:not([hidden])')].every((b) => b.offsetTop < bottom - 1);
};

/** Spreads the boxes over the fewest rows that hold them (the rows share the list's height); false if no row count fits. */
function arrange(root: HTMLElement, ul: HTMLElement, fits: () => boolean) {
  const cells = ul.querySelectorAll('.post-row:not([hidden])').length + ul.querySelectorAll('.post-row.is-long:not([hidden])').length;
  const cols = trackEnds(getComputedStyle(ul).gridTemplateColumns, 0).length || 1;
  for (let rows = Math.max(1, Math.ceil(cells / cols)); rows <= cells; rows++) { // fewer rows can't hold every cell
    ul.style.setProperty('--rows', String(rows));
    placeQrSlot(root, ul);
    if (fits()) return true;
    if (placedAll(ul)) return false; // every box already sits in a row and still doesn't fit: more (shorter) rows won't help
  }
  return false;
}

/**
 * Fills the list area with boxes: keeps the boxes that fit at the comfortable font (data-floor px, or data-comfort vh if bigger), dropping the oldest,
 * then grows the font as much as they still fit, up to data-max vh / data-maxw vw; the grid stretches them to fill the rest.
 */
export function fitBoxes(root: HTMLElement, m: Measurer = domMeasurer, vh = window.innerHeight, vw = window.innerWidth) {
  const ul = root.querySelector<HTMLElement>('.post-list');
  if (!ul) return;
  const boxFits = m.fitsBox ?? m.fits;
  const qr = root.querySelector('.qr');
  const clear = (box: HTMLElement) => { // its layout spot (not the float) stays off the QR
    const q = qr?.getBoundingClientRect(), o = box.offsetParent?.getBoundingClientRect();
    if (!q?.width || !o) return true;
    const x = o.left + box.offsetLeft, y = o.top + box.offsetTop;
    return x + box.offsetWidth <= q.left || x >= q.right || y + box.offsetHeight <= q.top || y >= q.bottom;
  };
  const fits = () => boxFits(ul) && [...ul.querySelectorAll<HTMLElement>('.post-row:not([hidden])')].every((b) => boxFits(b) && clear(b)); // no box taller than its rows nor on the QR
  const floor = Math.max(Number(ul.dataset.floor), Math.floor((Number(ul.dataset.comfort ?? 0) * vh) / 100));
  const cap = Math.max(floor, Math.floor(Math.min(Number(ul.dataset.max) * vh, Number(ul.dataset.maxw ?? Infinity) * vw) / 100));
  sizeBoxes(ul, floor, m);
  const all = [...ul.querySelectorAll<HTMLElement>('.post-row')];
  const keep = (k: number) => all.forEach((box, i) => { box.hidden = i >= k; });
  const kept = largest(1, all.length, (k) => { keep(k); return arrange(root, ul, fits); }) ?? 1;
  all.slice(kept).forEach((box) => box.remove()); // the oldest that don't fit
  keep(kept);
  const tryAt = (s: number) => { sizeBoxes(ul, s, m); return arrange(root, ul, fits); };
  const best = largest(floor, cap, tryAt) ?? largest(BOX_MIN_PX, floor - 1, tryAt) ?? BOX_MIN_PX; // a tiny window: down to the legible floor
  sizeBoxes(ul, best, m);
  if (!arrange(root, ul, fits)) squeeze(ul, m);
}

/** Last resort (a tiny window): each message keeps only the whole lines its box has room for, truncated with '…'. */
function squeeze(ul: HTMLElement, m: Measurer) {
  ul.querySelectorAll<HTMLElement>('.post-row').forEach((box) => {
    const el = box.querySelector<HTMLElement>('.excerpt'), line = el && parseFloat(getComputedStyle(el).lineHeight);
    if (!el || !line) return;
    const room = el.clientHeight - Math.max(0, box.scrollHeight - box.clientHeight);
    el.style.maxHeight = `${Math.max(1, Math.floor(room / line)) * line}px`;
    const size = parseFloat(el.style.fontSize);
    fitText(el, { max: size, min: size }, m);
  });
}

/** How long a box slides to its new place when the order changes (ms). */
const SHIFT_MS = 600;
/** FLIP: each box that changed place starts at its old spot and slides to the new one (`translate`, so the float's transform keeps running). */
function slide(rows: HTMLElement[], before: Map<string, DOMRect>, key: (li: HTMLElement) => string) {
  if (globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
  const moved = rows.flatMap((li) => {
    const was = before.get(key(li)), now = li.getBoundingClientRect();
    const dx = was ? was.left - now.left : 0, dy = was ? was.top - now.top : 0;
    if (!dx && !dy) return [];
    li.style.transition = 'none';
    li.style.translate = `${dx}px ${dy}px`;
    return [li];
  });
  if (!moved.length) return;
  void moved[0].offsetWidth; // commit the old spots before sliding
  moved.forEach((li) => { li.style.transition = `translate ${SHIFT_MS}ms var(--ease-out-soft, ease-out)`; li.style.translate = ''; });
}

type Message = { at: number; post?: PostStats; zap?: Zap };
/** Posts (by last activity) and long zap comments, newest first, at most `n`: the grid's reading order. */
export function messages(store: ZapStore, n = MAX_BOXES): Message[] {
  // a post's last activity: its publication or its latest zap (a zap moves it to the top left)
  const posts: Message[] = store.stats().filter((s) => s.post)
    .map((s) => ({ at: Math.max(s.post!.created_at, ...s.zaps.map((z) => z.created_at)), post: s }))
    .sort((a, b) => b.at - a.at || (a.post.postId < b.post.postId ? -1 : 1)).slice(0, n);
  const zaps: Message[] = store.latestZaps(n * 4).filter((z) => [...z.comment.trim()].length >= LONG_COMMENT).map((z) => ({ at: z.created_at, zap: z }));
  return [...posts, ...zaps].sort((a, b) => b.at - a.at).slice(0, n);
}

/** Messages scene (the protagonist): floating boxes with live sats and long zap comments, plus a single app QR. */
export function postScene(store: ZapStore, opts: PostSceneOptions = { publicUrl: `${globalThis.location?.origin ?? ''}/` }): Scene {
  const qr = () => appQr(opts.publicUrl);
  return {
    name: 'post',
    render(root) {
      const marks = liveMarks(store, 'post', ['post', 'zap'], (id) => messages(store).some((m) => m.post?.postId === id));
      let closed = false;
      const zap = zappability(opts.canZap, () => { if (!closed) draw(); });
      const effects = rowEffects((li) => li.dataset.id ?? `z:${li.dataset.zap}`);
      let seen: Set<string> | undefined; // zap messages already on screen (live marks are per post, so new ones are tracked here)
      const draw = () => {
        const list = messages(store);
        const box = (m: Message) => {
          if (m.zap) return zapRow(m.zap, seen && !seen.has(m.zap.id) ? ' is-new' : '');
          const s = m.post!, pk = s.post!.pubkey;
          return postRow(s, { cls: marks.attrs(s.postId).cls, ready: store.ready, zap: { off: zap.off(pk), cls: zap.cls(pk) } });
        };
        marks.begin(list.flatMap((m) => m.post ? [m.post.postId] : []));
        const key = (li: HTMLElement) => li.dataset.id ?? `z:${li.dataset.zap}`;
        const before = new Map([...root.querySelectorAll<HTMLElement>('.post-list > .post-row')].map((li) => [key(li), li.getBoundingClientRect()]));
        root.innerHTML = '<h1>Últimos mensajes</h1>' + (list.length
          ? `<section class="posts"><ul class="post-list" data-boxes data-max="${BOX_MAX_VH}" data-maxw="${BOX_MAX_VW}" data-floor="${BOX_COMFORT_PX}" data-comfort="${BOX_COMFORT_VH}"><li class="qr-slot" aria-hidden="true" hidden></li>${list.map(box).join('')}</ul></section>`
          : `<div class="empty-state"><p class="empty-msg" data-fit="text" data-max="7" data-min="16">${EMPTY_POSTS}</p></div>`) + qr();
        root.querySelectorAll<HTMLElement>('.post-list > li').forEach((li, i) => li.style.setProperty('--i', String(i))); // float phase
        fitRegions(root);
        fitBoxes(root);
        const rows = [...root.querySelectorAll<HTMLElement>('.post-list > li')];
        effects.start(rows);
        marks.consume(root); // strikes only the fresh marks, aimed at the box's new place
        effects.resume(rows);
        slide(rows.filter((li) => li.matches('.post-row')), before, key);
        seen = new Set(list.flatMap((m) => (m.zap ? [m.zap.id] : [])));
      };
      const off = live(store, draw);
      return () => { closed = true; off(); marks.off(); zap.stop(); };
    },
  };
}
