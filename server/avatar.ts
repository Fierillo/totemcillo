import type { IncomingMessage, ServerResponse } from 'node:http';
import { request } from 'node:https';
import { lookup as dnsLookup, type LookupAddress } from 'node:dns';
import { BlockList, isIP } from 'node:net';
import sharp from 'sharp';
import { clientIp, depsFromEnv, serviceUnavailable } from './node.js';
import type { Storage } from './storage.js';

/** Avatar proxy: fetches kind:0 pictures server-side (no stand IP leak), bounded and re-encoded small. */
export const AVATAR_SIZE = 128;
export const MAX_BYTES = 5 * 1024 * 1024;
export const MAX_REDIRECTS = 3;
export const TIMEOUT_MS = 5000;
export const CACHE = 'public, max-age=86400, s-maxage=604800, immutable';
/** Per-IP limit on cache misses (the CDN absorbs repeats), counted in the same storage as the login limiter. */
export const AVATAR_RATE = { max: 60, windowSec: 600 };

const blocked = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24],
  ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) blocked.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const)
  blocked.addSubnet(net, bits, 'ipv6');

/** True for anything that is not a public unicast address (private, loopback, link-local, metadata, ...). */
export function isBlockedIp(ip: string): boolean {
  const v = isIP(ip);
  if (v === 4) return blocked.check(ip, 'ipv4');
  if (v !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isBlockedIp(mapped[1]);
  return blocked.check(ip, 'ipv6');
}

/** Only plain https URLs on the default port, without credentials and not pointing at a blocked literal IP. */
export function parseAvatarUrl(raw: string | null | undefined): URL | null {
  if (!raw || raw.length > 2048) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port) return null;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (!host || host === 'localhost' || host.endsWith('.localhost')) return null;
  if (isIP(host) && isBlockedIp(host)) return null;
  return u;
}

type LookupFn = (host: string, opts: any, cb: (err: NodeJS.ErrnoException | null, addr: any, family?: number) => void) => void;
/** Wraps dns.lookup so the socket only connects to addresses that pass isBlockedIp (no DNS-rebinding gap). */
export function safeLookup(base: LookupFn = dnsLookup as any): LookupFn {
  return (host, opts, cb) => {
    base(host, { ...opts, all: true }, (err, addrs: LookupAddress[]) => {
      if (err) return cb(err, undefined);
      const list = Array.isArray(addrs) ? addrs : [];
      if (!list.length || list.some((a) => isBlockedIp(a.address))) return cb(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }), undefined);
      if (opts?.all) return cb(null, list);
      cb(null, list[0].address, list[0].family);
    });
  };
}

export interface FetchResult { status: number; headers: Record<string, string | undefined>; body: AsyncIterable<Uint8Array> }
export type Fetcher = (url: URL, signal: AbortSignal) => Promise<FetchResult>;

