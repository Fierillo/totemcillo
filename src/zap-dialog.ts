import type { Post } from './nostr/types';
import type { ZapStore } from './nostr/store';
import { noteUri } from './nostr/link';
import { feedFor } from './livefeed';
import { esc } from './util';
import { renderSVG } from 'uqr';

export type InvoiceRequester = (post: Post, sats: number) => Promise<string>;

/** Legacy copy inside the modal (the rest of the document is inert while it is open). */
function legacyCopy(text: string, host: HTMLElement): boolean {
  if (typeof document.execCommand !== 'function') return false;
  const probe = document.createElement('textarea');
  probe.value = text;
  probe.setAttribute('readonly', '');
  probe.style.cssText = 'position:absolute;left:-9999px;top:0;opacity:0;';
  host.append(probe);
  try {
    probe.focus();
    probe.select();
    probe.setSelectionRange(0, text.length);
    return document.execCommand('copy');
  } catch {
    return false;
  } finally {
    probe.remove();
  }
}

/** The clipboard API can be missing, blocked by a webview or hang forever: try every path, never just one. */
async function copyText(text: string, host: HTMLElement): Promise<boolean> {
  try {
    const write = navigator.clipboard?.writeText?.(text);
    if (write) {
      await Promise.race([
        write,
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('clipboard timeout')), 2000)),
      ]);
      return true;
    }
  } catch { /* blocked or unavailable → legacy */ }
  try {
    return legacyCopy(text, host);
  } catch {
    return false;
  }
}

/** Kept outside the live feed so incoming events cannot dismiss the payment choices. */
export function openZapDialog(post: Post, relays: string[], requestInvoice?: InvoiceRequester, store?: ZapStore, opts: { onPaid?: () => void } = {}): () => void {
  const dialog = document.createElement('dialog');
  dialog.className = 'zap-dialog';
  dialog.setAttribute('aria-labelledby', 'zap-title');
  dialog.innerHTML = `<header><h2 id="zap-title">Zapear este post</h2><button type="button" data-close aria-label="Cerrar">✕</button></header>
    <div class="zap-choices"><a data-nostr-client href="${esc(noteUri(post, relays, 'nostr:{nevent}')!)}">Zapear desde cliente de Nostr<small>Usá tu perfil y tu cliente habitual.</small></a>
    <button type="button" data-wallet>Zapear desde wallet<small>Pago anónimo en Nostr: no se vinculará tu perfil.</small></button></div>
    <form hidden><p class="zap-note">Pago anónimo en Nostr: no se vinculará tu perfil. Tu wallet y el proveedor pueden registrar el pago.</p>
    <label>Monto (sats)<input name="sats" type="number" inputmode="numeric" min="1" step="1" value="21" required></label>
    <button class="zap-btn" type="submit">Generar factura</button></form>
    <p class="zap-error" role="alert"></p><div data-invoice hidden></div>`;
  const form = dialog.querySelector('form')!;
  const amount = form.querySelector<HTMLInputElement>('input')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const error = dialog.querySelector<HTMLElement>('[role="alert"]')!;
  let busy = false;
  let offLive: (() => void) | undefined;
  dialog.querySelector('[data-wallet]')!.addEventListener('click', () => {
    dialog.querySelector<HTMLElement>('.zap-choices')!.hidden = true;
    form.hidden = false;
    amount.focus();
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (busy || form.hidden || !form.reportValidity()) return;
    busy = true;
    submit.disabled = true;
    submit.textContent = 'Generando factura…';
    amount.disabled = true;
    error.textContent = '';
    try {
      if (!requestInvoice) throw new Error('El pago desde wallet no está disponible. Volvé a cargar la página.');
      const invoice = await requestInvoice(post, Number(amount.value));
      if (!dialog.open) return;
      const result = dialog.querySelector<HTMLElement>('[data-invoice]')!;
      result.innerHTML = `<p class="zap-note">Pago anónimo en Nostr · ${esc(amount.value)} sats</p>
        <button type="button" class="wallet-qr" data-copy aria-label="Copiar factura">${renderSVG(invoice.toUpperCase(), { ecc: 'M', border: 2 })}</button>
        <p class="zap-note" role="status"></p>
        <a class="zap-btn" data-open-wallet href="lightning:${esc(invoice)}">Abrir wallet</a>
        <p class="zap-note">No es una confirmación de pago. El total se actualizará cuando llegue el recibo del proveedor.</p>`;
      result.querySelector<HTMLButtonElement>('[data-copy]')!.addEventListener('click', async () => {
        const status = result.querySelector<HTMLElement>('[role="status"]')!;
        if (await copyText(invoice, dialog)) {
          status.textContent = 'Factura copiada';
          return;
        }
        status.textContent = 'No se pudo copiar con un toque. Seleccioná la factura para copiarla.';
        let manual = result.querySelector<HTMLTextAreaElement>('[data-manual]');
        if (!manual) {
          manual = document.createElement('textarea');
          manual.setAttribute('data-manual', '');
          manual.readOnly = true;
          manual.spellcheck = false;
          manual.value = invoice;
          status.after(manual);
        }
        manual.focus();
        manual.select();
        manual.setSelectionRange(0, invoice.length);
      });
      form.hidden = true;
      result.hidden = false;
      result.querySelector<HTMLAnchorElement>('[data-open-wallet]')!.focus();
      // Payment done: the receipt for this post arrives live → dismiss so the comment animation shows.
      // Watched on the shared feed so `onPaid` runs before it decides where that zap animates (row strike vs burst).
      if (store) offLive = feedFor(store).watch((e) => { if (e.type === 'zap' && e.postId === post.id) { close(); opts.onPaid?.(); } });
    } catch (e) {
      if (dialog.open) error.textContent = e instanceof Error ? e.message : 'No se pudo generar la factura. Intentá de nuevo.';
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = 'Generar factura';
      amount.disabled = false;
    }
  });
  const cleanup = () => { offLive?.(); offLive = undefined; };
  const close = () => { cleanup(); if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  dialog.addEventListener('close', () => { cleanup(); dialog.remove(); });
  document.body.append(dialog);
  dialog.showModal();
  return close;
}
