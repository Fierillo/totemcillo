import type { Moderation } from './nostr/store';
import { DEFAULT_ZAP_PROVIDERS } from '../server/settings';

const list = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
/** Listas de moderación de una respuesta de la API (si faltan, vacías). */
export const moderationOf = (s: { hiddenPosts?: unknown; bannedPubkeys?: unknown; zapProviders?: unknown } | null | undefined): Moderation =>
  ({ hiddenPosts: list(s?.hiddenPosts), bannedPubkeys: list(s?.bannedPubkeys), zapProviders: Array.isArray(s?.zapProviders) ? list(s.zapProviders) : DEFAULT_ZAP_PROVIDERS });
