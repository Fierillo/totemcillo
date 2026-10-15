import { parseCookies, passwordMatches, readSession, signSession } from './auth.js';
import type { Storage } from './storage.js';
import { reanchor, scheduleInputs, shiftSchedule } from '../shared/schedule.js';
import { applyModeration, applyPatch, DEFAULT_SETTINGS, DEFAULT_START_LINE, DEFAULT_ZAP_PROVIDERS, validatePatch, type Settings } from './settings.js';

export interface ApiRequest { method: string; path: string; headers: Record<string, string | undefined>; body: unknown; ip: string;
  /** Raw query string without '?' ('' or undefined when absent). */
  query?: string }
export interface ApiResponse { status: number; headers: Record<string, string>; body: unknown }
export interface Env { ADMIN_PASSWORD?: string; SESSION_SECRET?: string }
export interface Deps { storage: Storage; env: Env; now: () => number }

export const COOKIE = 'totem_session';
const SESSION_TTL = 3600;
/** CDN cache (Vercel) for the totem's public GETs; the browser does not cache (max-age=0). */
const CDN = 'public, max-age=0, s-maxage=5, stale-while-revalidate=5';
const RATE = { max: 10, windowSec: 600 };
/** Public GETs cached by the CDN: Vercel keys the cache on the full URL, so a query would bypass it. */
const CANONICAL = new Set(['/api/kiosk', '/api/version', '/api/settings']);
/** The redirect itself is static, so the CDN may keep it for a long time (no Redis behind it). */
const REDIRECT_CACHE = 'public, max-age=3600, s-maxage=86400';
const PRIVATE = 'private, no-store';
const KEY = 'totem:settings';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): ApiResponse =>
  ({ status, body, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const configured = (env: Env) => !!env.ADMIN_PASSWORD && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;
const REVOKED = (jti: string) => `totem:revoked:${jti}`;
/** Valid signed session, or null. Pure crypto: no storage read for missing/forged/expired cookies. */
const session = (req: ApiRequest, d: Deps) =>
  configured(d.env) ? readSession(parseCookies(req.headers.cookie)[COOKIE], d.env.SESSION_SECRET!, d.now()) : null;
/** Admin check: a valid signature, then one storage read to make sure it wasn't logged out (revoked). */
async function authed(req: ApiRequest, d: Deps): Promise<boolean> {
  const s = session(req, d);
  return !!s && !(await d.storage.get(REVOKED(s.jti)));
}

async function readSettings(d: Deps): Promise<Settings> {
  const s = await d.storage.get<Settings>(KEY);
  return s ? { ...DEFAULT_SETTINGS, ...s } : DEFAULT_SETTINGS;
}

function cookieFlags(req: ApiRequest, maxAge: number): string {
  const host = (req.headers.host ?? '').split(':')[0];
  const https = (req.headers['x-forwarded-proto'] ?? '').split(',')[0].trim() === 'https'
    || (!['localhost', '127.0.0.1'].includes(host) && host.endsWith('.vercel.app'));
  return `HttpOnly; Path=/; SameSite=Strict; Max-Age=${maxAge}${https ? '; Secure' : ''}`;
}

export async function handle(req: ApiRequest, d: Deps): Promise<ApiResponse> {
  const path = req.path.replace(/\/+$/, '');
  const route = `${req.method} ${path}`;
  // Any query on a cacheable public GET → permanent redirect to the bare path, answered before any storage read.
  if (req.method === 'GET' && req.query !== undefined && req.query !== '' && CANONICAL.has(path))
    return { status: 308, body: null, headers: { location: path, 'cache-control': REDIRECT_CACHE } };
  switch (route) {
    case 'GET /api/settings':
      // Same content for everyone; with a session it is marked private (no Vary: Cookie: Vercel won't cache that).
      // The admin panel reads fresh settings through /api/session instead, so a CDN copy never goes stale there.
      return json(200, await readSettings(d), { 'cache-control': (await authed(req, d)) ? PRIVATE : CDN });
    case 'PUT /api/settings': {
      if (!(await authed(req, d))) return json(401, { error: 'no autorizado' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'se espera JSON' });
      const v = validatePatch(req.body, d.now());
      if (!v.ok) return json(400, { error: v.error });
      const cur = await readSettings(d);
      const now = d.now();
      let next = applyPatch(cur, v.patch);
      const { announcement, command, zapProviders, startLine, ...sched } = v.patch;
      if (Object.keys(sched).length) next = reanchor(cur, next, now);
      if (command) next = shiftSchedule(next, now, command);
      next = { ...next, version: (cur.version ?? 0) + 1 };
      await d.storage.set(KEY, next);
      return json(200, next);
    }
    case 'POST /api/moderation': {
      if (!(await authed(req, d))) return json(401, { error: 'no autorizado' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'se espera JSON' });
      const cur = await readSettings(d);
      const m = applyModeration(cur, req.body);
      if (!m.ok) return json(400, { error: m.error });
      const next = { ...m.settings, version: (cur.version ?? 0) + 1 };
      await d.storage.set(KEY, next);
      return json(200, next);
    }
    case 'GET /api/kiosk': {
      // Public, read-only: schedule inputs; the totem computes the scenes locally.
      const st = await readSettings(d);
      // No time inside, so the CDN can cache it. Always the bare path; a stale copy is retried by the totem.
      return json(200, { ...scheduleInputs(st), announcement: st.announcement, version: st.version ?? 0,
        hiddenPosts: st.hiddenPosts ?? [], bannedPubkeys: st.bannedPubkeys ?? [], zapProviders: st.zapProviders ?? DEFAULT_ZAP_PROVIDERS, startLine: st.startLine ?? DEFAULT_START_LINE }, { 'cache-control': CDN });
    }
    case 'GET /api/version':
      // Cheap check, cacheable for a few seconds on the CDN (many screens → few reads). No query (see CANONICAL).
      return json(200, { version: (await readSettings(d)).version ?? 0 }, { 'cache-control': CDN });
    case 'GET /api/time':
      // Server time to correct the totem's clock: never cached and never touches Redis.
      return json(200, { now: d.now() });
    case 'POST /api/login': {
      if (!configured(d.env)) return json(503, { error: 'admin no configurado' });
      if ((await d.storage.incr(`totem:rl:${req.ip}`, RATE.windowSec)) > RATE.max) return json(429, { error: 'demasiados intentos, probá en unos minutos' });
      const pass = (req.body as { password?: unknown } | null)?.password;
      if (!passwordMatches(pass, d.env.ADMIN_PASSWORD!)) return json(401, { error: 'clave incorrecta' });
      const token = signSession(d.env.SESSION_SECRET!, d.now(), SESSION_TTL);
      return json(200, { ok: true }, { 'set-cookie': `${COOKIE}=${token}; ${cookieFlags(req, SESSION_TTL)}` });
    }
    case 'POST /api/logout': {
      // Revoke server-side so a copied cookie stops working; the entry lives only as long as the session would.
      const s = session(req, d);
      if (s) await d.storage.set(REVOKED(s.jti), 1, Math.max(1, Math.ceil((s.exp - d.now()) / 1000)));
      return json(200, { ok: true }, { 'set-cookie': `${COOKIE}=; ${cookieFlags(req, 0)}` });
    }
    case 'GET /api/session': {
      // Session-bearing and never cached: the admin's fresh view of the settings comes from here.
      if (!(await authed(req, d))) return json(200, { authed: false });
      return json(200, { authed: true, settings: await readSettings(d) }, { 'cache-control': PRIVATE });
    }
  }
  if (/^\w+ \/api\/(settings|login|logout|session|kiosk|version|time|moderation)$/.test(route))
    return json(405, { error: 'método no permitido' });
  return json(404, { error: 'no encontrado' });
}
