import type { NostrEvent, Zap } from './types';

const MULT: Record<string, number> = { '': 1e11, m: 1e8, u: 1e5, n: 100, p: 0.1 };

/** Devuelve msats del monto codificado en el HRP de un bolt11, o null. */
export function bolt11ToMsats(invoice: string): number | null {
  const m = /^ln(?:bcrt|tbs|bc|tb|sb)(\d+)([munp]?)1/i.exec(invoice.trim());
  if (!m) return null;
  const v = Number(m[1]) * MULT[m[2].toLowerCase()];
  return Number.isFinite(v) ? Math.round(v) : null;
}

const tag = (ev: { tags: string[][] }, name: string) => ev.tags.find((t) => t[0] === name)?.[1];

/** Parsea un zap receipt (kind 9735). Devuelve null si no es válido o no tiene monto. */
export function parseZapReceipt(ev: NostrEvent): Zap | null {
  if (ev.kind !== 9735) return null;
  const postId = tag(ev, 'e');
  if (!postId) return null;
  let req: NostrEvent | null = null;
  const desc = tag(ev, 'description');
  if (desc) {
    try { req = JSON.parse(desc); } catch { req = null; }
  }
  let msats: number | null = null;
  const bolt11 = tag(ev, 'bolt11');
  if (bolt11) msats = bolt11ToMsats(bolt11);
  if (msats == null && req) {
    const a = Number(tag(req, 'amount'));
    if (Number.isFinite(a) && a > 0) msats = a;
  }
  if (msats == null || msats <= 0) return null;
  return {
    id: ev.id,
    postId,
    sender: req?.pubkey ?? tag(ev, 'P'),
    msats,
    comment: req?.content ?? '',
    created_at: ev.created_at,
  };
}
