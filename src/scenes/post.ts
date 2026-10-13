import type { Scene } from '../rotator';
import type { ZapStore } from '../nostr/store';
import { live } from './live';
import { ago, esc, sats, shortKey } from '../util';

/** Escena 1: un post con su lista de zaps; rota entre posts en cada aparición. */
export function postScene(store: ZapStore, duration: number): Scene {
  let cursor = 0;
  return {
    name: 'post',
    duration,
    ready: () => store.posts.size > 0,
    render(root) {
      const list = store.stats().filter((s) => s.post);
      const id = list[cursor++ % list.length].postId;
      const draw = () => {
        const cur = store.stats().find((x) => x.postId === id)!;
        const zaps = cur.zaps.slice(0, 8).map((z) =>
          `<li><b>${sats(z.msats)}</b> sats · ${shortKey(z.sender)}${z.comment ? ` — <i>${esc(z.comment)}</i>` : ''}</li>`).join('');
        root.innerHTML = `
          <section class="post">
            <div class="post-head"><span class="author">${shortKey(cur.post!.pubkey)}</span><span class="muted">${ago(cur.post!.created_at)}</span></div>
            <p class="post-content">${esc(cur.post!.content)}</p>
            <div class="total">⚡ ${sats(cur.msats)} sats</div>
          </section>
          <aside class="zaps">
            <h2>Zaps (${cur.zaps.length})</h2>
            <ul>${zaps || '<li class="muted">Todavía sin zaps. ¡Sé el primero!</li>'}</ul>
          </aside>`;
      };
      return live(store, draw);
    },
  };
}
