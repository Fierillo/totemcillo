import { neventEncode } from 'nostr-tools/nip19';
import type { Post } from './types';

const HEX64 = /^[0-9a-f]{64}$/;

/** URI para abrir la nota (template con {nevent}); null si el id no es válido. */
export function noteUri(post: Post, relays: string[], template: string): string | null {
  if (!HEX64.test(post.id)) return null;
  const nevent = neventEncode({
    id: post.id,
    kind: 1,
    relays: relays.slice(0, 2),
    ...(HEX64.test(post.pubkey) ? { author: post.pubkey } : {}),
  });
  return template.replace('{nevent}', nevent);
}
