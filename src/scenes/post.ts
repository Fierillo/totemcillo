import { renderSVG } from 'uqr';
import type { Scene } from './types';
import type { PostStats, ZapStore } from '../nostr/store';
import { live, liveMarks, refitOn, rowEffects } from './live';
import { domMeasurer, fitRegions, largest, fitText, untruncate, type Measurer } from '../fit';
import { age, esc, sats } from '../util';
import type { Zap } from '../nostr/types';
import { authorHtml } from '../nostr/profiles';
import { BOLT, BOLT_OFF, boltSats } from '../bolt';
import { imagesHtml, textWithoutImages, type PostImage } from '../media';
import { zappability, type CanZap } from '../zapcache';
import { masonry } from '../masonry';

interface PostSceneOptions { publicUrl: string;
  /** Optional: authors that can't receive zaps get the red struck bolt and no sats. */
  canZap?: CanZap }

export const EMPTY_POSTS = 'Todavía no hay posts con #lacrypta';
/** Most boxes asked from the store; the fit keeps as many as fit at the legible font (like the battle's bars). */
export const MAX_BOXES = 24;
/** A message shrinks down to this share of the list font (never below BOX_MIN_PX) before its box grows taller: 60% keeps it readable next to its neighbours. */
export const BOX_MIN_RATIO = 0.6;
/** Legible floor (px): 12px still reads at arm's length on a totem screen; no message goes below it. */
export const BOX_MIN_PX = 12;
/** …but a phone in landscape (below SHORT_VH, mirrored onto a TV) scales it with the height, like the PC's 16px at 768px: its CSS px are big on the TV. */
const BOX_MIN_VH = 2.1, BOX_MIN_FLOOR_PX = 7;
let minPx = BOX_MIN_PX; // the legible floor of the list being fitted
/** Comfortable list font (px): on short screens the list goes below it (down to BOX_MIN_PX) when that fits more boxes. */
export const BOX_COMFORT_PX = 16;
/** …and on big windows it scales with the height (vh). */
const BOX_COMFORT_VH = 1.8; // ≈19px at 1080p: smaller boxes, more of them
/** Below this window height (px, a phone in landscape) a smaller font that places more boxes wins over the comfort floor. */
const SHORT_VH = 480;
/** Largest message font the list grows to while filling its area, in vh and vw. */
const BOX_MAX_VH = 5, BOX_MAX_VW = 4; // relative to the viewport: few messages grow to fill the screen (mirrored onto a TV)
/** Zap comments at least this long also show up as messages. */
export const LONG_COMMENT = 40;
export const QR_CAPTION = 'Escaneá y abrí esto en tu celular';

/** Newest posts first (ties broken by id): same store → same order. */
export function recentPosts(store: ZapStore, n = MAX_BOXES): PostStats[] {
  return store.stats().filter((s) => s.post)
    .sort((a, b) => b.post!.created_at - a.post!.created_at || (a.postId < b.postId ? -1 : 1))
    .slice(0, n);
}

/** Live sats of a row total (shared by the normal draw and the charge at the old place). */
const totalHtml = (msats: number, ready: boolean) => boltSats(msats, ready);
/** Recharges a row total in place; red (off) and pending bolts keep showing no sats, as in draw. */
const paintTotal = (el: HTMLElement, msats: number, ready: boolean) => {
  if (!el.matches('.is-unzappable, .bolt-pending')) el.innerHTML = totalHtml(msats, ready);
};

interface RowOptions { cls: string; ready: boolean; images: PostImage[]; zap: { off: boolean; cls: string } }
/** A post as a message box: author, age, excerpt and its bolt (red when off, blinking while pending, else live sats). */
const postRow = (s: PostStats, { cls, ready, images, zap }: RowOptions) => `<li class="post-row${cls}" data-id="${esc(s.postId)}">
      <div class="row-main">
        <div class="row-meta">${authorHtml(s.post!.pubkey)}<span class="ago muted">${age(s.post!.created_at)}</span></div>
        <p class="excerpt" data-clip>${esc(textWithoutImages(s.post!.content))}</p>${imagesHtml(images, 'row-media', 1)}
        <div class="row-foot">${zap.off ? `<span class="row-total is-unzappable${zap.cls}" aria-label="No se puede zapear">${BOLT_OFF}</span>` : zap.cls.includes('bolt-pending') ? `<span class="row-total${zap.cls}" aria-label="Verificando si se puede zapear">${BOLT}</span>`
        : `<span class="row-total${zap.cls}">${totalHtml(s.msats, ready)}</span>`}</div>
      </div>
    </li>`;

