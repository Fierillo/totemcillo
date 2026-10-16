import { bech32 } from '@scure/base';
import type { NostrEvent } from './types';
import type { LnurlInfo, Resolver } from './verify';
import { DEFAULT_ZAP_PROVIDERS } from '../../shared/settings';
import { providerAllowed } from './store';
import { finalizeEvent, generateSecretKey } from 'nostr-tools/pure';
import { bolt11ToMsats } from './zap';
import type { Post } from './types';

export type ProfileLoader = (pubkey: string) => Promise<NostrEvent | null>;
export type FetchLike = (url: string) => Promise<{ ok: boolean; json(): Promise<any> }>;

/** Deadline covers both headers and body, so a slow endpoint cannot hold a validation slot forever. */
const fetchLnurl: FetchLike = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error' });
    const data = res.ok ? await res.json() : null;
    return { ok: res.ok, json: async () => data };
  } finally { clearTimeout(timer); }
};

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

interface PayInfo extends LnurlInfo { url: string; callback?: string; minSendable?: number; maxSendable?: number }
interface Entry { p: Promise<PayInfo | null>; at: number; failed: boolean }

/** Resolves (and caches) the nostrPubkey that signs a recipient's zaps. */
export class LnurlResolver implements Resolver {
  private cache = new Map<string, Entry>();
  private cachePolicy = '';

  constructor(private loadProfile: ProfileLoader, private fetchFn: FetchLike = fetchLnurl, private retryMs = 300_000,
    private getProviders: () => string[] = () => DEFAULT_ZAP_PROVIDERS) {}

  resolve(pubkey: string): Promise<string | null> {
    return this.resolveInfo(pubkey).then((i) => i?.pubkey ?? null);
  }

  async resolveInfo(pubkey: string): Promise<PayInfo | null> {
    const policy = JSON.stringify(this.getProviders());
    if (policy !== this.cachePolicy) { this.cache.clear(); this.cachePolicy = policy; }
    let entry = this.cache.get(pubkey);
    if (!entry || (entry.failed && Date.now() - entry.at >= this.retryMs)) {
      const next: Entry = { p: this.lookup(pubkey), at: Date.now(), failed: false };
      next.p.then((v) => { next.failed = v === null; });
      this.cache.set(pubkey, next);
      entry = next;
    }
    const info = await entry.p;
    return info && providerAllowed(info.domain, this.getProviders()) ? info : null;
  }

  /** Only requests an unpaid invoice; the user's wallet pays it, and the receipt updates the feed. */
  async requestInvoice(post: Pick<Post, 'id' | 'pubkey'>, sats: number, relays: string[]): Promise<string> {
    const amount = sats * 1000;
    if (!Number.isSafeInteger(sats) || sats <= 0 || !Number.isSafeInteger(amount) || !/^[0-9a-f]{64}$/.test(post.id) || !/^[0-9a-f]{64}$/.test(post.pubkey))
      throw new Error('Ingresá un monto entero y positivo en sats.');
    const targets = [...new Set(relays)].filter((r) => r.startsWith('wss://') && r.length <= 2048).slice(0, 6);
    if (!targets.length) throw new Error('No hay relays disponibles para recibir el zap.');
    const info = await this.resolveInfo(post.pubkey);
    const callback = info?.callback && this.endpoint(info.callback);
    if (!info || !callback) throw new Error('El autor no tiene un proveedor de zaps compatible y autorizado.');
    if (!Number.isSafeInteger(info.minSendable) || !Number.isSafeInteger(info.maxSendable) || amount < info.minSendable! || amount > info.maxSendable!)
      throw new Error('El monto está fuera del rango admitido por la wallet del autor.');
    const lnurl = bech32.encode('lnurl', bech32.toWords(new TextEncoder().encode(info.url)), 2000);
    const request = finalizeEvent({ kind: 9734, created_at: Math.floor(Date.now() / 1000), content: '',
      tags: [['p', post.pubkey], ['e', post.id], ['amount', String(amount)], ['relays', ...targets], ['lnurl', lnurl], ['anon']],
    }, generateSecretKey());
    callback.searchParams.set('amount', String(amount));
    callback.searchParams.set('nostr', JSON.stringify(request));
    callback.searchParams.set('lnurl', lnurl);
    const response = await this.fetchFn(callback.href);
    const invoice = response.ok ? (await response.json())?.pr : null;
    if (!providerAllowed(info.domain, this.getProviders()) || !this.endpoint(callback.href)) throw new Error('El proveedor ya no está autorizado.');
    if (typeof invoice !== 'string' || invoice.length > 10000 || /\s/.test(invoice) || bolt11ToMsats(invoice) !== amount)
      throw new Error('No se pudo generar una factura válida para ese monto.');
    return invoice;
  }

  private endpoint(input: string): URL | null {
    try {
      const url = new URL(input);
      return url.protocol === 'https:' && !url.username && !url.password && !url.port && providerAllowed(url.hostname.toLowerCase(), this.getProviders()) ? url : null;
    } catch { return null; }
  }

  private async lookup(pubkey: string): Promise<PayInfo | null> {
    try {
      const profile = await this.loadProfile(pubkey);
      const url = profile && lnurlFromProfile(profile.content);
      if (!url) return null;
      const endpoint = this.endpoint(url);
      if (!endpoint) return null;
      const domain = endpoint.hostname.toLowerCase();
      const res = await this.fetchFn(url);
      if (!res.ok) return null;
      const j = await res.json();
      const ok = j?.allowsNostr === true && typeof j.nostrPubkey === 'string' && /^[0-9a-f]{64}$/.test(j.nostrPubkey);
      return ok ? { pubkey: j.nostrPubkey, domain, url, callback: j.callback, minSendable: j.minSendable, maxSendable: j.maxSendable } : null;
    } catch (e) {
      console.warn('LNURL not verifiable (CORS?), zap not counted', pubkey, e);
      return null;
    }
  }
}
