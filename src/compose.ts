import { finalizeEvent, generateSecretKey, type EventTemplate } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import type { NostrEvent } from './nostr/types';
import { MOBILE_POST_MAX_CHARS } from './mobile';
import { BOLT_OFF } from './bolt';

export const ANON_KEY = 'totemcillo:anon-sk';
const PUBLISH_TIMEOUT_MS = 10_000;
type Publisher = (ev: NostrEvent) => Promise<unknown>;

/** Signs with an anonymous key generated once and kept in localStorage (never the NIP-07 extension). */
export function anonSigner(storage: Storage = localStorage) {
  let hex = storage.getItem(ANON_KEY);
  if (!hex || !/^[0-9a-f]{64}$/.test(hex)) storage.setItem(ANON_KEY, (hex = bytesToHex(generateSecretKey())));
  const sk = hexToBytes(hex);
  return async (e: EventTemplate) => finalizeEvent(e, sk) as NostrEvent;
}

/** True when `text` has `#tag` as a whole hashtag (any case): `#lacryptaX` or `lacrypta` don't count. */
export const hasHashtag = (text: string, tag: string) => new RegExp(`(^|[^\\w#])#${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'i').test(text);

/** Anonymous message box: signs a kind 1 with the hashtags and publishes it straight to the relays. */
export function openCompose(hashtags: string[], publish: Publisher, storage?: Storage): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'zap-dialog m-compose';
  dialog.setAttribute('aria-labelledby', 'compose-title');
  dialog.innerHTML = `<header><h2 id="compose-title">Mandá mensaje anónimo</h2></header>
    <p class="m-compose-warn is-unzappable" role="note">${BOLT_OFF} Los mensajes anónimos no pueden ser zapeados</p>
    <form><textarea name="content" rows="5" maxlength="${MOBILE_POST_MAX_CHARS}" required></textarea>
    <p class="m-compose-hint" aria-live="polite"></p>
    <button class="zap-btn btn btn-lime" type="submit">Publicar</button></form>
    <p class="zap-error" role="alert"></p>
    <button type="button" class="zap-cancel btn btn-red" data-close>Cancelar</button>`;
  const form = dialog.querySelector('form')!, text = form.querySelector('textarea')!, send = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  text.value = hashtags.map((t) => `#${t}`).join(' ') + ' ';
  const missing = () => hashtags.filter((h) => !hasHashtag(text.value, h));
  const check = () => {
    const m = missing();
    send.disabled = m.length > 0;
    dialog.querySelector('.m-compose-hint')!.textContent = m.length ? `Falta el hashtag ${m.map((h) => `#${h}`).join(' ')}` : '';
  };
  text.addEventListener('input', check);
  const close = () => dialog.remove();
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('close', close); // Esc
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (missing().length) return check();
    send.disabled = true;
    dialog.querySelector('[role="alert"]')!.textContent = '';
    try {
      const ev = await anonSigner(storage)({ kind: 1, created_at: Math.floor(Date.now() / 1000), content: text.value.trim(), tags: hashtags.map((t) => ['t', t]) });
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([publish(ev), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), PUBLISH_TIMEOUT_MS); })]).finally(() => clearTimeout(timer));
      close();
    } catch {
      dialog.querySelector('[role="alert"]')!.textContent = 'No se pudo publicar, probá de nuevo';
      send.disabled = false;
    }
  });
  document.body.append(dialog);
  dialog.showModal?.();
  text.focus();
}
