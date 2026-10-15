import { describe, expect, it, vi } from 'vitest';
import { bolt11ToMsats, parseZapReceipt } from '../src/nostr/zap';
import { checkZapReceipt, validateZapReceipt } from '../src/nostr/verify';
import { keys, makeZap, sign } from './helpers';

const receipt = (o: { e?: string; bolt11?: string; amount?: string; desc?: string } = {}) => {
  const req = { kind: 9734, pubkey: 'sender', content: 'grande!', tags: o.amount ? [['amount', o.amount]] : [], created_at: 1, id: 'r' };
  const tags = [['e', o.e ?? 'post1'], ['description', o.desc ?? JSON.stringify(req)]];
  if (o.bolt11) tags.push(['bolt11', o.bolt11]);
  return { id: 'z1', pubkey: 'lnurl', kind: 9735, created_at: 100, content: '', tags };
};

describe('bolt11ToMsats', () => {
  it('parsea multiplicadores', () => {
    expect(bolt11ToMsats('lnbc10u1pjxyz')).toBe(1_000_000);
    expect(bolt11ToMsats('lnbc2500n1pabc')).toBe(250_000);
    expect(bolt11ToMsats('lnbc1m1pabc')).toBe(100_000_000);
    expect(bolt11ToMsats('lnbc10p1pabc')).toBe(1);
    expect(bolt11ToMsats('lnbc2')).toBeNull();
    expect(bolt11ToMsats('basura')).toBeNull();
  });
});

describe('parseZapReceipt', () => {
  it('usa bolt11 primero y extrae sender, comentario y post', () => {
    const z = parseZapReceipt(receipt({ bolt11: 'lnbc21u1pxx', amount: '5000' }))!;
    expect(z).toEqual({ id: 'z1', postId: 'post1', sender: 'sender', msats: 2_100_000, comment: 'grande!', created_at: 100 });
  });
  it('cae al amount de la zap request', () => {
    expect(parseZapReceipt(receipt({ amount: '21000' }))!.msats).toBe(21000);
  });
  it('tolera description inválida si hay bolt11', () => {
    const z = parseZapReceipt(receipt({ bolt11: 'lnbc1u1px', desc: '{no json' }))!;
    expect(z.msats).toBe(100_000);
    expect(z.comment).toBe('');
  });
  it('rechaza sin monto, sin e o kind incorrecto', () => {
    expect(parseZapReceipt(receipt())).toBeNull();
    expect(parseZapReceipt({ ...receipt({ amount: '1000' }), tags: [] })).toBeNull();
    expect(parseZapReceipt({ ...receipt({ amount: '1000' }), kind: 1 })).toBeNull();
  });
});

describe('validación NIP-57', () => {
  type Z = ReturnType<typeof makeZap>;
  const resign = (z: Z, tags: string[][], kind = 9735) => sign(z.server.sk, { kind, created_at: z.receipt.created_at, content: '', tags });
  const tagsWith = (z: Z, name: string, value: string) => z.receipt.tags.map((t) => t[0] === name ? [name, value] : t);
  it('acepta receipts válidos y requests sin amount', () => {
    const z = makeZap({ msats: 21000, comment: 'vamo' });
    expect(checkZapReceipt(z.receipt)).toMatchObject({ id: z.receipt.id, postId: z.receipt.tags.find((t) => t[0] === 'e')![1], msats: 21000, sender: z.sender.pk, comment: 'vamo' });
    expect(checkZapReceipt(makeZap({ reqAmount: null }).receipt)).not.toBeNull();
  });
  it('rechaza firma inválida o kind incorrecto del receipt', () => {
    const z = makeZap();
    expect(checkZapReceipt({ ...z.receipt, created_at: 999 })).toBeNull();
    expect(checkZapReceipt(resign(z, z.receipt.tags, 1))).toBeNull();
  });
  it('rechaza requests mal firmadas, de otro kind o no parseables', () => {
    const z = makeZap();
    expect(checkZapReceipt(resign(z, tagsWith(z, 'description', JSON.stringify({ ...z.req, content: 'otro' }))))).toBeNull();
    const wrongKind = sign(z.sender.sk, { kind: 1, created_at: 1, content: '', tags: z.req.tags });
    expect(checkZapReceipt(resign(z, tagsWith(z, 'description', JSON.stringify(wrongKind))))).toBeNull();
    expect(checkZapReceipt(resign(z, tagsWith(z, 'description', '{roto')))).toBeNull();
  });
  it('exige coincidencia de destinatario, post y monto; exige bolt11', () => {
    expect(checkZapReceipt(makeZap({ reqP: keys().pk }).receipt)).toBeNull();
    expect(checkZapReceipt(makeZap({ reqE: 'b'.repeat(64) }).receipt)).toBeNull();
    expect(checkZapReceipt(makeZap({ msats: 21000, reqAmount: '1000' }).receipt)).toBeNull();
    const z = makeZap();
    expect(checkZapReceipt(resign(z, z.receipt.tags.filter((t) => t[0] !== 'bolt11')))).toBeNull();
  });
  it('exige que firme el nostrPubkey del LNURL del destinatario', async () => {
    const z = makeZap(), ok = { resolve: vi.fn(async () => z.server.pk) };
    expect(await validateZapReceipt(z.receipt, ok)).not.toBeNull();
    expect(ok.resolve).toHaveBeenCalledWith(z.recipient.pk);
    expect(await validateZapReceipt(z.receipt, { resolve: async () => keys().pk })).toBeNull();
    expect(await validateZapReceipt(z.receipt, { resolve: async () => null })).toBeNull();
  });
  it('no consulta el LNURL de receipts inválidos', async () => {
    const resolver = { resolve: vi.fn(async () => 'x') };
    expect(await validateZapReceipt(makeZap({ reqP: keys().pk }).receipt, resolver)).toBeNull();
    expect(resolver.resolve).not.toHaveBeenCalled();
  });
});
