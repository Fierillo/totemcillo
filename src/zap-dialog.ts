import type { Post } from './nostr/types';
import { MAX_COMMENT, type ZapStore } from './nostr/store';
import { noteUri } from './nostr/link';
import { feedFor } from './livefeed';
import { esc } from './util';
import { BOLT } from './bolt';
import { renderSVG } from 'uqr';
import { bech32 } from '@scure/base';

/** Purple Nostr ostrich (simplified) and a wallet, inline: no external assets. */
const NOSTR_ICON = '<svg class="zap-icon" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24"><rect width="24" height="24" rx="5" fill="#8e30eb"/><path fill="#fff" d="M15.6 4.2c-1.3 0-2.3.9-2.5 2.1-.1.7.1 1.3.5 1.8L12 11.4c-2.6.1-4.9 1.6-5.9 3.9l-.6 1.4 1.4.3 1.9-.9v3.7h1.5v-3.2l1.3 1.6v1.6h1.5V17l1.4-1.5c1.2-1.3 1.6-3.1 1.1-4.8l1-3.1h1.6l1.5-1.2-1.5-.6c-.4-.9-1.3-1.6-2.6-1.6Z"/><circle cx="15.8" cy="6.2" r=".6" fill="#8e30eb"/></svg>';
const WALLET_ICON = '<svg class="zap-icon" aria-hidden="true" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M4 7.5V18a2 2 0 0 0 2 2h13V8H6a2 2 0 0 1-2-2 2 2 0 0 1 2-2h11v4"/><path d="M15 12h5v4h-5a2 2 0 0 1 0-4Z"/></svg>';

/** Success bolt shown this long (counted while the page is visible) before the modal closes itself. */
export const PAID_CLOSE_MS = { ms: 3000 };

export type InvoiceRequester = (post: Post, sats: number, message?: string) => Promise<string>;

/** Invoice shown but not paid yet: survives a reload (Android kills the tab while the user is in the wallet). */
interface PendingZap { postId: string; pubkey: string; sats: number; invoice: string; createdAt: number; expiresAt: number }
export const PENDING_ZAP_KEY = 'totemcillo:pending-zap';
const nowSec = () => Math.floor(Date.now() / 1000);

/** Unix expiry of a bolt11 (timestamp + `x` tag, 3600 s by default); null if it can't be decoded. */
export function bolt11Expiry(invoice: string): number | null {
  const dec = bech32.decodeUnsafe(invoice.toLowerCase() as `${string}1${string}`, 10_000);
  if (!dec || dec.words.length < 7 + 104) return null;
  const w = dec.words, int = (from: number, len: number) => w.slice(from, from + len).reduce((n, x) => n * 32 + x, 0);
  const ts = int(0, 7);
  let expiry = 3600;
  for (let i = 7; i + 3 <= w.length - 104;) {
    const len = int(i + 1, 2);
    if (w[i] === 6) expiry = int(i + 3, len);
    i += 3 + len;
  }
  return ts + expiry;
}

const storage = (): Storage | undefined => { try { return globalThis.localStorage; } catch { return undefined; } };
const clearPendingZap = () => { try { storage()?.removeItem(PENDING_ZAP_KEY); } catch { /* storage unavailable */ } };
const savePendingZap = (p: PendingZap) => { try { storage()?.setItem(PENDING_ZAP_KEY, JSON.stringify(p)); } catch { /* storage unavailable */ } };

