import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

const sha = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time compare (hashes both to equalize lengths). An empty configured password never matches. */
export function passwordMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || !expected) return false;
  return timingSafeEqual(sha(given), sha(expected));
}

const mac = (secret: string, payload: string) => createHmac('sha256', secret).update(payload).digest('base64url');

/** Token `payload.signature` (payload = {exp} in base64url). */
export function signSession(secret: string, nowMs: number, ttlSec: number): string {
  const payload = Buffer.from(JSON.stringify({ exp: nowMs + ttlSec * 1000 })).toString('base64url');
  return `${payload}.${mac(secret, payload)}`;
}

export function verifySession(token: string | undefined, secret: string, nowMs: number): boolean {
  if (typeof token !== 'string') return false;
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined) return false;
  const a = Buffer.from(sig), b = Buffer.from(mac(secret, payload));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return typeof exp === 'number' && nowMs < exp;
  } catch {
    return false;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
