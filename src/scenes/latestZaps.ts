import type { Scene } from '../rotator';
import type { ZapStore } from '../nostr/store';
import { ago, esc, sats, shortKey } from '../util';

/** Escena 2: últimos zaps recibidos. */
export function latestZapsScene(store: ZapStore, duration: number): Scene {
  return {
    name: 'latestZaps',
    duration,
    ready: () => store.zaps.size > 0,
    render(root) {
      const draw = () => {
        const items = store.latestZaps(10).map((z) => {
          const p = store.posts.get(z.postId);
          return `<li><span class="amount">${sats(z.msats)}</span><span class="who">${shortKey(z.sender)}${z.comment ? ` — ${esc(z.comment)}` : ''}<small>${p ? esc(p.content.slice(0, 60)) : ''}</small></span><span class="muted">${ago(z.created_at)}</span></li>`;
        }).join('');
        root.innerHTML = `<h1>⚡ Últimos zaps</h1><ul class="zap-list">${items}</ul>`;
      };
      draw();
      return store.onChange(draw);
    },
  };
}
