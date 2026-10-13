import { describe, expect, it } from 'vitest';
import { bolt11ToMsats, parseZapReceipt } from '../src/nostr/zap';

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
