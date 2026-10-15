import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { handle, type Deps } from './api.js';
import { memoryStorage, upstashStorage } from './storage.js';

/** Production requires shared storage for settings, rate limits and session revocation. */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): Deps {
  const url = env.UPSTASH_REDIS_REST_URL, token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) throw new Error('UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN are required');
  return {
    storage: upstashStorage(url, token),
    env: { ADMIN_PASSWORD: env.ADMIN_PASSWORD, SESSION_SECRET: env.SESSION_SECRET },
    now: Date.now,
  };
}

/** Deps for `pnpm dev`/`pnpm preview`: memory and, without variables, a development password. */
export function devDeps(env: NodeJS.ProcessEnv = process.env): Deps {
  const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'admin';
  if (!env.ADMIN_PASSWORD) console.warn('[totemcillo] dev: /admin password = "admin" (set ADMIN_PASSWORD to change it)');
  return { storage: memoryStorage(), env: { ADMIN_PASSWORD, SESSION_SECRET: env.SESSION_SECRET || randomBytes(32).toString('hex') }, now: Date.now };
}

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) return null; }
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

/**
 * Client IP for rate limits (login, avatar). On Vercel, x-vercel-forwarded-for / x-real-ip are set by the platform;
 * x-forwarded-for (first hop) and the socket are fallbacks for dev / other proxies.
 */
export function clientIp(headers: Record<string, string | string[] | undefined>, remote: string | undefined): string {
  const h = (k: string) => { const v = headers[k]; return (Array.isArray(v) ? v.join(',') : v ?? '').split(',')[0].trim(); };
  return h('x-vercel-forwarded-for') || h('x-real-ip') || h('x-forwarded-for') || remote || 'desconocida';
}

/** Node http adapter (Vercel Functions and Vite middleware). */
export async function nodeHandler(req: IncomingMessage & { body?: unknown }, res: ServerResponse, deps: Deps) {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  const ip = clientIp(headers, req.socket?.remoteAddress);
  const u = new URL(req.url ?? '/', 'http://x');
  const query = (req.url ?? '').includes('?') ? u.search.replace(/^\?/, '') || '?' : undefined;
  const r = await handle({ method: req.method ?? 'GET', path: u.pathname, query, headers, body: await readBody(req), ip }, deps);
  res.statusCode = r.status;
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.end(JSON.stringify(r.body));
}

let cached: Deps | undefined;
/** Configuration failures must not become cacheable responses or local-memory fallbacks. */
export function serviceUnavailable(res: ServerResponse) {
  res.statusCode = 503;
  res.setHeader('content-type', 'application/json');
  res.setHeader('cache-control', 'no-store');
  res.end(JSON.stringify({ error: 'servicio no disponible' }));
}

/** Default handler for every file in /api. */
export default function vercel(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  try { cached ??= depsFromEnv(); } catch { return serviceUnavailable(res); }
  return nodeHandler(req, res, cached);
}
