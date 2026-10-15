// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { ProfileCache } from '../src/nostr/profiles';
import { keys, sign } from './helpers';

const meta = (sk: Uint8Array, content: object, created_at = 10) => sign(sk, { kind: 0, created_at, content: JSON.stringify(content), tags: [] });
const mem = () => { const m = new Map<string, string>(); return { m, getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

/** Fake relay subscription: records each opened sub and lets the test push events into it. */
function fakeSub() {
  const subs: { authors: string[]; onevent: (e: any) => void; closed: boolean }[] = [];
  const subscribe = vi.fn((authors: string[], onevent: (e: any) => void) => {
    const s = { authors: [...authors], onevent, closed: false };
    subs.push(s);
    return { close: () => { s.closed = true; } };
  });
  return { subs, subscribe };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('ProfileCache: suscripción kind:0 para los autores en pantalla', () => {
  it('abre una sola suscripción (debounced) con los autores pedidos', async () => {
    const a = keys(), b = keys();
    const { subs, subscribe } = fakeSub();
    const pc = new ProfileCache({ query: async () => [], subscribe, subscribeDebounceMs: 3000 });
    pc.get(a.pk); pc.get(b.pk);
    await vi.advanceTimersByTimeAsync(2000);
    expect(subscribe).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(subs).toHaveLength(1);
    expect(subs[0].authors.sort()).toEqual([a.pk, b.pk].sort());
  });

  it('un autor nuevo reabre la suscripción con la lista actualizada y cierra la anterior', async () => {
    const a = keys(), b = keys();
    const { subs, subscribe } = fakeSub();
    const pc = new ProfileCache({ query: async () => [], subscribe, subscribeDebounceMs: 3000 });
    pc.get(a.pk);
    await vi.advanceTimersByTimeAsync(3100);
    pc.get(a.pk); // already subscribed: no reopen
    await vi.advanceTimersByTimeAsync(3100);
    expect(subs).toHaveLength(1);
    pc.get(b.pk);
    await vi.advanceTimersByTimeAsync(3100);
    expect(subs).toHaveLength(2);
    expect(subs[0].closed).toBe(true);
    expect(subs[1].closed).toBe(false);
    expect(subs[1].authors.sort()).toEqual([a.pk, b.pk].sort());
  });

  it('un kind:0 más nuevo actualiza, persiste y notifica; uno viejo, ajeno o sin firma se ignora', async () => {
    const a = keys(), x = keys();
    const st = mem();
    const { subs, subscribe } = fakeSub();
    const pc = new ProfileCache({ query: async () => [meta(a.sk, { name: 'Ana' }, 100)], subscribe, storage: st, batchMs: 10, subscribeDebounceMs: 100 });
    const fn = vi.fn();
    pc.onChange(fn);
    pc.get(a.pk);
    await vi.advanceTimersByTimeAsync(200);
    expect(pc.get(a.pk)).toEqual({ name: 'Ana' });
    fn.mockClear();
    const push = subs[0].onevent;
    push(meta(a.sk, { name: 'Vieja' }, 50));
    push(meta(x.sk, { name: 'Intrusa' }, 500));
    const forged = { ...meta(a.sk, { name: 'Falsa' }, 600), content: JSON.stringify({ name: 'Cambiada' }) };
    push(forged);
    expect(pc.get(a.pk)).toEqual({ name: 'Ana' });
    expect(fn).not.toHaveBeenCalled();
    push(meta(a.sk, { name: 'Ana Nueva', picture: 'https://img/n.png' }, 200));
    expect(pc.get(a.pk)).toEqual({ name: 'Ana Nueva', picture: 'https://img/n.png' });
    expect(fn).toHaveBeenCalledTimes(1);
    expect(JSON.parse(st.m.get('totemcillo:profiles:v1')!)[a.pk]).toMatchObject({ name: 'Ana Nueva', picture: 'https://img/n.png' });
    push(meta(a.sk, { name: 'Ana Nueva', picture: 'https://img/n.png' }, 200)); // same created_at: no-op
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('created_at persistido: tras recargar, un evento viejo no pisa el perfil', async () => {
    const a = keys();
    const st = mem();
    const { subs, subscribe } = fakeSub();
    const pc1 = new ProfileCache({ query: async () => [meta(a.sk, { name: 'Ana' }, 100)], storage: st, batchMs: 10 });
    pc1.get(a.pk);
    await vi.advanceTimersByTimeAsync(50);
    const pc2 = new ProfileCache({ storage: st, subscribe, subscribeDebounceMs: 10 });
    expect(pc2.get(a.pk)).toEqual({ name: 'Ana' });
    await vi.advanceTimersByTimeAsync(50);
    subs[0].onevent(meta(a.sk, { name: 'Vieja' }, 90));
    expect(pc2.get(a.pk)).toEqual({ name: 'Ana' });
  });

  it('el tótem y el admin configuran la suscripción con el pool existente', () => {
    for (const f of ['src/main.ts', 'src/admin.ts']) expect(readFileSync(f, 'utf8')).toMatch(/subscribe: \(authors, onevent\) => pool\.subscribeMany\(cfg\.relays, \{ kinds: \[0\], authors \}/);
  });
});
