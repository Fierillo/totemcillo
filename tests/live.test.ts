// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { ZapStore } from '../src/nostr/store';
import { live } from '../src/scenes/live';

describe('live', () => {
  it('redibuja en cambios del store y en resize; deja de hacerlo al limpiar', () => {
    const s = new ZapStore(), draw = vi.fn();
    const off = live(s, draw);
    expect(draw).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('resize'));
    expect(draw).toHaveBeenCalledTimes(2);
    s.addPost({ id: 'a', pubkey: 'p', content: 'x', created_at: 1 });
    expect(draw).toHaveBeenCalledTimes(3);
    off();
    window.dispatchEvent(new Event('resize'));
    s.addPost({ id: 'b', pubkey: 'p', content: 'x', created_at: 1 });
    expect(draw).toHaveBeenCalledTimes(3);
  });
});
