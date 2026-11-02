import type { IncomingMessage, ServerResponse } from 'node:http';
import { SimplePool } from 'nostr-tools/pool';
import { verifyEvent } from 'nostr-tools/pure';
import { lnurlFromProfile, providerAllowed } from '../shared/lnurl.js';
import { DEFAULT_ZAP_PROVIDERS, type Settings } from '../shared/settings.js';
import { clientIp, redisFromEnv, serviceUnavailable } from './node.js';
import { memoryStorage, type Storage } from './storage.js';

/** Redis TTLs (seconds): a 'yes' rarely changes; a 'no' is re-checked sooner. Errors are never stored. */
export const ZAPPABLE_TTL = { yes: 3 * 3600, no: 1800 };
/** Uncached lookups per IP (each one may open relay sockets and an outbound HTTPS request). */
const RATE = { max: 120, windowSec: 600 };
const RELAYS = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'];
const MAX_BYTES = 64 * 1024;
const HEX = /^[0-9a-f]{64}$/;

type FetchText = (url: string) => Promise<{ status: number; text(): Promise<string> }>;
interface Lookup { loadProfile: (pk: string) => Promise<{ content: string } | null>; fetchText: FetchText; providers: string[] }

/** https only, no redirects, 5 s deadline for headers and body, body capped at MAX_BYTES. */
const fetchText: FetchText = async (url) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);
  try {
    const res = await fetch(url, { signal: controller.signal, redirect: 'error', headers: { accept: 'application/json' } });
    if (Number(res.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('too large');
    const reader = res.body?.getReader();
    let text = '', size = 0;
    const dec = new TextDecoder();
    for (;;) {
      const r = await reader?.read();
      if (!r || r.done) break;
      size += r.value.byteLength;
      if (size > MAX_BYTES) { void reader?.cancel(); throw new Error('too large'); }
      text += dec.decode(r.value, { stream: true });
    }
    return { status: res.status, text: async () => text };
  } finally { clearTimeout(timer); }
};

let pool: SimplePool | undefined;
const loadProfile = async (pk: string) => {
  pool ??= new SimplePool();
  const evs = await pool.querySync(RELAYS, { kinds: [0], authors: [pk] }, { maxWait: 4000 });
  return evs.filter((e) => e.kind === 0 && e.pubkey === pk && verifyEvent(e)).sort((a, b) => b.created_at - a.created_at)[0] ?? null;
};

/** Same rules as the client resolver: true/false is a real answer; network or upstream 5xx errors throw. */
export async function checkZappable(pk: string, o: Lookup): Promise<boolean> {
  const profile = await o.loadProfile(pk);
  const href = profile && lnurlFromProfile(profile.content);
  if (!href) return false;
  const url = new URL(href);
  if (url.protocol !== 'https:' || url.username || url.password || url.port || !providerAllowed(url.hostname.toLowerCase(), o.providers)) return false;
  const res = await o.fetchText(url.href);
  if (res.status >= 500 || res.status === 429) throw new Error(`upstream ${res.status}`);
  if (res.status !== 200) return false;
  let j: any;
  try { j = JSON.parse(await res.text()); } catch { return false; }
  return j?.allowsNostr === true && typeof j.nostrPubkey === 'string' && HEX.test(j.nostrPubkey);
}

interface Opts { storage: Storage; check?: (pk: string) => Promise<boolean> }

const send = (res: ServerResponse, status: number, body: unknown, cache = 'no-store') => {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', cache);
  res.end(JSON.stringify(body));
};
/** The CDN shares answers across screens for a while (keyed on the full URL, one pubkey each). */
const CDN = (ttl: number) => `public, max-age=0, s-maxage=${Math.min(ttl, 600)}`;

/** GET /api/zappable?pubkey=<hex> → { zappable: boolean }; 502 when it can't be verified right now. */
export async function zappableHandler(req: IncomingMessage, res: ServerResponse, o: Opts) {
  if (req.method !== 'GET') return send(res, 405, { error: 'método no permitido' });
  const pk = new URL(req.url ?? '/', 'http://x').searchParams.get('pubkey') ?? '';
  if (!HEX.test(pk)) return send(res, 400, { error: 'pubkey inválido' });
  const key = `totem:zappable:${pk}`;
  try {
    const hit = await o.storage.get<number>(key);
    if (hit === 0 || hit === 1) return send(res, 200, { zappable: hit === 1 }, CDN(hit ? ZAPPABLE_TTL.yes : ZAPPABLE_TTL.no));
    if ((await o.storage.incr(`totem:rl:zappable:${clientIp(req.headers, req.socket?.remoteAddress)}`, RATE.windowSec)) > RATE.max) {
      res.setHeader('retry-after', String(RATE.windowSec));
      return send(res, 429, { error: 'demasiadas consultas' });
    }
  } catch { return serviceUnavailable(res); }
  const check = o.check ?? (async (p: string) => {
    const s = await o.storage.get<Settings>('totem:settings');
    return checkZappable(p, { loadProfile, fetchText, providers: s?.zapProviders ?? DEFAULT_ZAP_PROVIDERS });
  });
  let ok: boolean;
  try { ok = await check(pk); } catch { return send(res, 502, { error: 'no verificable ahora' }); }
  const ttl = ok ? ZAPPABLE_TTL.yes : ZAPPABLE_TTL.no;
  try { await o.storage.set(key, ok ? 1 : 0, ttl); } catch { /* answer anyway */ }
  return send(res, 200, { zappable: ok }, CDN(ttl));
}

let storage: Storage | undefined;
export default function vercel(req: IncomingMessage, res: ServerResponse) {
  storage ??= redisFromEnv() ?? memoryStorage();
  return zappableHandler(req, res, { storage });
}
