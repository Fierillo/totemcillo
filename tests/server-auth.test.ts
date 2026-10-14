import { describe, expect, it } from 'vitest';
import { passwordMatches, signSession, verifySession, parseCookies } from '../server/auth';
import { memoryStorage } from '../server/storage';

describe('passwordMatches (comparación en tiempo constante)', () => {
  it('acepta sólo la clave exacta', () => {
    expect(passwordMatches('s3creta', 's3creta')).toBe(true);
    expect(passwordMatches('s3cret', 's3creta')).toBe(false);
    expect(passwordMatches('s3cretaX', 's3creta')).toBe(false);
    expect(passwordMatches('', 's3creta')).toBe(false);
  });
  it('rechaza tipos raros y una clave configurada vacía', () => {
    expect(passwordMatches(undefined, 'x')).toBe(false);
    expect(passwordMatches({ a: 1 }, 'x')).toBe(false);
    expect(passwordMatches('', '')).toBe(false);
  });
});

describe('sesión firmada con HMAC', () => {
  const secret = 'a'.repeat(32);
  it('firma y verifica antes de vencer', () => {
    const t = signSession(secret, 1_000_000, 3600);
    expect(verifySession(t, secret, 1_000_000 + 3599_000)).toBe(true);
  });
  it('rechaza vencida, adulterada, con otro secreto o basura', () => {
    const t = signSession(secret, 1_000_000, 3600);
    expect(verifySession(t, secret, 1_000_000 + 3601_000)).toBe(false);
    const [p, s] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ exp: 9e12 })).toString('base64url');
    expect(verifySession(`${forged}.${s}`, secret, 1_000_000)).toBe(false);
    expect(verifySession(`${p}.${s.slice(0, -2)}xx`, secret, 1_000_000)).toBe(false);
    expect(verifySession(t, 'b'.repeat(32), 1_000_000)).toBe(false);
    for (const junk of ['', '.', 'abc', undefined]) expect(verifySession(junk as string, secret, 1_000_000)).toBe(false);
  });
  it('parsea cookies', () => {
    expect(parseCookies('a=1; totem_session=xyz.abc; b=2')).toEqual({ a: '1', totem_session: 'xyz.abc', b: '2' });
    expect(parseCookies(undefined)).toEqual({});
  });
});

describe('memoryStorage', () => {
  it('guarda JSON y cuenta con vencimiento', async () => {
    let now = 0;
    const s = memoryStorage(() => now);
    expect(await s.get('k')).toBeNull();
    await s.set('k', { a: 1 });
    expect(await s.get('k')).toEqual({ a: 1 });
    expect(await s.incr('c', 10)).toBe(1);
    expect(await s.incr('c', 10)).toBe(2);
    now = 11_000;
    expect(await s.incr('c', 10)).toBe(1);
  });
});
