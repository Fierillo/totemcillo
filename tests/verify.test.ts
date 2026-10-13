import { describe, expect, it, vi } from 'vitest';
import { checkZapReceipt, validateZapReceipt } from '../src/nostr/verify';
import { keys, makeZap, sign } from './helpers';

type Z = ReturnType<typeof makeZap>;
const resign = (z: Z, tags: string[][], kind = 9735) => sign(z.server.sk, { kind, created_at: z.receipt.created_at, content: '', tags });
const tagsWith = (z: Z, name: string, value: string) => z.receipt.tags.map((t) => (t[0] === name ? [name, value] : t));

describe('checkZapReceipt (NIP-57)', () => {
  it('acepta un receipt válido', () => {
    const z = makeZap({ msats: 21000, comment: 'vamo' });
    expect(checkZapReceipt(z.receipt)).toMatchObject({ id: z.receipt.id, postId: 'a'.repeat(64), msats: 21000, sender: z.sender.pk, comment: 'vamo' });
  });
  it('acepta zap request sin amount', () => {
    expect(checkZapReceipt(makeZap({ reqAmount: null }).receipt)).not.toBeNull();
  });
  it('rechaza receipt con firma inválida o de otro kind', () => {
    const z = makeZap();
    expect(checkZapReceipt({ ...z.receipt, created_at: 999 })).toBeNull();
    expect(checkZapReceipt(resign(z, z.receipt.tags, 1))).toBeNull();
  });
  it('rechaza zap request mal firmada, de otro kind o no parseable', () => {
    const z = makeZap();
    expect(checkZapReceipt(resign(z, tagsWith(z, 'description', JSON.stringify({ ...z.req, content: 'otro' }))))).toBeNull();
    const k1 = sign(z.sender.sk, { kind: 1, created_at: 1, content: '', tags: z.req.tags });
    expect(checkZapReceipt(resign(z, tagsWith(z, 'description', JSON.stringify(k1))))).toBeNull();
    expect(checkZapReceipt(resign(z, tagsWith(z, 'description', '{roto')))).toBeNull();
  });
  it('rechaza si p o e de la zap request no coinciden', () => {
    expect(checkZapReceipt(makeZap({ reqP: keys().pk }).receipt)).toBeNull();
    expect(checkZapReceipt(makeZap({ reqE: 'b'.repeat(64) }).receipt)).toBeNull();
  });
  it('rechaza si el monto del bolt11 no coincide con amount o falta bolt11', () => {
    expect(checkZapReceipt(makeZap({ msats: 21000, reqAmount: '1000' }).receipt)).toBeNull();
    const z = makeZap();
    expect(checkZapReceipt(resign(z, z.receipt.tags.filter((t) => t[0] !== 'bolt11')))).toBeNull();
  });
});

describe('validateZapReceipt', () => {
  it('exige que el receipt lo firme el nostrPubkey del LNURL del destinatario', async () => {
    const z = makeZap();
    const ok = { resolve: vi.fn(async () => z.server.pk) };
    expect(await validateZapReceipt(z.receipt, ok)).not.toBeNull();
    expect(ok.resolve).toHaveBeenCalledWith(z.recipient.pk);
    expect(await validateZapReceipt(z.receipt, { resolve: async () => keys().pk })).toBeNull();
    expect(await validateZapReceipt(z.receipt, { resolve: async () => null })).toBeNull();
  });
  it('no consulta el LNURL si el receipt es inválido', async () => {
    const r = { resolve: vi.fn(async () => 'x') };
    expect(await validateZapReceipt(makeZap({ reqP: keys().pk }).receipt, r)).toBeNull();
    expect(r.resolve).not.toHaveBeenCalled();
  });
});
