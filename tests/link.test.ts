import { describe, expect, it } from 'vitest';
import { decode } from 'nostr-tools/nip19';
import { noteUri } from '../src/nostr/link';

const post = { id: 'd'.repeat(64), pubkey: 'e'.repeat(64), content: 'x', created_at: 1 };
const relays = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const nevent = (uri: string) => uri.match(/nevent1[02-9ac-hj-np-z]+/)![0];

describe('noteUri', () => {
  it('nostr:{nevent} con id, autor, kind y 2 relay hints', () => {
    const uri = noteUri(post, relays, 'nostr:{nevent}')!;
    expect(uri).toMatch(/^nostr:nevent1/);
    const d = decode(nevent(uri));
    expect(d.type).toBe('nevent');
    expect(d.data).toMatchObject({ id: post.id, author: post.pubkey, kind: 1, relays: relays.slice(0, 2) });
  });
  it('soporta otros formatos como njump', () => {
    expect(noteUri(post, relays, 'https://njump.me/{nevent}')).toMatch(/^https:\/\/njump\.me\/nevent1[a-z0-9]+$/);
  });
  it('omite el autor si no es hex válido y devuelve null si el id es inválido', () => {
    const d = decode(nevent(noteUri({ ...post, pubkey: '<img>' }, [], 'nostr:{nevent}')!));
    expect((d.data as any).author).toBeUndefined();
    expect(noteUri({ ...post, id: 'zz' }, relays, 'nostr:{nevent}')).toBeNull();
  });
});
