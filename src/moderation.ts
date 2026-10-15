import type { ZapStore } from './nostr/store';
import type { ModAction } from '../shared/settings';
import { authorHtml, profiles } from './nostr/profiles';
import { recentPosts } from './scenes/post';
import { ago, esc, sats } from './util';

export interface ModerationOptions {
  store: ZapStore;
  /** Calls POST /api/moderation; true on success. */
  act: (action: ModAction, id: string) => Promise<boolean>;
  confirm?: (msg: string) => boolean;
}

const MAX_ROWS = 100;

/** List of what the totem shows (newest first) with Eliminar / Banear autor, plus banned users with Desbanear. */
export function renderModeration(root: HTMLElement, o: ModerationOptions): { off(): void } {
  const ask = o.confirm ?? ((m: string) => window.confirm(m));
  const draw = () => {
    const posts = recentPosts(o.store, MAX_ROWS);
    const banned = o.store.moderation.bannedPubkeys;
    root.innerHTML = `<h2>Mensajes en el tótem</h2>
      ${posts.length ? `<ul class="mod-list">${posts.map((s) => `<li class="mod-post" data-id="${esc(s.postId)}" data-pk="${esc(s.post!.pubkey)}">
        <div class="mod-meta">${authorHtml(s.post!.pubkey)}<span class="muted">${ago(s.post!.created_at)}</span><span class="mod-sats">⚡ ${sats(s.msats)} sats</span></div>
        <p class="mod-text">${esc(s.post!.content)}</p>
        <div class="row"><button type="button" class="hide">Eliminar</button><button type="button" class="ban">Banear autor</button></div>
      </li>`).join('')}</ul>` : '<p class="muted">Todavía no hay posts.</p>'}
      <h3>Baneados</h3>
      ${banned.length ? `<ul class="mod-banned">${banned.map((pk) => `<li data-pk="${esc(pk)}">${authorHtml(pk)}<button type="button" class="unban">Desbanear</button></li>`).join('')}</ul>` : '<p class="muted">Nadie baneado.</p>'}`;
  };
  const onClick = async (e: Event) => {
    const btn = (e.target as HTMLElement).closest('button');
    if (!btn) return;
    const li = btn.closest('li') as HTMLElement | null;
    const id = li?.dataset.id, pk = li?.dataset.pk;
    let call: [ModAction, string] | null = null;
    if (btn.classList.contains('hide') && id) call = ['hide', id];
    else if (btn.classList.contains('ban') && pk) {
      if (!ask('¿Banear a este autor? Se ocultan todos sus posts y sus zaps dejan de contar.')) return;
      call = ['ban', pk];
    } else if (btn.classList.contains('unban') && pk) call = ['unban', pk];
    if (!call) return;
    btn.disabled = true;
    if (!(await o.act(...call))) btn.disabled = false;
  };
  root.addEventListener('click', onClick);
  draw();
  const offS = o.store.onChange(draw), offP = profiles.onChange(draw);
  return { off() { offS(); offP(); root.removeEventListener('click', onClick); } };
}
