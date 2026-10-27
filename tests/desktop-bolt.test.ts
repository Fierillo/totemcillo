// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { postScene } from '../src/scenes/post';
import { batallaScene } from '../src/scenes/batalla';
import { profiles } from '../src/nostr/profiles';

const NOW = 1_800_000_000;
const hex = (n: number) => n.toString(16).padStart(64, '0');
const mk = () => {
  const s = new ZapStore(undefined, { clock: () => NOW });
  s.addPost({ id: hex(1), pubkey: 'a'.repeat(64), content: 'hola', created_at: NOW - 60 });
  s.addPost({ id: hex(2), pubkey: 'b'.repeat(64), content: 'chau', created_at: NOW - 120 });
  s.addZap({ id: hex(1001), postId: hex(1), msats: 21_000, comment: '', created_at: NOW - 30 });
  s.addZap({ id: hex(1002), postId: hex(2), msats: 42_000, comment: '', created_at: NOW - 30 });
  s.setReady();
  return s;
};
const noB = (pk: string) => Promise.resolve(pk !== 'b'.repeat(64));
const row = (root: HTMLElement, n: number) => root.querySelector<HTMLElement>(`[data-id="${hex(n)}"]`)!;

beforeEach(() => vi.useFakeTimers());
afterEach(() => { profiles.clear(); vi.useRealTimers(); });

describe('desktop/tótem: rayo neón de mobile', () => {
  it('mensajes muestran el SVG neón en vez del emoji', () => {
    {
      const sc = postScene(mk(), { publicUrl: 'https://x/' });
      const root = document.createElement('div');
      const off = sc.render(root);
      const total = row(root, 1).querySelector('.row-total')!;
      expect(total.querySelector('svg.m-bolt')).not.toBeNull();
      expect(total.textContent).not.toContain('⚡');
      expect(total.textContent).toContain('21');
      off?.();
    }
  });

  it('un post zapeable sin zaps muestra sólo el rayo verde (sin "0 sats"); con sats, rayo + monto', async () => {
    const st = mk();
    st.addPost({ id: hex(3), pubkey: 'c'.repeat(64), content: 'nuevo', created_at: NOW - 10 });
    const root = document.createElement('div');
    const off = postScene(st, { publicUrl: 'https://x/', canZap: noB }).render(root);
    await vi.advanceTimersByTimeAsync(100);
    const fresh = row(root, 3).querySelector('.row-total')!;
    expect(fresh.querySelector('svg.m-bolt')).not.toBeNull();
    expect(fresh.classList.contains('is-unzappable')).toBe(false);
    expect(fresh.textContent!.trim()).toBe('');
    expect(row(root, 1).querySelector('.row-total')!.textContent).toContain('21');
    off?.();
  });

  it('tótem: rayo + número, sin la palabra «sats» (post, comentario de zap y barra de la batalla)', () => {
    const st = mk();
    st.addZap({ id: hex(1003), postId: hex(1), sender: 'c'.repeat(64), msats: 5_000_000, comment: 'c'.repeat(60), created_at: NOW - 5 });
    const msgs = document.createElement('div'), bat = document.createElement('div');
    const offs = [postScene(st, { publicUrl: 'https://x/' }).render(msgs), batallaScene(st, 3, undefined, undefined, () => NOW * 1000).render(bat)];
    const totals = [row(msgs, 1).querySelector('.row-total')!, msgs.querySelector('.msg-zap .row-total')!, bat.querySelector('.bar-sats')!];
    expect(totals.map((t) => t.textContent!.trim())).toEqual(['5.021', '5.000', '5.021']);
    totals.forEach((t) => expect(t.querySelector('svg.m-bolt')).not.toBeNull());
    offs.forEach((off) => off?.());
  });

  it('la batalla usa el SVG en el título y en cada barra', () => {
    const root = document.createElement('div');
    const off = batallaScene(mk(), 3, undefined, undefined, () => NOW * 1000).render(root);
    expect(root.querySelector('.bar-sats svg.m-bolt')).not.toBeNull();
    expect(root.querySelector('h1 svg.m-bolt')).not.toBeNull();
    expect(root.querySelector('h1')!.textContent).not.toContain('⚡');
    off?.();
  });

  it('autor no zapeable: rayo rojo tachado y sin sats (mensajes)', async () => {
    {
      const sc = postScene(mk(), { publicUrl: 'https://x/', canZap: noB });
      const root = document.createElement('div');
      const off = sc.render(root);
      await vi.advanceTimersByTimeAsync(100);
      const b = row(root, 2).querySelector('.row-total')!;
      expect(b.classList.contains('is-unzappable')).toBe(true);
      expect(b.querySelector('.m-bolt-x')).not.toBeNull();
      expect(b.textContent).not.toContain('sats');
      expect(row(root, 1).querySelector('.row-total .m-bolt-x')).toBeNull();
      expect(row(root, 1).textContent).toContain('21');
      off?.();
    }
  });
});

describe('buildScenes: canZap llega a mensajes y batalla', () => {
  it('mensajes marcan al autor no zapeable y la batalla lo excluye', async () => {
    const { buildScenes } = await import('../src/scenes');
    const { defaultConfig } = await import('../src/config');
    const store = mk();
    const scenes = buildScenes(defaultConfig, store, undefined, 'https://x', noB);
    const root = document.createElement('div');
    const off = scenes.find((s) => s.name === 'post')!.render(root);
    await vi.advanceTimersByTimeAsync(100);
    expect(row(root, 2).querySelector('.row-total.is-unzappable')).not.toBeNull();
    off?.();
    vi.setSystemTime(NOW * 1000);
    const b = document.createElement('div');
    const offB = scenes.find((s) => s.name === 'batalla')!.render(b);
    await vi.advanceTimersByTimeAsync(100);
    expect([...b.querySelectorAll<HTMLElement>('.batalla > li')].map((li) => li.dataset.id)).toEqual([hex(1)]);
    offB?.();
  });
});

describe('desktop: sin transición del rayo normal al rojo', () => {
  it('pendiente: sólo un rayo parpadeando, sin "0 sats"; al resolver, estado final con fade', async () => {
    let resolve!: (ok: boolean) => void;
    const slow = (pk: string) => pk === 'b'.repeat(64) ? new Promise<boolean>((r) => { resolve = r; }) : Promise.resolve(true);
    const root = document.createElement('div');
    const off = postScene(mk(), { publicUrl: 'https://x/', canZap: slow }).render(root);
    const t = () => row(root, 2).querySelector('.row-total')!;
    expect(t().classList.contains('bolt-pending')).toBe(true);
    expect(t().querySelector('svg.m-bolt')).not.toBeNull();
    expect(t().textContent).not.toContain('sats');
    resolve(false);
    await vi.advanceTimersByTimeAsync(100);
    expect(t().classList.contains('bolt-pending')).toBe(false);
    expect(t().classList.contains('bolt-in')).toBe(true);
    expect(t().querySelector('.m-bolt-x')).not.toBeNull();
    off?.();
  });

  it('con cache: estado final al primer render, sin ocultar ni fade', () => {
    const c = Object.assign((pk: string) => noB(pk), { peek: (pk: string) => pk !== 'b'.repeat(64) });
    const root = document.createElement('div');
    const off = postScene(mk(), { publicUrl: 'https://x/', canZap: c }).render(root);
    const t = row(root, 2).querySelector('.row-total')!;
    expect(t.className).toBe('row-total is-unzappable');
    expect(row(root, 1).querySelector('.row-total')!.className).toBe('row-total');
    off?.();
  });
});
