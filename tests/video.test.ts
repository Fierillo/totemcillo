// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { videoScene, EMPTY_VIDEO } from '../src/scenes/video';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';
import { SCENES, DEFAULT_SCENE_MS } from '../shared/settings';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const show = (src = '/v.webm') => {
  const root = document.createElement('div');
  const s = videoScene(src);
  const cleanup = s.render(root);
  return { s, root, cleanup, v: root.querySelector('video') };
};

describe('videoScene: reproducción gobernada por la agenda', () => {
  it('la agenda es dueña de las transiciones: el renderer no programa avances locales', () => {
    const { root, v, cleanup } = show();
    expect(vi.getTimerCount()).toBe(0);
    v!.dispatchEvent(new Event('ended'));
    v!.dispatchEvent(new Event('error'));
    vi.advanceTimersByTime(600_000);
    expect(root.querySelector('video')).toBe(v);
    expect(vi.getTimerCount()).toBe(0);
    cleanup?.();
  });
  it('pantalla completa, mudo, autoplay, playsinline, sin loop y desde 0', () => {
    const { s, v } = show('/video/a "b".webm');
    expect(s.name).toBe('video');
    expect(v!.getAttribute('src')).toBe('/video/a "b".webm');
    for (const a of ['autoplay', 'muted', 'playsinline']) expect(v!.hasAttribute(a), a).toBe(true);
    expect(v!.hasAttribute('loop')).toBe(false);
    expect(v!.loop).toBe(false);
    expect(v!.muted).toBe(true);
    expect(v!.currentTime).toBe(0);
  });
  it('sin videoSrc muestra estado vacío sin programar una transición local', () => {
    const { root } = show('');
    expect(root.querySelector('video')).toBeNull();
    expect(root.querySelector('.empty-msg')!.textContent).toBe(EMPTY_VIDEO);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('al salir pausa, suelta el video y limpia la corrección de deriva', () => {
    const root = document.createElement('div');
    const cleanup = videoScene('/v.webm').render(root, { expectedSec: () => 1 });
    const v = root.querySelector('video')!;
    expect(vi.getTimerCount()).toBe(1);
    cleanup?.();
    expect(v.paused).toBe(true);
    expect(v.hasAttribute('src')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('videoSrc por defecto en WebM; sin duración editable', () => {
    expect(defaultConfig.videoSrc).toBe('/video/totem-video.webm');
    expect(SCENES).not.toContain('video');
    expect('video' in DEFAULT_SCENE_MS).toBe(false);
  });
  it('buildScenes agrega el video al final usando videoSrc', () => {
    const s = buildScenes({ ...defaultConfig, videoSrc: '/x.webm' }, new ZapStore());
    const v = s.at(-1)!;
    expect(v.name).toBe('video');
    const root = document.createElement('div');
    v.render(root);
    expect(root.querySelector('video')!.getAttribute('src')).toBe('/x.webm');
  });
});
