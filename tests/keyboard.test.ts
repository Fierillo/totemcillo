// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { bindKeyboard } from '../src/keyboard';

const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

describe('bindKeyboard', () => {
  it('→ siguiente, ← anterior, el resto se ignora; se puede desenganchar', () => {
    const r = { next: vi.fn(), prev: vi.fn() };
    const off = bindKeyboard(r, window);
    key('ArrowRight');
    key('ArrowRight');
    key('ArrowLeft');
    key('a');
    expect(r.next).toHaveBeenCalledTimes(2);
    expect(r.prev).toHaveBeenCalledTimes(1);
    off();
    key('ArrowRight');
    key('ArrowLeft');
    expect(r.next).toHaveBeenCalledTimes(2);
    expect(r.prev).toHaveBeenCalledTimes(1);
  });
});
