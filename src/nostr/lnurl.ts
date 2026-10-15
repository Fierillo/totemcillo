import { bech32 } from '@scure/base';
import type { NostrEvent } from './types';
import type { LnurlInfo, Resolver } from './verify';

export type ProfileLoader = (pubkey: string) => Promise<NostrEvent | null>;
export type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<any> }>;

/** LNURL-pay endpoint URL from a kind 0's content (lud16 or lud06). */
export function lnurlFromProfile(content: string): string | null {
  let meta: any;
  try { meta = JSON.parse(content); } catch { return null; }
  if (!meta || typeof meta !== 'object') return null;
  if (typeof meta.lud16 === 'string') {
    const [user, domain, extra] = meta.lud16.trim().split('@');
    if (extra === undefined && /^[a-z0-9._+-]+$/i.test(user ?? '') && /^[a-z0-9.-]+(:\d+)?$/i.test(domain ?? ''))
      return `https://${domain}/.well-known/lnurlp/${user}`;
  }
  if (typeof meta.lud06 === 'string') {
    try {
      const { words } = bech32.decode(meta.lud06.trim().toLowerCase() as `${string}1${string}`, 2000);
      const url = new TextDecoder().decode(bech32.fromWords(words));
      if (url.startsWith('https://')) return url;
    } catch { /* invalid */ }
  }
  return null;
}

interface Entry { p: Promise<LnurlInfo | null>; at: number; failed: boolean }

/** Resolves (and caches) the nostrPubkey that signs a recipient's zaps. */
export class LnurlResolver implements Resolver {
  private cache = new Map<string, Entry>();

  constructor(private loadProfile: ProfileLoader, private fetchFn: FetchLike = (u) => fetch(u), private retryMs = 300_000) {}

  resolve(pubkey: string): Promise<string | null> {
    return this.resolveInfo(pubkey).then((i) => i?.pubkey ?? null);
  }

  resolveInfo(pubkey: string): Promise<LnurlInfo | null> {
    const c = this.cache.get(pubkey);
    if (c && !(c.failed && Date.now() - c.at >= this.retryMs)) return c.p;
    const entry: Entry = { p: this.lookup(pubkey), at: Date.now(), failed: false };
    entry.p.then((v) => { entry.failed = v === null; });
    this.cache.set(pubkey, entry);
    return entry.p;
  }

  private async lookup(pubkey: string): Promise<LnurlInfo | null> {
    try {
      const profile = await this.loadProfile(pubkey);
      const url = profile && lnurlFromProfile(profile.content);
      if (!url) return null;
      const res = await this.fetchFn(url);
      if (!res.ok) return null;
      const j = await res.json();
      const ok = j?.allowsNostr === true && typeof j.nostrPubkey === 'string' && /^[0-9a-f]{64}$/.test(j.nostrPubkey);
      return ok ? { pubkey: j.nostrPubkey, domain: new URL(url).hostname.toLowerCase() } : null;
    } catch (e) {
      console.warn('LNURL not verifiable (CORS?), zap not counted', pubkey, e);
      return null;
    }
  }
}
