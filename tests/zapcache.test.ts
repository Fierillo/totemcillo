import { describe, expect, it, vi } from 'vitest';
import { cachedCanZap, zappability, ZAP_CACHE_KEY, ZAP_TTL } from '../src/zapcache';

const kv = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m }; };
const pk = (c: string) => c.repeat(64);

describe('caché de canZap (localStorage, stale-while-revalidate)', () => {
  it('primera vez consulta y guarda; en la recarga responde al instante sin red mientras esté fresco', async () => {
    const s = kv(), check = vi.fn(async () => false);
    expect(await cachedCanZap(check, s, () => 1000)(pk('a'))).toBe(false);
    const again = vi.fn(async () => true);
    expect(await cachedCanZap(again, s, () => 1000 + ZAP_TTL.no - 1)(pk('a'))).toBe(false);
    expect(again).not.toHaveBeenCalled();
  });
  it('vencido: devuelve lo guardado al instante y revalida en segundo plano; si cambió avisa con update', async () => {
    const s = kv();
    await cachedCanZap(async () => false, s, () => 0)(pk('a'));
    const update = vi.fn();
    const check = vi.fn(async () => true);
    expect(await cachedCanZap(check, s, () => ZAP_TTL.no + 1)(pk('a'), update)).toBe(false);
    await vi.waitFor(() => expect(update).toHaveBeenCalledWith(true));
    expect(JSON.parse(s.getItem(ZAP_CACHE_KEY)!)[pk('a')][0]).toBe(1);
  });
  it('TTL: sí dura 24 h, no dura 3 h', () => { expect(ZAP_TTL).toEqual({ yes: 24 * 3600e3, no: 3 * 3600e3 }); });
  it('un perfil más nuevo que el usado al validar invalida el resultado', async () => {
    const s = kv();
    let at = 10;
    await cachedCanZap(async () => false, s, () => 0, () => at)(pk('a'));
    at = 20; // new kind 0 arrived (maybe a lud16 now)
    const check = vi.fn(async () => true);
    expect(await cachedCanZap(check, s, () => 1, () => at)(pk('a'))).toBe(true);
  });
  it('acotado a 500 entradas (se van las más viejas) y tolera storage corrupto', async () => {
    const s = kv();
    let t = 0;
    const c = cachedCanZap(async () => true, s, () => t++);
    for (let i = 0; i < 510; i++) await c(i.toString(16).padStart(64, '0'));
    const d = JSON.parse(s.getItem(ZAP_CACHE_KEY)!);
    expect(Object.keys(d).length).toBe(500);
    expect(d['0'.padStart(64, '0')]).toBeUndefined();
    s.setItem(ZAP_CACHE_KEY, '{nope');
    expect(await cachedCanZap(async () => true, s, () => 0)(pk('b'))).toBe(true);
  });
  it('lee el localStorage una sola vez (no re-parsea por autor)', async () => {
    const s = kv(), get = vi.spyOn(s, 'getItem');
    const c = cachedCanZap(async () => true, s, () => 0);
    for (const ch of 'abcd') await c(pk(ch));
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('zappability por vista', () => {
  it('pregunta una vez por autor, avisa una sola vez si varias respuestas llegan juntas y sin canZap todos son zapeables', async () => {
    vi.useFakeTimers();
    try {
      const canZap = vi.fn(async (k: string) => k === pk('a')), changed = vi.fn();
      const z = zappability(canZap, changed);
      expect(z.off(pk('a'))).toBe(false); expect(z.ok(pk('b'))).toBe(false); z.off(pk('a'));
      expect(z.pending(pk('a'))).toBe(true); expect(z.settled(pk('a'))).toBe(false);
      await vi.advanceTimersByTimeAsync(60);
      expect(canZap).toHaveBeenCalledTimes(2);
      expect(changed).toHaveBeenCalledTimes(1);
      expect([z.ok(pk('a')), z.off(pk('b')), z.settled(pk('b'))]).toEqual([true, true, true]);
      const none = zappability(undefined, changed);
      expect([none.ok(pk('c')), none.off(pk('c')), none.settled(pk('c'))]).toEqual([true, false, true]);
    } finally { vi.useRealTimers(); }
  });
});

describe('rayo sin transición falsa', () => {
  const kv = (data: Record<string, unknown>) => { const m = new Map([[ZAP_CACHE_KEY, JSON.stringify(data)]]); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

  it('peek: devuelve lo cacheado (aunque esté vencido) sin pedir nada; undefined si no hay', () => {
    const check = vi.fn(async () => true);
    const c = cachedCanZap(check, kv({ a: [0, 0, 0] }), () => 1e15);
    expect(c.peek('a')).toBe(false);
    expect(c.peek('b')).toBeUndefined();
    expect(check).not.toHaveBeenCalled();
  });

  it('cls: oculto mientras está pendiente, fade-in una sola vez al resolver', async () => {
    vi.useFakeTimers();
    let resolve!: (ok: boolean) => void;
    const z = zappability(() => new Promise<boolean>((r) => { resolve = r; }), () => {});
    expect(z.cls('a')).toBe(' bolt-pending');
    resolve(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(z.off('a')).toBe(true);
    expect(z.cls('a')).toBe(' bolt-in');
    expect(z.cls('a')).toBe('');
    vi.useRealTimers();
  });

  it('cls: con cache (peek) el estado final está al instante, sin fade ni redibujo', async () => {
    vi.useFakeTimers();
    const changed = vi.fn();
    const c = Object.assign(async () => false, { peek: () => false });
    const z = zappability(c, changed);
    expect(z.off('a')).toBe(true);
    expect(z.cls('a')).toBe('');
    await vi.advanceTimersByTimeAsync(100);
    expect(changed).not.toHaveBeenCalled();
    expect(z.cls('a')).toBe('');
    vi.useRealTimers();
  });

  it('revalidación que cambia: cambia directo, sin ocultar ni fade', async () => {
    vi.useFakeTimers();
    let upd!: (ok: boolean) => void;
    const c = Object.assign(async (_pk: string, u?: (ok: boolean) => void) => { upd = u!; return true; }, { peek: () => true });
    const changed = vi.fn();
    const z = zappability(c, changed);
    expect(z.off('a')).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    upd(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(z.off('a')).toBe(true);
    expect(z.cls('a')).toBe('');
    vi.useRealTimers();
  });
});
