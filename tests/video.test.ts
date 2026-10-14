// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { videoScene, EMPTY_VIDEO } from '../src/scenes/video';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';
import { SCENES, DEFAULT_SCENE_MS } from '../server/settings';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const show = (src = '/v.webm', opts = {}) => {
  const root = document.createElement('div');
  const done = vi.fn();
  const s = videoScene(src, opts);
  const cleanup = s.render(root, done) as () => void;
  return { s, root, done, cleanup, v: root.querySelector('video') };
};

describe('videoScene: se reproduce entero una vez y avisa al terminar', () => {
  it('pantalla completa, mudo, autoplay, playsinline, SIN loop y desde 0', () => {
    const { s, v } = show('/video/a "b".webm');
    expect(s.name).toBe('video');
    expect(s.untilDone).toBe(true);
    expect(v!.getAttribute('src')).toBe('/video/a "b".webm');
    for (const a of ['autoplay', 'muted', 'playsinline']) expect(v!.hasAttribute(a), a).toBe(true);
    expect(v!.hasAttribute('loop')).toBe(false);
    expect(v!.loop).toBe(false);
    expect(v!.muted).toBe(true);
    expect(v!.currentTime).toBe(0);
  });
  it('al terminar el video (ended) llama done una sola vez', () => {
    const { v, done } = show();
    Object.defineProperty(v!, 'currentTime', { value: 1, configurable: true });
    v!.dispatchEvent(new Event('timeupdate'));
    vi.advanceTimersByTime(600_000);
    expect(done).not.toHaveBeenCalled();
    v!.dispatchEvent(new Event('ended'));
    v!.dispatchEvent(new Event('ended'));
    expect(done).toHaveBeenCalledOnce();
  });
  it('si el video falla, sigue tras una espera corta', () => {
    const { v, done } = show('/v.webm', { errorDelayMs: 2000 });
    v!.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(1999);
    expect(done).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(done).toHaveBeenCalledOnce();
  });
  it('si nunca arranca a reproducirse, sigue tras startTimeoutMs (el tótem nunca se traba)', () => {
    const { done } = show('/v.webm', { startTimeoutMs: 8000 });
    vi.advanceTimersByTime(8000);
    expect(done).toHaveBeenCalledOnce();
  });
  it('sin videoSrc muestra estado vacío y sigue tras errorDelayMs', () => {
    const { root, done } = show('', { errorDelayMs: 3000 });
    expect(root.querySelector('video')).toBeNull();
    expect(root.querySelector('.empty-msg')!.textContent).toBe(EMPTY_VIDEO);
    vi.advanceTimersByTime(3000);
    expect(done).toHaveBeenCalledOnce();
  });
  it('al salir: pausa, suelta el video y no avisa más', () => {
    const { v, done, cleanup } = show('/v.webm', { startTimeoutMs: 1000 });
    cleanup();
    expect(v!.paused).toBe(true);
    expect(v!.hasAttribute('src')).toBe(false);
    v!.dispatchEvent(new Event('ended'));
    vi.advanceTimersByTime(5000);
    expect(done).not.toHaveBeenCalled();
  });
});

describe('video en config, rotación y admin', () => {
  it('videoSrc por defecto en WebM; sin duración editable (dura lo que el video)', () => {
    expect(defaultConfig.videoSrc).toBe('/video/totem-video.webm');
    expect(SCENES).not.toContain('video');
    expect('video' in DEFAULT_SCENE_MS).toBe(false);
  });
  it('buildScenes la suma al final usando videoSrc', () => {
    const s = buildScenes({ ...defaultConfig, videoSrc: '/x.webm' }, new ZapStore());
    const v = s[s.length - 1];
    expect(v.name).toBe('video');
    expect(v.untilDone).toBe(true);
    expect(v.everyCycles).toBe(2);
    expect(defaultConfig.videoEveryCycles).toBe(2);
    expect(buildScenes({ ...defaultConfig, videoEveryCycles: 3 }, new ZapStore()).at(-1)!.everyCycles).toBe(3);
    const root = document.createElement('div');
    v.render(root, () => {});
    expect(root.querySelector('video')!.getAttribute('src')).toBe('/x.webm');
  });
});