/** The pending invoice if still valid; corrupt or expired entries are discarded. */
export function loadPendingZap(): PendingZap | null {
  let p: any = null;
  try { p = JSON.parse(storage()?.getItem(PENDING_ZAP_KEY) ?? 'null'); } catch { /* corrupt */ }
  const ok = p && typeof p.postId === 'string' && typeof p.pubkey === 'string' && typeof p.invoice === 'string'
    && [p.sats, p.createdAt, p.expiresAt].every((n) => typeof n === 'number' && Number.isFinite(n)) && p.expiresAt > nowSec();
  if (ok) return p as PendingZap;
  if (storage()?.getItem(PENDING_ZAP_KEY) != null) clearPendingZap();
  return null;
}

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
export function openZapDialog(post: Post, relays: string[], requestInvoice?: InvoiceRequester, store?: ZapStore, opts: { onPaid?: () => void; resume?: PendingZap } = {}): () => void {
  const dialog = document.createElement('dialog');
  dialog.className = 'zap-dialog';
  dialog.setAttribute('aria-labelledby', 'zap-title');
  dialog.innerHTML = `<header><h2 id="zap-title">Zapear</h2></header>
    <div class="zap-choices"><a data-nostr-client href="${esc(noteUri(post, relays, 'nostr:{nevent}')!)}">${NOSTR_ICON}Cliente Nostr</a>
    <button type="button" data-wallet>${WALLET_ICON}Wallet anónima</button></div>
    <form hidden>
    <label>Monto (sats)<input name="sats" type="number" inputmode="numeric" min="1" step="1" value="21" required></label>
    <label>Mensaje (opcional)<input name="message" type="text" maxlength="${MAX_COMMENT}" autocomplete="off" placeholder="Se publica con el zap"></label>
    <button class="zap-btn" type="submit">Generar factura</button></form>
    <p class="zap-error" role="alert"></p><div data-invoice hidden></div>
    <button type="button" class="zap-cancel" data-close>Cancelar</button>`;
  const form = dialog.querySelector('form')!;
  const amount = form.querySelector<HTMLInputElement>('[name="sats"]')!;
  const message = form.querySelector<HTMLInputElement>('[name="message"]')!;
  const submit = form.querySelector<HTMLButtonElement>('[type="submit"]')!;
  const error = dialog.querySelector<HTMLElement>('[role="alert"]')!;
  let busy = false;
  let closing = false;
  let offLive: (() => void) | undefined;
  let paidShown = false, stopWait = () => {}, timer: ReturnType<typeof setTimeout> | undefined;
  /** Invoice state (fresh or restored after a reload): persisted until paid or Cancelar. */
  const showInvoice = (p: PendingZap) => {
    const invoice = p.invoice;
    const result = dialog.querySelector<HTMLElement>('[data-invoice]')!;
    result.innerHTML = `<p class="zap-note">${esc(String(p.sats))} sats</p>
      <button type="button" class="wallet-qr" data-copy aria-label="Copiar factura">${renderSVG(invoice.toUpperCase(), { ecc: 'M', border: 2 })}</button>
      <p class="zap-note" role="status"></p>
      <a class="zap-btn" data-open-wallet href="lightning:${esc(invoice)}">Abrir wallet</a>
      <p class="zap-note">El total se actualiza al confirmarse el pago.</p>`;
    result.querySelector<HTMLButtonElement>('[data-copy]')!.addEventListener('click', async () => {
      const status = result.querySelector<HTMLElement>('[role="status"]')!;
      if (await copyText(invoice, dialog)) {
        status.textContent = 'Factura copiada';
        return;
      }
      status.textContent = 'No se pudo copiar. Seleccioná la factura.';
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
    savePendingZap(p);
    if (!store) return;
    // A receipt carrying a bolt11 must be for this invoice (someone else may zap the same post); without one, the post is enough.
    const mine = (b?: string) => !b || b.toLowerCase() === invoice.toLowerCase();
    const paid = () => {
      if (closing || paidShown) return;
      if (!PAID_CLOSE_MS.ms) { close(); opts.onPaid?.(); return; }
      // Back from the wallet/client: show the bolt for a moment (timer starts once the tab is visible), then close.
      paidShown = true;
      clearPendingZap();
      offLive?.(); offLive = undefined;
      result.innerHTML = `<p class="zap-paid" role="status">${BOLT}¡Zap enviado!</p>`;
      opts.onPaid?.();
      const start = () => {
        if (document.visibilityState !== 'visible') return;
        document.removeEventListener('visibilitychange', start);
        timer = setTimeout(close, PAID_CLOSE_MS.ms);
      };
      stopWait = () => { document.removeEventListener('visibilitychange', start); clearTimeout(timer); };
      document.addEventListener('visibilitychange', start);
      start();
    };
    // Payment done: the receipt for this post arrives live → dismiss so the comment animation shows.
    // Watched on the shared feed so `onPaid` runs before it decides where that zap animates (row strike vs burst).
    const offWatch = feedFor(store).watch((e) => { if (e.type === 'zap' && e.postId === post.id && mine(e.bolt11)) paid(); });
    // After a reload the receipt may arrive in the relay backfill, too old to count as "live": any new zap
    // for this post not older than the invoice (60 s clock slack) is taken as paid. Zaps already known don't count.
    const known = new Set(store.zaps.keys());
    const offChange = store.onChange(() => {
      for (const z of store.zaps.values()) if (!known.has(z.id) && z.postId === post.id && mine(z.bolt11) && z.created_at >= p.createdAt - 60) return paid();
    });
    offLive = () => { offWatch(); offChange(); };
  };
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
    message.disabled = true;
    error.textContent = '';
    try {
      if (!requestInvoice) throw new Error('El pago desde wallet no está disponible. Volvé a cargar la página.');
      const text = message.value.trim();
      const invoice = await (text ? requestInvoice(post, Number(amount.value), text) : requestInvoice(post, Number(amount.value)));
      if (!dialog.open) return;
      const createdAt = nowSec();
      showInvoice({ postId: post.id, pubkey: post.pubkey, sats: Number(amount.value), invoice, createdAt, expiresAt: bolt11Expiry(invoice) ?? createdAt + 3600 });
    } catch (e) {
      if (dialog.open) error.textContent = e instanceof Error ? e.message : 'No se pudo generar la factura. Intentá de nuevo.';
    } finally {
      busy = false;
      submit.disabled = false;
      submit.textContent = 'Generar factura';
      amount.disabled = false;
      message.disabled = false;
    }
  });
  const close = () => { closing = true; stopWait(); clearPendingZap(); offLive?.(); offLive = undefined; if (dialog.open) dialog.close(); dialog.remove(); };
  dialog.querySelector('[data-close]')!.addEventListener('click', close);
  // Only a paid receipt or Cancelar close it: the user leaves for the wallet and comes back.
  // Escape / Android back fire 'cancel' (ignored); Chrome may skip it without user activation and close anyway → reopen.
  dialog.addEventListener('cancel', (e) => e.preventDefault());
  dialog.addEventListener('close', () => { if (!closing && dialog.isConnected) dialog.showModal(); });
  document.body.append(dialog);
  dialog.showModal();
  if (opts.resume) {
    dialog.querySelector<HTMLElement>('.zap-choices')!.hidden = true;
    amount.value = String(opts.resume.sats);
    showInvoice(opts.resume);
  }
  return close;
}