/** One https hop, no automatic redirects; `lookup` decides which resolved addresses may be dialed. */
const fetcherWith = (lookup: LookupFn | undefined): Fetcher => (url, signal) => new Promise((resolve, reject) => {
  const req = request(url, { method: 'GET', ...(lookup && { lookup: lookup as any }), signal, headers: { accept: 'image/*', 'user-agent': 'totemcillo-avatar/1' } }, (res) => {
    const headers: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(res.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
    resolve({ status: res.statusCode ?? 0, headers, body: res });
  });
  req.on('error', reject);
  req.end();
});

/** Default fetcher: DNS checked at connect time. */
export const httpsFetcher: Fetcher = fetcherWith(safeLookup());

/** Dev-only escape hatch for sandboxes whose DNS answers with reserved IPs (e.g. 198.18.0.0/15): opt-in via TOTEM_DEV_AVATAR_ANY_IP=1, never used by the Vercel handler. */
export const devAvatarFetcher = (env: Record<string, string | undefined>): Fetcher | undefined =>
  env.TOTEM_DEV_AVATAR_ANY_IP === '1' ? fetcherWith(undefined) : undefined;

/** Buffers a stream, aborting as soon as it exceeds max bytes. */
export async function readLimited(body: AsyncIterable<Uint8Array>, max: number): Promise<Buffer> {
  const parts: Uint8Array[] = [];
  let n = 0;
  for await (const c of body) {
    n += c.length;
    if (n > max) { (body as any).destroy?.(); throw new Error('too large'); }
    parts.push(c);
  }
  return Buffer.concat(parts);
}

interface FetchOpts { storage?: Storage; fetcher?: Fetcher; maxBytes?: number; maxRedirects?: number; timeoutMs?: number }
/** Downloads the image, following at most N redirects and re-validating every hop. */
export async function fetchAvatar(start: URL, o: FetchOpts = {}): Promise<Buffer> {
  const { fetcher = httpsFetcher, maxBytes = MAX_BYTES, maxRedirects = MAX_REDIRECTS, timeoutMs = TIMEOUT_MS } = o;
  const signal = AbortSignal.timeout(timeoutMs);
  let url = start;
  for (let hop = 0; ; hop++) {
    const r = await fetcher(url, signal);
    if (r.status >= 300 && r.status < 400 && r.headers.location) {
      (r.body as any).destroy?.();
      if (hop >= maxRedirects) throw new Error('too many redirects');
      const next = parseAvatarUrl(new URL(r.headers.location, url).href);
      if (!next) throw new Error('bad redirect');
      url = next;
      continue;
    }
    if (r.status !== 200) { (r.body as any).destroy?.(); throw new Error(`upstream ${r.status}`); }
    if (!/^image\//i.test(r.headers['content-type'] ?? '')) { (r.body as any).destroy?.(); throw new Error('not an image'); }
    if (Number(r.headers['content-length'] ?? 0) > maxBytes) { (r.body as any).destroy?.(); throw new Error('too large'); }
    return readLimited(r.body, maxBytes);
  }
}

/** Small square WebP (cover crop); animated inputs keep only their first frame. */
export function renderAvatar(input: Buffer): Promise<Buffer> {
  return sharp(input, { animated: false, limitInputPixels: 40_000_000 })
    .rotate()
    .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
    .webp({ quality: 60 })
    .toBuffer();
}

/** GET /api/avatar?url=<https url>. Errors let the client fall back to initials; limiter failures stop before downloading. */
export async function avatarHandler(req: IncomingMessage, res: ServerResponse, o: FetchOpts = {}) {
  const fail = (status: number) => { res.statusCode = status; res.setHeader('cache-control', 'public, max-age=300, s-maxage=3600'); res.end(); };
  if (req.method !== 'GET' && req.method !== 'HEAD') return fail(405);
  const url = parseAvatarUrl(new URL(req.url ?? '/', 'http://x').searchParams.get('url'));
  if (!url) return fail(400);
  if (o.storage) {
    const ip = clientIp(req.headers, req.socket?.remoteAddress);
    let n: number;
    try { n = await o.storage.incr(`totem:rl:avatar:${ip}`, AVATAR_RATE.windowSec); } catch { return serviceUnavailable(res); }
    if (n > AVATAR_RATE.max) { res.statusCode = 429; res.setHeader('cache-control', 'no-store'); res.setHeader('retry-after', String(AVATAR_RATE.windowSec)); return res.end(); }
  }
  let out: Buffer;
  try { out = await renderAvatar(await fetchAvatar(url, o)); } catch { return fail(502); }
  res.statusCode = 200;
  res.setHeader('content-type', 'image/webp');
  res.setHeader('cache-control', CACHE);
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('content-security-policy', "default-src 'none'");
  res.end(req.method === 'HEAD' ? undefined : out);
}

let storage: Storage | undefined;
export default function vercel(req: IncomingMessage, res: ServerResponse) {
  try { storage ??= depsFromEnv().storage; } catch { return serviceUnavailable(res); }
  return avatarHandler(req, res, { storage });
}