const qrCache = new Map<string, string>();
/** Header above the title of every TV scene that shows the app QR. */
export const APP_HEADER = '<p class="app-url">totemcillo.vercel.app</p>';
/** QR as an <img> data URL with an intrinsic size: old TV WebViews (Chromecast/Google TV) painted the inline SVG blank. */
function qrImg(data: string): string {
  const svg = renderSVG(data, { ecc: 'M', border: 2, whiteColor: '#ffffff', blackColor: '#000000' });
  const side = Number(/viewBox="0 0 (\d+)/.exec(svg)![1]);
  return `<img src="data:image/svg+xml,${encodeURIComponent(svg)}" width="${side}" height="${side}" alt="">`;
}
/** Single app QR (same component in posts, tops and announcement); generated once per URL. */
export function appQr(publicUrl: string): string {
  let h = qrCache.get(publicUrl);
  if (!h) {
    h = `<aside class="qr-box"><figure class="qr" data-uri="${esc(publicUrl)}">${qrImg(publicUrl)}<figcaption>${QR_CAPTION}</figcaption></figure></aside>`;
    qrCache.set(publicUrl, h);
  }
  return h;
}

/** A long zap comment as a message: who zapped, when, the comment and that zap's sats (no strike: it's not a post). */
const zapRow = (z: Zap, cls = '') => `<li class="post-row msg-zap${cls}" data-zap="${esc(z.id)}"><div class="row-main">
        <div class="row-meta">${authorHtml(z.sender)}<span class="ago muted">${age(z.created_at)} · zap</span></div>
        <p class="excerpt" data-clip>${esc(z.comment.trim())}</p>
        <div class="row-foot"><span class="row-total">${BOLT} ${sats(z.msats)}</span></div>
      </div>
    </li>`;

/**
 * Sets the box font and fits each message, per box: shrink its font (down to BOX_MIN_RATIO of the list's) in one cell,
 * else grow the box (taller, up to its max lines) at the largest font that fits, else truncate there; its header and its sats line follow it.
 */
function sizeBoxes(ul: HTMLElement, size: number, m: Measurer) {
  m.setSize(ul, size);
  columns(ul); // the text wraps at the column width
  const min = Math.max(minPx, Math.floor(size * BOX_MIN_RATIO));
  ul.dataset.boxMin = String(min); // the layout check tries tall boxes at their normal height at it
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
    el.parentElement?.querySelectorAll<HTMLElement>('.row-meta, .row-foot').forEach((line) => m.setSize(line, parseFloat(el.style.fontSize)));
  });
}

/** Narrowest column, in list ems (more columns, none oversized). */
const BOX_MIN_EM = 14;
const px = (v: string) => parseFloat(v) || 0;

/** Splits the list's width into the most columns at least BOX_MIN_EM wide and sets their width (--col-w) before measuring the text. */
function columns(ul: HTMLElement) {
  const css = getComputedStyle(ul), gap = px(css.rowGap);
  const width = ul.clientWidth - px(css.paddingLeft) - px(css.paddingRight);
  const count = Math.max(1, Math.floor((width + gap) / (BOX_MIN_EM * px(ul.style.fontSize) + gap)));
  const w = Math.max(0, (width - (count - 1) * gap) / count);
  ul.style.setProperty('--col-w', `${w}px`);
  return { count, w, gap, css };
}

/** The room each column has (px): the full height, or down to just above the QR for the columns it covers (bottom right). */
function limits(root: HTMLElement, ul: HTMLElement, { count, w, gap, css }: ReturnType<typeof columns>) {
  const q = root.querySelector('.qr')?.getBoundingClientRect(), list = ul.getBoundingClientRect();
  const x = list.left + px(css.paddingLeft), y = list.top + px(css.paddingTop);
  const room = ul.clientHeight - px(css.paddingTop) - px(css.paddingBottom);
  return Array.from({ length: count }, (_, c) => {
    const left = x + c * (w + gap);
    const under = q?.width && left + w > q.left - gap && left < q.right + gap && q.top - gap < y + room;
    return under ? Math.max(0, Math.min(room, q.top - gap - y)) : room;
  });
}

