import { parseCookies, passwordMatches, signSession, verifySession } from './auth.js';
import { EMPTY_STATE, validateState, type LiveState } from './state.js';
import type { Storage } from './storage.js';
import { applyPatch, DEFAULT_SETTINGS, validatePatch, type Settings } from './settings.js';

export interface ApiRequest { method: string; path: string; headers: Record<string, string | undefined>; body: unknown; ip: string }
export interface ApiResponse { status: number; headers: Record<string, string>; body: unknown }
export interface Env { ADMIN_PASSWORD?: string; SESSION_SECRET?: string }
export interface Deps { storage: Storage; env: Env; now: () => number }

export const COOKIE = 'totem_session';
const SESSION_TTL = 3600;
const RATE = { max: 10, windowSec: 600 };
const KEY = 'totem:settings';
const STATE_KEY = 'totem:state';

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
      const next = applyPatch(await readSettings(d), v.patch);
      await d.storage.set(KEY, next);
      return json(200, next);
    }
    case 'GET /api/state':
      return json(200, (await d.storage.get<LiveState>(STATE_KEY)) ?? EMPTY_STATE);
    case 'POST /api/state': {
      if (!(req.headers['content-type'] ?? '').startsWith('application/json')) return json(415, { error: 'se espera JSON' });
      const v = validateState(req.body, d.now());
      if (!v.ok) return json(400, { error: v.error });
      await d.storage.set(STATE_KEY, v.state);
      return json(200, { ok: true });
    }
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
  if (/^\w+ \/api\/(settings|state|login|logout|session)$/.test(route))
    return json(405, { error: 'método no permitido' });
  return json(404, { error: 'no encontrado' });
}
