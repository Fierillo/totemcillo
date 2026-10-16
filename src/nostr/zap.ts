import type { NostrEvent, Zap } from './types';

const MULT: Record<string, number> = { '': 1e11, m: 1e8, u: 1e5, n: 100, p: 0.1 };

export function bolt11ToMsats(invoice: string): number | null {
  const m = /^ln(?:bcrt|tbs|bc|tb|sb)(\d+)([munp]?)1/i.exec(invoice.trim());
  if (!m) return null;
  return Math.round(Number(m[1]) * MULT[m[2].toLowerCase()]);
}

const tag = (ev: { tags: string[][] }, name: string) => ev.tags.find((t) => t[0] === name)?.[1];

function zapRequest(ev: NostrEvent): NostrEvent | null {
  try {
    return JSON.parse(tag(ev, 'description') ?? '');
  } catch {
    return null;
  }
}

function amountMsats(ev: NostrEvent, req: NostrEvent | null): number | null {
  const bolt11 = tag(ev, 'bolt11');
  const fromInvoice = bolt11 ? bolt11ToMsats(bolt11) : null;
  if (fromInvoice) return fromInvoice;
  const a = Number(req && tag(req, 'amount'));
  return Number.isFinite(a) && a > 0 ? a : null;
}

export function parseZapReceipt(ev: NostrEvent): Zap | null {
  if (ev.kind !== 9735) return null;
  const postId = tag(ev, 'e');
  if (!postId) return null;
  const req = zapRequest(ev);
  const msats = amountMsats(ev, req);
  if (!msats) return null;
  const anonymous = Array.isArray(req?.tags) && req.tags.some((t) => Array.isArray(t) && t[0] === 'anon');
  return { id: ev.id, postId, sender: anonymous ? undefined : req?.pubkey ?? tag(ev, 'P'), msats, comment: req?.content ?? '', created_at: ev.created_at };
}
