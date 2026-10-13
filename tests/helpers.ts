import { finalizeEvent, generateSecretKey, getPublicKey } from 'nostr-tools/pure';
import type { NostrEvent } from '../src/nostr/types';

export const keys = () => {
  const sk = generateSecretKey();
  return { sk, pk: getPublicKey(sk) };
};

/** Firma y devuelve un objeto plano (sin el símbolo de "ya verificado" de nostr-tools). */
export const sign = (sk: Uint8Array, t: { kind: number; created_at: number; content: string; tags: string[][] }): NostrEvent =>
  JSON.parse(JSON.stringify(finalizeEvent(t, sk)));

export function makeZap(o: { postId?: string; msats?: number; reqAmount?: string | null; reqP?: string; reqE?: string; comment?: string; created_at?: number } = {}) {
  const sender = keys(), server = keys(), recipient = keys();
  const postId = o.postId ?? 'a'.repeat(64);
  const msats = o.msats ?? 21000;
  const req = sign(sender.sk, {
    kind: 9734, created_at: 1, content: o.comment ?? 'grande',
    tags: [['p', o.reqP ?? recipient.pk], ['e', o.reqE ?? postId], ['relays', 'wss://x'], ...(o.reqAmount === null ? [] : [['amount', o.reqAmount ?? String(msats)]])],
  });
  const receipt = sign(server.sk, {
    kind: 9735, created_at: o.created_at ?? 100, content: '',
    tags: [['p', recipient.pk], ['e', postId], ['bolt11', `lnbc${msats / 100}n1pxyz`], ['description', JSON.stringify(req)]],
  });
  return { receipt, req, sender, server, recipient };
}
