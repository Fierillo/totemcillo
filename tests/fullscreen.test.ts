// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Follower, sceneKeys, fullscreenButton, toggleFullscreen } from '../src/follow';

const fsDoc = () => {
  const el = document.documentElement as any, d = document as any;
  el.requestFullscreen = vi.fn(async () => { d.fullscreenElement = el; d.dispatchEvent(new Event('fullscreenchange')); });
  d.exitFullscreen = vi.fn(async () => { d.fullscreenElement = null; d.dispatchEvent(new Event('fullscreenchange')); });
  d.fullscreenElement = null;
  return { el, d };
};

describe('fullscreen (totem)', () => {
  afterEach(() => { document.body.innerHTML = ''; });
  it('toggleFullscreen enters and exits', async () => {
    const { el, d } = fsDoc();
    toggleFullscreen(document);
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    toggleFullscreen(document);
    expect(d.exitFullscreen).toHaveBeenCalledTimes(1);
  });
  it('button toggles and updates its aria-label', async () => {
    fsDoc();
    const btn = fullscreenButton(document, document.body)!;
    expect(btn.getAttribute('aria-label')).toBe('Pantalla completa');
    expect(btn.querySelector('svg')).not.toBeNull();
    btn.click();
    await Promise.resolve();
    expect(btn.getAttribute('aria-label')).toBe('Salir de pantalla completa');
    btn.click();
    await Promise.resolve();
    expect(btn.getAttribute('aria-label')).toBe('Pantalla completa');
  });
  it('no button without Fullscreen API', () => {
    const el = document.documentElement as any, d = document as any;
    el.requestFullscreen = undefined; el.webkitRequestFullscreen = undefined;
    d.fullscreenEnabled = false; d.webkitFullscreenEnabled = false;
    expect(fullscreenButton(document, document.body)).toBeNull();
    expect(document.querySelector('.fs-toggle')).toBeNull();
  });
  it('f / F key toggles, ignored with modifiers or while typing', () => {
    const { el, d } = fsDoc();
    const off = sceneKeys(document, {} as Follower);
    const key = (k: string, o: KeyboardEventInit = {}, t: EventTarget = document) => t.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...o }));
    key('f');
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);
    key('F');
    expect(d.exitFullscreen).toHaveBeenCalledTimes(1);
    key('f', { ctrlKey: true });
    const input = document.body.appendChild(document.createElement('input'));
    key('f', {}, input);
    expect(el.requestFullscreen).toHaveBeenCalledTimes(1);
    expect(d.exitFullscreen).toHaveBeenCalledTimes(1);
    off();
  });
});
