import { parseCookies, passwordMatches, signSession, verifySession } from './auth.js';
import type { Storage } from './storage.js';
import { reanchor, scheduleInputs, shiftSchedule } from '../shared/schedule.js';
import { applyModeration, applyPatch, DEFAULT_SETTINGS, validatePatch, type Settings } from './settings.js';

export interface ApiRequest { method: string; path: string; headers: Record<string, string | undefined>; body: unknown; ip: string }
export interface ApiResponse { status: number; headers: Record<string, string>; body: unknown }
export interface Env { ADMIN_PASSWORD?: string; SESSION_SECRET?: string }
export interface Deps { storage: Storage; env: Env; now: () => number }

export const COOKIE = 'totem_session';
const SESSION_TTL = 3600;
/** Caché de CDN (Vercel) para los GET públicos del tótem; el navegador no cachea (max-age=0). */
const CDN = 'public, max-age=0, s-maxage=5, stale-while-revalidate=5';
const RATE = { max: 10, windowSec: 600 };
const KEY = 'totem:settings';

const json = (status: number, body: unknown, headers: Record<string, string> = {}): ApiResponse =>
  ({ status, body, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers } });
const configured = (env: Env) => !!env.ADMIN_PASSWORD && !!env.SESSION_SECRET && env.SESSION_SECRET.length >= 32;
const authed = (req: ApiRequest, d: Deps) =>
  configured(d.env) && verifySession(parseCookies(req.headers.cookie)[COOKIE], d.env.SESSION_SECRET!, d.now());

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
  const route = `${req.method} ${req.path.replace(/\/+$/, '')}`;
  switch (route) {
    case 'GET /api/settings':
      return json(200, await readSettings(d));
    case 'PUT /api/settings': {
      if (!authed(req, d)) return json(401, { error: 'no autorizado' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'se espera JSON' });
      const v = validatePatch(req.body);
      if (!v.ok) return json(400, { error: v.error });
      const cur = await readSettings(d);
      const now = d.now();
      let next = applyPatch(cur, v.patch);
      const { announcement, command, ...sched } = v.patch;
      if (Object.keys(sched).length) next = reanchor(cur, next, now);
      if (command) next = shiftSchedule(next, now, command);
      next = { ...next, version: (cur.version ?? 0) + 1 };
      await d.storage.set(KEY, next);
      return json(200, next);
    }
    case 'POST /api/moderation': {
      if (!authed(req, d)) return json(401, { error: 'no autorizado' });
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'se espera JSON' });
      const cur = await readSettings(d);
      const m = applyModeration(cur, req.body);
      if (!m.ok) return json(400, { error: m.error });
      const next = { ...m.settings, version: (cur.version ?? 0) + 1 };
      await d.storage.set(KEY, next);
      return json(200, next);
    }
    case 'GET /api/kiosk': {
      // Público, de sólo lectura: entradas de la agenda; el tótem calcula las escenas localmente.
      const st = await readSettings(d);
      // Sin hora adentro: así el CDN puede cachearla. El tótem la pide como /api/kiosk?v=<version>.
      return json(200, { ...scheduleInputs(st), announcement: st.announcement, version: st.version ?? 0,
        hiddenPosts: st.hiddenPosts ?? [], bannedPubkeys: st.bannedPubkeys ?? [] }, { 'cache-control': CDN });
    }
    case 'GET /api/version':
      // Chequeo barato y cacheable unos segundos en el CDN (muchas pantallas → pocas lecturas).
      return json(200, { version: (await readSettings(d)).version ?? 0 }, { 'cache-control': CDN });
    case 'GET /api/time':
      // Hora del servidor para corregir el reloj del tótem: nunca cacheada y sin tocar Redis.
      return json(200, { now: d.now() });
    case 'POST /api/login': {
      if (!configured(d.env)) return json(503, { error: 'admin no configurado' });
      if ((await d.storage.incr(`totem:rl:${req.ip}`, RATE.windowSec)) > RATE.max) return json(429, { error: 'demasiados intentos, probá en unos minutos' });
      const pass = (req.body as { password?: unknown } | null)?.password;
      if (!passwordMatches(pass, d.env.ADMIN_PASSWORD!)) return json(401, { error: 'clave incorrecta' });
      const token = signSession(d.env.SESSION_SECRET!, d.now(), SESSION_TTL);
      return json(200, { ok: true }, { 'set-cookie': `${COOKIE}=${token}; ${cookieFlags(req, SESSION_TTL)}` });
    }
    case 'POST /api/logout':
      return json(200, { ok: true }, { 'set-cookie': `${COOKIE}=; ${cookieFlags(req, 0)}` });
    case 'GET /api/session':
      return json(200, { authed: authed(req, d) });
  }
  if (/^\w+ \/api\/(settings|login|logout|session|kiosk|version|time|moderation)$/.test(route))
    return json(405, { error: 'método no permitido' });
  return json(404, { error: 'no encontrado' });
}
