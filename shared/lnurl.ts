import { bech32 } from '@scure/base';

export const providerAllowed = (domain: string | undefined, list: string[]) =>
  !!domain && list.some((d) => domain === d || domain.endsWith(`.${d}`));

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
