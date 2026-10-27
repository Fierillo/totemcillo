import type { Announcement } from './announcement';
import type { Moderation } from './nostr/store';
import { moderationOf } from './moderation-lists';

interface RemoteOptions { fetchFn?: typeof fetch; announcement: Announcement; onModeration?: (m: Moderation) => void }

/** Mobile only needs the announcement and moderation, not the scene schedule. */
export function createRemote(o: RemoteOptions) {
  const fetchFn = o.fetchFn ?? fetch;

  async function poll(): Promise<void> {
    try {
      const res = await fetchFn('/api/settings', { cache: 'no-store' });
      if (!res.ok) return;
      const s = await res.json();
      if (!s || typeof s !== 'object') return;
      if (typeof s.announcement === 'string') o.announcement.set(s.announcement);
      o.onModeration?.(moderationOf(s));
    } catch {
      /* no API (static site) or no network: ignored */
    }
  }

  return {
    poll,
    start(intervalMs: number): () => void {
      void poll();
      const t = setInterval(() => void poll(), intervalMs);
      return () => clearInterval(t);
    },
  };
}
