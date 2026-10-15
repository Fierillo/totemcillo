import type { Moderation } from './nostr/store';
import { DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS } from '../server/settings';

const list = (x: unknown) => (Array.isArray(x) ? x.filter((v): v is string => typeof v === 'string') : []);
/** Moderation lists from an API response (empty if missing). */
export const moderationOf = (s: { hiddenPosts?: unknown; bannedPubkeys?: unknown; zapProviders?: unknown; startLine?: unknown } | null | undefined): Moderation =>
  ({ hiddenPosts: list(s?.hiddenPosts), bannedPubkeys: list(s?.bannedPubkeys), zapProviders: Array.isArray(s?.zapProviders) ? list(s.zapProviders) : DEFAULT_ZAP_PROVIDERS,
    startLine: typeof s?.startLine === 'string' ? s.startLine : DEFAULT_START_LINE });
