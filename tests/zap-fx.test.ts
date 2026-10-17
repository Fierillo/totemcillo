// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { zapFx } from '../src/zap-fx';

const hex = (n: number) => n.toString(16).padStart(64, '0');
const NOW = 1_000_000;
const store = () => new ZapStore(undefined, { clock: () => NOW, liveWindowSec: 120 });
const zap = (n: number, msats: number, created_at = NOW) =>
  ({ id: hex(n), postId: hex(n + 10), sender: hex(n + 20), msats, comment: '', created_at });

afterEach(() => {
  vi.useRealTimers();
  document.querySelectorAll('.zap-fx').forEach((el) => el.remove());
});

describe('animación de zap', () => {
  it('muestra el rayo y los sats sobre cualquier escena', () => {
    const s = store();
    const stop = zapFx(s);
    try {
      expect(document.querySelector('.zap-fx')).toBeNull(); // sin escena activa en el documento
      s.addZap(zap(1, 21_000));
      const fx = document.querySelector('.zap-fx')!;
      expect(fx.classList.contains('is-on')).toBe(true);
      expect(fx.querySelector('svg')).not.toBeNull();
      expect(fx.textContent).toContain('21');
      expect(fx.textContent).toContain('sats');
      expect(fx.getAttribute('role')).toBe('status');
    } finally { stop(); }
  });

  it('aparece en un lugar al azar de la franja baja, levemente inclinada, en cada zap', () => {
    const s = store();
    let r = 0;
    const stop = zapFx(s, document.body, 3000, () => r);
    try {
      s.addZap(zap(1, 21_000));
      const fx = document.querySelector<HTMLElement>('.zap-fx')!;
      expect([fx.style.left, fx.style.bottom, fx.style.getPropertyValue('--tilt')]).toEqual(['20%', '5vh', '-8deg']);
      r = 1;
      s.addZap(zap(2, 21_000));
      expect([fx.style.left, fx.style.bottom, fx.style.getPropertyValue('--tilt')]).toEqual(['80%', '15vh', '8deg']);
      expect(document.querySelectorAll('.zap-fx').length).toBe(1);
    } finally { stop(); }
  });

  it('ignora zaps fuera de la ventana en vivo y los duplicados', () => {
    const s = store();
    const stop = zapFx(s);
    try {
      s.addZap(zap(2, 5000, NOW - 600)); // historia, no evento en vivo
      expect(document.querySelector('.zap-fx')).toBeNull();
      s.addZap(zap(3, 1000));
      expect(document.querySelector('.zap-fx')?.textContent).toContain('1');
      s.addZap(zap(3, 1000)); // mismo id: no reinicia
      expect(document.querySelectorAll('.zap-fx').length).toBe(1);
    } finally { stop(); }
  });

  it('una ráfaga se fusiona en el último zap y la animación termina oculta', () => {
    vi.useFakeTimers();
    const s = store();
    const stop = zapFx(s);
    try {
      s.addZap(zap(4, 21_000));
      s.addZap(zap(5, 50_000));
      const fx = document.querySelector('.zap-fx')!;
      expect(document.querySelectorAll('.zap-fx').length).toBe(1);
      expect(fx.textContent).toContain('50');
      vi.advanceTimersByTime(3000);
      expect(fx.classList.contains('is-on')).toBe(false);
      s.addZap(zap(6, 7_000));
      expect(fx.classList.contains('is-on')).toBe(true);
      expect(fx.textContent).toContain('7');
    } finally { stop(); vi.useRealTimers(); }
  });

  it('al detenerla deja de escuchar y retira el elemento', () => {
    const s = store();
    const stop = zapFx(s);
    s.addZap(zap(7, 1000));
    expect(document.querySelector('.zap-fx')).not.toBeNull();
    stop();
    expect(document.querySelector('.zap-fx')).toBeNull();
    s.addZap(zap(8, 1000));
    expect(document.querySelector('.zap-fx')).toBeNull();
  });
});
