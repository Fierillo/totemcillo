import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { handle, type Deps } from './api.js';
import { memoryStorage, upstashStorage } from './storage.js';

/** Dependencias desde variables de entorno (Vercel). Sin Upstash usa memoria (se pierde entre invocaciones). */
export function depsFromEnv(env: NodeJS.ProcessEnv = process.env): Deps {
  const url = env.UPSTASH_REDIS_REST_URL, token = env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) console.warn('[totemcillo] Falta UPSTASH_REDIS_REST_URL/TOKEN: uso memoria (no persiste).');
  return {
    storage: url && token ? upstashStorage(url, token) : memoryStorage(),
    env: { ADMIN_PASSWORD: env.ADMIN_PASSWORD, SESSION_SECRET: env.SESSION_SECRET },
    now: Date.now,
  };
}

/** Deps para `pnpm dev`/`pnpm preview`: memoria y, si no hay variables, una clave de desarrollo. */
export function devDeps(env: NodeJS.ProcessEnv = process.env): Deps {
  const ADMIN_PASSWORD = env.ADMIN_PASSWORD || 'admin';
  if (!env.ADMIN_PASSWORD) console.warn('[totemcillo] dev: clave de /admin = "admin" (definí ADMIN_PASSWORD para cambiarla)');
  return { storage: memoryStorage(), env: { ADMIN_PASSWORD, SESSION_SECRET: env.SESSION_SECRET || randomBytes(32).toString('hex') }, now: Date.now };
}

async function readBody(req: IncomingMessage & { body?: unknown }): Promise<unknown> {
  if (req.body !== undefined) return req.body;
  let raw = '';
  for await (const chunk of req) { raw += chunk; if (raw.length > 10_000) return null; }
  if (!raw) return undefined;
  try { return JSON.parse(raw); } catch { return raw; }
}

/** Adaptador http de Node (Vercel Functions y middleware de Vite). */
export async function nodeHandler(req: IncomingMessage & { body?: unknown }, res: ServerResponse, deps: Deps) {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(req.headers)) headers[k] = Array.isArray(v) ? v.join(', ') : v;
  const ip = (headers['x-forwarded-for'] ?? '').split(',')[0].trim() || req.socket?.remoteAddress || 'desconocida';
  const path = new URL(req.url ?? '/', 'http://x').pathname;
  const r = await handle({ method: req.method ?? 'GET', path, headers, body: await readBody(req), ip }, deps);
  res.statusCode = r.status;
  for (const [k, v] of Object.entries(r.headers)) res.setHeader(k, v);
  res.end(JSON.stringify(r.body));
}

let cached: Deps | undefined;
/** Handler por defecto de cada archivo en /api. */
export default function vercel(req: IncomingMessage & { body?: unknown }, res: ServerResponse) {
  return nodeHandler(req, res, (cached ??= depsFromEnv()));
}
