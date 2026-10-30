import type { Scene } from './types';
import type { ZapStore } from '../nostr/store';
import { authorHtml } from '../nostr/profiles';
import { BOLT, boltSats } from '../bolt';
import { zappability, type CanZap } from '../zapcache';
import { live, liveMarks } from './live';
import { appQr } from './post';
import { fitText } from '../fit';

export const MAX_BARS = 50; // as many as fit; the store ranks up to this many
/** Legible floor of a bar's message (px): it shrinks down to it, using its bar's whole height, before it's truncated. */
export const BAR_MSG_MIN_PX = 14;
/** Minimum height per bar (px): short windows show fewer bars instead of clipping the text. */
export const BAR_MIN_PX = 46; // 1 line of 14px text (+padding) + neon line + 11px sats
export const BAR_GAP = 8; // fixed space between bars
/** Below this window height (px, a phone in landscape mirrored onto a TV) the floors scale with the height, as in the messages scene. */
const SHORT_VH = 480, BAR_MSG_MIN_VH = 2.1, BAR_MSG_FLOOR_PX = 7;
/** The message floor, bar minimum and gap (px) for a window `vh` tall: fixed on PCs, relative on short screens. */
export function barSizes(vh: number) {
  if (vh >= SHORT_VH) return { msg: BAR_MSG_MIN_PX, bar: BAR_MIN_PX, gap: BAR_GAP };
  const msg = Math.max(BAR_MSG_FLOOR_PX, Math.min(12, Math.floor((BAR_MSG_MIN_VH * vh) / 100)));
  return { msg, bar: Math.round(msg * 2.8), gap: Math.max(4, Math.round(msg / 2)) };
}
const GLOBO_MS = 6000;
const HINCHADA_MS = 1200;
const AVISO_MS = 4000;

/** A bar's message: the font its bar allows (CSS), shrunk down to BAR_MSG_MIN_PX until it fits the bar's height; only then truncated with '…'. */
function fitMessage(li: HTMLElement) {
  const msg = li.querySelector<HTMLElement>('.bar-msg'), text = li.querySelector<HTMLElement>('.bar-text');
  if (!msg || !text) return;
  msg.style.fontSize = '';
  const floor = barSizes(window.innerHeight).msg;
  const max = parseFloat(getComputedStyle(msg).fontSize) || floor;
  const { truncated } = fitText(text, { max, min: Math.min(max, floor) }, {
    setSize: (_, px) => { msg.style.fontSize = `${px}px`; },
    fits: () => msg.scrollHeight <= msg.clientHeight + 1,
  });
  msg.toggleAttribute('data-cut', truncated); // the layout check: cut here only at the floor, with the bar's whole height
}

/**
 * Zap battle: the most zapped posts since the /admin start line (historical, the store applies it) as bars that grow and swap places live (keyed DOM, so CSS
 * animates width and position). Unzappable authors are left out (as in mobile's Top). Each live zap inflates its bar
 * and shows its comment in a bubble; a notice says who passed whom.
 */
