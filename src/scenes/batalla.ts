import type { Scene } from './types';
import type { ZapStore } from '../nostr/store';
import { authorHtml } from '../nostr/profiles';
import { BOLT, boltSats } from '../bolt';
import { zappability, type CanZap } from '../zapcache';
import { live, liveMarks } from './live';
import { appQr } from './post';
import { truncateText } from '../text';

export const MAX_BARS = 50; // as many as fit; the store ranks up to this many
/** The post's text is the protagonist: up to this many characters (2–3 lines). */
export const BAR_CHARS = 140;
/** Minimum height per bar (px): short windows show fewer bars instead of clipping the text. */
export const BAR_MIN_PX = 46; // 1 line of 14px text (+padding) + neon line + 11px sats
export const BAR_GAP = 8; // fixed space between bars
const GLOBO_MS = 6000;
const HINCHADA_MS = 1200;
const AVISO_MS = 4000;

/**
 * Zap battle: the most zapped posts of the last `hours` as bars that grow and swap places live (keyed DOM, so CSS
 * animates width and position). Unzappable authors are left out (as in mobile's Top). Each live zap inflates its bar
 * and shows its comment in a bubble; a notice says who passed whom.
 */
export function batallaScene(store: ZapStore, hours = 3, publicUrl?: string, canZap?: CanZap, now: () => number = Date.now): Scene {
  return {
    name: 'batalla',
    render(root) {
      let closed = false;
      const zap = zappability(canZap, () => { if (!closed) draw(); });
      root.innerHTML = `<h1>${BOLT} Batalla de zaps · últimas ${hours} horas</h1><div class="batalla-wrap"><p class="batalla-aviso" aria-live="polite"></p><ol class="batalla"></ol></div>` + (publicUrl ? appQr(publicUrl) : '');
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
      const rows = () => store.top(MAX_BARS, Math.floor(now() / 1000) - hours * 3600).filter((s) => zap.ok(s.post!.pubkey)).slice(0, fitN);
      const marks = liveMarks(store, 'batalla', ['zap'], (id) => rows().some((s) => s.postId === id));
      const draw = () => {
        fitN = ol.clientHeight ? Math.max(1, Math.min(MAX_BARS, Math.floor((ol.clientHeight + BAR_GAP) / (BAR_MIN_PX + BAR_GAP)))) : MAX_BARS;
        const list = rows();
        marks.begin(list.map((s) => s.postId));
        root.querySelector('.empty-msg')?.remove();
        if (!list.length) ol.insertAdjacentHTML('beforebegin', `<p class="empty-msg">Todavía no hay zaps en las últimas ${hours} horas</p>`);
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
          li.querySelector('.bar-text')!.textContent = truncateText(s.post!.content.trim().replace(/\s+/g, ' '), BAR_CHARS);
          li.querySelector<HTMLElement>('.bar-fill')!.style.width = `${Math.round((s.msats / max) * 10000) / 100}%`;
          li.querySelector('.bar-sats')!.innerHTML = boltSats(s.msats, store.ready);
        });
        ol.style.setProperty('--n', String(fitN));
        ol.style.setProperty('--gap', `${BAR_GAP}px`);
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
