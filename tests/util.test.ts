import { describe, expect, it, vi } from 'vitest';
import { ago, esc, sats, shortKey } from '../src/util';

describe('util', () => {
  it('sats convierte msats a sats enteros formateados es-AR', () => {
    expect(sats(2_100_999)).toBe((2100).toLocaleString('es-AR'));
  });
  it('shortKey acorta pubkeys y maneja ausencia', () => {
    expect(shortKey('abcdefgh12345678wxyz')).toBe('abcdefgh…wxyz');
    expect(shortKey()).toBe('anónimo');
  });
  it('esc escapa HTML', () => {
    expect(esc(`<a href="x">'&`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;');
  });
  it('ago da tiempo relativo', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000_000);
    const now = 1_000_000;
    expect(ago(now - 5)).toBe('hace 5s');
    expect(ago(now - 120)).toBe('hace 2 min');
    expect(ago(now - 7200)).toBe('hace 2 h');
    expect(ago(now + 50)).toBe('hace 0s');
    vi.useRealTimers();
  });
});