export function batallaScene(store: ZapStore, publicUrl?: string, canZap?: CanZap): Scene {
  return {
    name: 'batalla',
    render(root) {
      let closed = false;
      const zap = zappability(canZap, () => { if (!closed) draw(); });
      root.innerHTML = `<h1>${BOLT} Batalla de zaps</h1><div class="batalla-wrap"><p class="batalla-aviso" aria-live="polite"></p><ol class="batalla"></ol></div>` + (publicUrl ? appQr(publicUrl) : '');
      const ol = root.querySelector<HTMLOListElement>('.batalla')!;
      const aviso = root.querySelector<HTMLElement>('.batalla-aviso')!;
      const timers = new Set<ReturnType<typeof setTimeout>>();
      const later = (fn: () => void, ms: number) => { const t = setTimeout(() => { timers.delete(t); fn(); }, ms); timers.add(t); };
      let ranks = new Map<string, number>();
      const hits: { postId: string; comment?: string }[] = [];
      const offLive = store.onLive((e) => { if (e.type === 'zap') hits.push({ postId: e.postId, comment: e.comment }); });

      const bar = (id: string) => {
        let li = ol.querySelector<HTMLElement>(`:scope > li[data-id="${id}"]`);
        if (!li) {
          li = document.createElement('li');
          li.dataset.id = id;
          li.innerHTML = '<p class="bar-msg"><span class="bar-label"></span><span class="bar-text"></span></p><div class="bar-track"><div class="bar-fill"></div><b class="bar-sats"></b></div>';
          ol.append(li);
        }
        return li;
      };
      let fitN = MAX_BARS;
      const rows = () => store.top(MAX_BARS).filter((s) => zap.ok(s.post!.pubkey)).slice(0, fitN);
      const marks = liveMarks(store, 'batalla', ['zap'], (id) => rows().some((s) => s.postId === id));
      let holding = false; // a zapped bar is charging at its old place: the reorder waits
      const draw = () => {
        if (holding || closed) return;
        holding = marks.charge((id) => ol.querySelector<HTMLElement>(`:scope > li[data-id="${id}"]`), (li, id) => {
          const top = store.top(MAX_BARS), s = top.find((x) => x.postId === id), max = Math.max(top[0]?.msats || 1, s?.msats ?? 0);
          if (!s) return;
          li.querySelector<HTMLElement>('.bar-fill')!.style.width = `${Math.round((s.msats / max) * 10000) / 100}%`;
          li.querySelector('.bar-sats')!.innerHTML = boltSats(s.msats, store.ready);
        }, () => { holding = false; draw(); });
        if (holding) return;
        const sz = barSizes(window.innerHeight);
        ol.style.setProperty('--bar-min', `${sz.msg}px`);
        fitN = ol.clientHeight ? Math.max(1, Math.min(MAX_BARS, Math.floor((ol.clientHeight + sz.gap) / (sz.bar + sz.gap)))) : MAX_BARS;
        const list = rows();
        marks.begin(list.map((s) => s.postId));
        root.querySelector('.empty-msg')?.remove();
        if (!list.length) ol.insertAdjacentHTML('beforebegin', `<p class="empty-msg">Todavía no hay zaps</p>`);
        const ids = new Set(list.map((s) => s.postId));
        ol.querySelectorAll<HTMLElement>(':scope > li').forEach((li) => { if (!ids.has(li.dataset.id!)) li.remove(); });
        const max = list[0]?.msats || 1;
        const next = new Map<string, number>();
        list.forEach((s, i) => {
          const li = bar(s.postId);
          next.set(s.postId, i);
          li.style.setProperty('--rank', String(i));
          if (marks.attrs(s.postId).cls.includes('is-zapped')) li.classList.add('is-zapped');
          li.querySelector('.bar-label')!.innerHTML = `<span class="rank">#${i + 1}</span>${authorHtml(s.post!.pubkey)}`;
          li.querySelector('.bar-text')!.textContent = s.post!.content.trim().replace(/\s+/g, ' ');
          li.querySelector<HTMLElement>('.bar-fill')!.style.width = `${Math.round((s.msats / max) * 10000) / 100}%`;
          li.querySelector('.bar-sats')!.innerHTML = boltSats(s.msats, store.ready);
        });
        ol.style.setProperty('--n', String(fitN));
        ol.style.setProperty('--gap', `${sz.gap}px`);
        ol.querySelectorAll<HTMLElement>(':scope > li').forEach(fitMessage);
        // Overtake notice: a bar that climbed over the one that held its new place.
        for (const [id, i] of next) {
          const was = ranks.get(id);
          if (was === undefined || i >= was) continue;
          const passed = [...ranks].find(([other, r]) => r === i && other !== id)?.[0];
          const a = store.posts.get(id), b = passed ? store.posts.get(passed) : undefined;
          if (!a || !b) continue;
          aviso.innerHTML = `${authorHtml(a.pubkey)} pasó a ${authorHtml(b.pubkey)}`;
          aviso.classList.remove('is-on'); void aviso.offsetWidth; aviso.classList.add('is-on');
          later(() => { aviso.textContent = ''; aviso.classList.remove('is-on'); }, AVISO_MS);
          break;
        }
        ranks = next;
        marks.consume(ol); // real lightning strike on the zapped bars
        ol.querySelectorAll('.is-zapped').forEach((el) => el.classList.remove('is-zapped'));
        // Live zaps: inflate the bar and show the comment in a bubble next to it.
        for (const h of hits.splice(0)) {
          const li = ol.querySelector<HTMLElement>(`:scope > li[data-id="${h.postId}"]`);
          if (!li) continue;
          li.classList.add('is-hinchada');
          later(() => li.classList.remove('is-hinchada'), HINCHADA_MS);
          if (h.comment) {
            li.querySelector('.globo')?.remove();
            const g = document.createElement('div');
            g.className = 'globo';
            g.textContent = h.comment;
            li.append(g);
            later(() => g.remove(), GLOBO_MS);
          }
        }
      };
      const off = live(store, draw);
      // The list may get its real height after the first draw: recount the bars that fit.
      const ro = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => { if (!closed) draw(); });
      ro?.observe(ol);
      return () => { closed = true; off(); ro?.disconnect(); offLive(); marks.off(); zap.stop(); timers.forEach(clearTimeout); };
    },
  };
}
