import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time compare (hashes both to equalize lengths). An empty configured password never matches. */
export function passwordMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !expected) return false;
  return timingSafeEqual(sha(given), sha(expected));
}

const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

/** Token `payload.signature` (payload = {exp, jti} in base64url). jti identifies the session for server-side revocation. */
export function signSession(secret: string, nowMs: number, ttlSec: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: nowMs + ttlSec * 1000, jti: randomBytes(16).toString('base64url') })).toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

export interface SessionInfo { exp: number; jti: string }

/** Signature + expiry check only (no storage). Tokens without a jti (older format) are rejected. */
export function readSession(token: string | undefined, secret: string, nowMs: number): SessionInfo | null {
  if (typeof token !== 'string') return null;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return null;
  const a = Buffer.from(sig), b = Buffer.from(mac(secret, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const { exp, jti } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && nowMs < exp && typeof jti === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(jti) ? { exp, jti } : null;
  } catch {
    return null;
  }
}

export const verifySession = (token: string | undefined, secret: string, nowMs: number) => readSession(token, secret, nowMs) !== null;

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