/**
 * Masonry: each candidate box (not [hidden]), as tall as its content, goes in order to the lowest open column it fits (see masonry);
 * the ones that fit no column get data-out. Returns how many are placed, or -1 if some placed box overflows.
 */
function arrange(root: HTMLElement, ul: HTMLElement, fits: () => boolean) {
  const cols = columns(ul), boxes = [...ul.querySelectorAll<HTMLElement>('.post-row:not([hidden])')];
  boxes.forEach((b) => { b.removeAttribute('data-out'); });
  const heights = boxes.map((b) => b.offsetHeight);
  const spots = masonry(heights, limits(root, ul, cols), cols.gap);
  boxes.forEach((b, i) => {
    const spot = spots[i];
    if (!spot) { b.dataset.out = String(heights[i]); return; }
    b.style.left = `${px(cols.css.paddingLeft) + spot.col * (cols.w + cols.gap)}px`;
    b.style.top = `${px(cols.css.paddingTop) + spot.top}px`;
  });
  return fits() ? spots.filter(Boolean).length : -1;
}

/**
 * Fills the list area with boxes: at the comfortable font (data-floor px, or data-comfort vh if bigger) every message that fits a column
 * goes in, in order (a tall one that fits nowhere is left out, the next ones keep filling the holes); then the font grows as much as
 * no box drops out, up to data-max vh / data-maxw vw. Each box keeps its content's height. data-left-out: the shortest box left out (px, 0 if none).
 */
export function fitBoxes(root: HTMLElement, m: Measurer = domMeasurer, vh = window.innerHeight, vw = window.innerWidth) {
  const ul = root.querySelector<HTMLElement>('.post-list');
  if (!ul) return;
  const boxFits = m.fitsBox ?? m.fits;
  const fits = () => boxFits(ul) && [...ul.querySelectorAll<HTMLElement>('.post-row:not([hidden]):not([data-out])')].every((b) => boxFits(b)); // masonry already keeps them apart and off the QR
  minPx = vh < SHORT_VH ? Math.max(BOX_MIN_FLOOR_PX, Math.min(BOX_MIN_PX, Math.floor((BOX_MIN_VH * vh) / 100))) : BOX_MIN_PX;
  const floor = Math.max(Number(ul.dataset.floor), Math.floor((Number(ul.dataset.comfort ?? 0) * vh) / 100));
  const cap = Math.max(floor, Math.floor(Math.min(Number(ul.dataset.max) * vh, Number(ul.dataset.maxw ?? Infinity) * vw) / 100));
  const all = [...ul.querySelectorAll<HTMLElement>('.post-row')];
  const keep = (k: number) => all.forEach((box, i) => { box.hidden = i >= k; });
  /** At font s: how many candidates go in without overflowing (k) and how many of them the masonry actually places. */
  const count = (s: number) => {
    sizeBoxes(ul, s, m);
    const k = largest(1, all.length, (n) => { keep(n); return arrange(root, ul, fits) >= 0; }) ?? 1;
    keep(k);
    return { k, placed: Math.max(1, arrange(root, ul, fits)) };
  };
  // Below the floor: the legible minimum on short screens; big ones (vh comfort) only go down to the fixed comfort font, so a taller
  // screen (fullscreen) never shows fewer boxes than a shorter window just because its vh floor grew faster than its area.
  const low = floor <= BOX_COMFORT_PX ? minPx : BOX_COMFORT_PX;
  const atMin = count(low), atFloor = count(floor);
  // Phone-landscape (mirrored onto a TV) and big screens count the boxes the masonry actually places, so neither stays mostly empty
  // and a fullscreen TV never shows fewer than its smaller window.
  const small = vh < SHORT_VH || floor > BOX_COMFORT_PX ? atMin.placed > atFloor.placed : atMin.k > atFloor.k;
  const kept = small ? atMin.k : atFloor.k;
  if (small) sizeBoxes(ul, low, m);
  all.slice(kept).forEach((box) => box.remove()); // the oldest that don't fit
  keep(kept);
  const need = Math.max(1, arrange(root, ul, fits));
  const tryAt = (s: number) => { sizeBoxes(ul, s, m); return arrange(root, ul, fits) >= need; };
  const best = largest(floor, cap, tryAt) ?? largest(minPx, floor - 1, tryAt) ?? minPx; // a tiny window: down to the legible floor
  sizeBoxes(ul, best, m);
  if (arrange(root, ul, fits) < 1) { squeeze(ul, m); arrange(root, ul, fits); }
  const out = [...ul.querySelectorAll<HTMLElement>('.post-row[data-out]')];
  ul.dataset.leftOut = String(Math.min(...out.map((b) => Number(b.dataset.out))) || 0);
  out.forEach((b) => b.remove()); // the ones that don't fit aren't shown
}

