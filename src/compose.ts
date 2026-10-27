import { finalizeEvent, generateSecretKey, type EventTemplate } from 'nostr-tools/pure';
import { bytesToHex, hexToBytes } from 'nostr-tools/utils';
import type { NostrEvent } from './nostr/types';
import { MOBILE_POST_MAX_CHARS } from './mobile';

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

/** Anonymous message box: signs a kind 1 with the hashtags and publishes it straight to the relays. */
export function openCompose(hashtags: string[], publish: Publisher, storage?: Storage): void {
  const dialog = document.createElement('dialog');
  dialog.className = 'zap-dialog m-compose';
  dialog.setAttribute('aria-labelledby', 'compose-title');
  dialog.innerHTML = `<header><h2 id="compose-title">Mandá mensaje anónimo</h2></header>
    <p class="m-compose-warn" role="note">⚠️ Los mensajes anónimos <strong>NO PODRÁN SER ZAPEADOS</strong></p>
    <form><p class="zap-note">Se publica con una identidad anónima guardada en este navegador.</p>
    <textarea name="content" rows="5" maxlength="${MOBILE_POST_MAX_CHARS}" required></textarea>
    <button class="zap-btn" type="submit">Publicar</button></form>
    <p class="zap-error" role="alert"></p>
    <button type="button" class="zap-cancel" data-close>Cancelar</button>`;
  const form = dialog.querySelector('form')!, text = form.querySelector('textarea')!, send = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  text.value = hashtags.map((t) => `#${t}`).join(' ') + ' ';
  const close = () => dialog.remove();
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('close', close); // Esc
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
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
