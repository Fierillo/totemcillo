import { describe, expect, it } from 'vitest';
import { bolt11ToMsats, parseZapReceipt } from '../src/nostr/zap';
import { ZapStore } from '../src/nostr/store';

const receipt = (over: Partial<{ id: string; e: string; bolt11: string; amount: string; created_at: number }> = {}) => {
  const req = { kind: 9734, pubkey: 'sender', content: 'grande!', tags: over.amount ? [['amount', over.amount]] : [], created_at: 1, id: 'r' };
  const tags = [['e', over.e ?? 'post1'], ['description', JSON.stringify(req)]];
  if (over.bolt11) tags.push(['bolt11', over.bolt11]);
  return { id: over.id ?? 'z1', pubkey: 'lnurl', kind: 9735, created_at: over.created_at ?? 100, content: '', tags };
};

describe('bolt11ToMsats', () => {
  it('parsea multiplicadores', () => {
    expect(bolt11ToMsats('lnbc10u1pjxyz')).toBe(1_000_000);
    expect(bolt11ToMsats('lnbc2500n1pabc')).toBe(250_000);
    expect(bolt11ToMsats('lnbc1m1pabc')).toBe(100_000_000);
    expect(bolt11ToMsats('lnbc10p1pabc')).toBe(1);
    expect(bolt11ToMsats('lnbc1pabc')).toBeNull();
    expect(bolt11ToMsats('basura')).toBeNull();
  });
});

describe('parseZapReceipt', () => {
  it('usa bolt11 primero', () => {
    const z = parseZapReceipt(receipt({ bolt11: 'lnbc21u1pxx', amount: '5000' }))!;
    expect(z.msats).toBe(2_100_000);
    expect(z.sender).toBe('sender');
    expect(z.comment).toBe('grande!');
    expect(z.postId).toBe('post1');
  });
  it('cae al amount de la zap request', () => {
    expect(parseZapReceipt(receipt({ amount: '21000' }))!.msats).toBe(21000);
  });
  it('rechaza sin monto, sin e o kind incorrecto', () => {
    expect(parseZapReceipt(receipt())).toBeNull();
    expect(parseZapReceipt({ ...receipt({ amount: '1000' }), tags: [] })).toBeNull();
    expect(parseZapReceipt({ ...receipt({ amount: '1000' }), kind: 1 })).toBeNull();
  });
});

describe('ZapStore', () => {
  const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

  it('agrega sats por post, deduplica y ordena', () => {
    const s = new ZapStore();
    s.addPost({ id: 'a', pubkey: 'p', content: 'A', created_at: 1 });
    s.addPost({ id: 'b', pubkey: 'p', content: 'B', created_at: 2 });
    s.addZap({ id: '1', postId: 'a', msats: 1000, comment: '', created_at: 10 });
    s.addZap({ id: '1', postId: 'a', msats: 1000, comment: '', created_at: 10 });
    s.addZap({ id: '2', postId: 'b', msats: 5000, comment: '', created_at: 20 });
    s.addZap({ id: '3', postId: 'a', msats: 500, comment: '', created_at: 30 });
    const st = s.stats();
    expect(st.map((x) => [x.postId, x.msats])).toEqual([['b', 5000], ['a', 1500]]);
    expect(s.top(10, 25).map((x) => x.postId)).toEqual(['a']);
    expect(s.latestZaps(2).map((z) => z.id)).toEqual(['3', '2']);
  });

  it('persiste y recarga', () => {
    const storage = mem();
    const s = new ZapStore(storage);
    s.addPost({ id: 'a', pubkey: 'p', content: 'A', created_at: 1 });
    s.addZap({ id: '1', postId: 'a', msats: 1000, comment: '', created_at: 10 });
    s.save();
    const s2 = new ZapStore(storage);
    expect(s2.stats()[0].msats).toBe(1000);
  });
});