/** Last resort (a tiny window): each message keeps only the whole lines its box has room for, truncated with '…'. */
function squeeze(ul: HTMLElement, m: Measurer) {
  ul.querySelectorAll<HTMLElement>('.post-row').forEach((box) => {
    const el = box.querySelector<HTMLElement>('.excerpt'), line = el && parseFloat(getComputedStyle(el).lineHeight);
    if (!el || !line) return;
    const css = getComputedStyle(ul), height = ul.clientHeight - px(css.paddingTop) - px(css.paddingBottom);
    const room = el.clientHeight - Math.max(0, box.offsetHeight - height); // the box fits the list's height
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
/** Posts (by last activity) and long zap comments, newest first, at most `n`: the masonry's reading order. */
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
      let holding = false; // a zapped box is charging at its old place: the reorder waits
      const draw = () => {
        if (holding || closed) return;
        holding = marks.charge((id) => root.querySelector<HTMLElement>(`.post-list > .post-row[data-id="${id}"]`), (el, id) => {
          effects.start([el]); // the flash starts here, and continues at the new place
          const s = store.stats().find((x) => x.postId === id), total = el.querySelector<HTMLElement>('.row-total');
          if (s && total) paintTotal(total, s.msats, store.ready);
        }, () => { holding = false; draw(); });
        if (holding) return;
        const list = messages(store);
        const box = (m: Message) => {
          if (m.zap) return zapRow(m.zap, seen && !seen.has(m.zap.id) ? ' is-new' : '');
          const s = m.post!, pk = s.post!.pubkey;
          return postRow(s, { cls: marks.attrs(s.postId).cls, ready: store.ready, images: store.imagesFor(s.post!), zap: { off: zap.off(pk), cls: zap.cls(pk) } });
        };
        marks.begin(list.flatMap((m) => m.post ? [m.post.postId] : []));
        const key = (li: HTMLElement) => li.dataset.id ?? `z:${li.dataset.zap}`;
        const before = new Map([...root.querySelectorAll<HTMLElement>('.post-list > .post-row')].map((li) => [key(li), li.getBoundingClientRect()]));
        root.innerHTML = `${APP_HEADER}<h1>Últimos mensajes</h1>` + (list.length
          ? `<section class="posts"><ul class="post-list" data-boxes data-max="${BOX_MAX_VH}" data-maxw="${BOX_MAX_VW}" data-floor="${BOX_COMFORT_PX}" data-comfort="${BOX_COMFORT_VH}">${list.map(box).join('')}</ul></section>`
          : `<div class="empty-state"><p class="empty-msg" data-fit="text" data-max="7" data-min="16">${EMPTY_POSTS}</p></div>`) + qr();
        root.querySelectorAll<HTMLElement>('.post-list > li').forEach((li, i) => li.style.setProperty('--i', String(i))); // float phase
        fitRegions(root);
        fitBoxes(root);
        const rows = [...root.querySelectorAll<HTMLElement>('.post-list > li')];
        effects.start(rows.filter((li) => !marks.struck(li.dataset.id ?? '')));
        marks.consume(root); // strikes only the fresh marks, aimed at the box's new place
        effects.resume(rows);
        slide(rows.filter((li) => li.matches('.post-row')), before, key);
        seen = new Set(list.flatMap((m) => (m.zap ? [m.zap.id] : [])));
      };
      const off = live(store, draw);
      const offFit = refitOn(root, () => { if (!closed && !holding) { fitRegions(root); fitBoxes(root); } }); // layout changed after the fit: re-fit, no redraw
      return () => { closed = true; off(); offFit(); marks.off(); zap.stop(); };
    },
  };
}
