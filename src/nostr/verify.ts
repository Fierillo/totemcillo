import { verifyEvent } from 'nostr-tools/pure';
import type { NostrEvent, Zap } from './types';
import { bolt11ToMsats, parseZapReceipt } from './zap';

export interface LnurlInfo { pubkey: string; domain: string }
export interface Resolver {
  resolve(recipientPubkey: string): Promise<string | null>;
  /** Además del nostrPubkey, el dominio del LNURL (para la lista de proveedores). */
  resolveInfo?(recipientPubkey: string): Promise<LnurlInfo | null>;
}

const tag = (ev: { tags: string[][] }, name: string) => ev.tags.find((t) => t[0] === name)?.[1];

/** Firma e id válidos (nunca tira). */
export function isSigned(ev: NostrEvent): boolean {
  try {
    return verifyEvent(ev as Parameters<typeof verifyEvent>[0]);
  } catch {
    return false;
  }
}

function zapRequest(ev: NostrEvent): NostrEvent | null {
  try {
    const req = JSON.parse(tag(ev, 'description') ?? '');
    return req && req.kind === 9734 && Array.isArray(req.tags) && isSigned(req) ? req : null;
  } catch {
    return null;
  }
}

/** Validación NIP-57 que no depende de la red (todo menos el nostrPubkey del LNURL). */
export function checkZapReceipt(ev: NostrEvent): Zap | null {
  if (ev.kind !== 9735 || !isSigned(ev)) return null;
  const req = zapRequest(ev);
  if (!req) return null;
  const p = tag(ev, 'p'), e = tag(ev, 'e');
  if (!p || tag(req, 'p') !== p || !e || tag(req, 'e') !== e) return null;
  const bolt11 = tag(ev, 'bolt11');
  const msats = bolt11 ? bolt11ToMsats(bolt11) : null;
  if (!msats) return null;
  const amount = tag(req, 'amount');
  if (amount !== undefined && Number(amount) !== msats) return null;
  return parseZapReceipt(ev);
}

/** Validación completa: además el receipt tiene que venir del nostrPubkey del LNURL del destinatario. */
export async function validateZapReceipt(ev: NostrEvent, resolver: Resolver): Promise<Zap | null> {
  const zap = checkZapReceipt(ev);
  if (!zap) return null;
  const p = tag(ev, 'p')!;
  if (resolver.resolveInfo) {
    const info = await resolver.resolveInfo(p);
    return info && info.pubkey === ev.pubkey ? { ...zap, domain: info.domain } : null;
  }
  const expected = await resolver.resolve(p);
  return expected && expected === ev.pubkey ? zap : null;
}
