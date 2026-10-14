// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { videoScene, EMPTY_VIDEO } from '../src/scenes/video';
import { buildScenes } from '../src/scenes';
import { defaultConfig } from '../src/config';
import { ZapStore } from '../src/nostr/store';
import { SCENES, DEFAULT_SCENE_MS } from '../server/settings';

describe('videoScene', () => {
  it('video a pantalla completa en loop, mudo, autoplay y playsinline', () => {
    const root = document.createElement('div');
    const s = videoScene('/video/a "b".mp4', 30000);
    expect([s.name, s.duration]).toEqual(['video', 30000]);
    s.render(root);
    const v = root.querySelector('video')!;
    expect(v.getAttribute('src')).toBe('/video/a "b".mp4');
    for (const a of ['autoplay', 'muted', 'loop', 'playsinline']) expect(v.hasAttribute(a), a).toBe(true);
    expect(v.muted).toBe(true);
    expect(v.className).toBe('scene-video-el');
  });
  it('sin videoSrc muestra un estado vacío', () => {
    const root = document.createElement('div');
    videoScene('', 1).render(root);
    expect(root.querySelector('video')).toBeNull();
    expect(root.querySelector('.empty-msg')!.textContent).toBe(EMPTY_VIDEO);
  });
  it('al salir de la escena se pausa y se suelta el video', () => {
    const root = document.createElement('div');
    const cleanup = videoScene('/v.mp4', 1).render(root) as () => void;
    const v = root.querySelector('video')!;
    cleanup();
    expect(v.paused).toBe(true);
    expect(v.hasAttribute('src')).toBe(false);
  });
});

describe('video en config, rotación y admin', () => {
  it('videoSrc por defecto y 30 s de duración', () => {
    expect(defaultConfig.videoSrc).toBe('/video/totem-video.mp4');
    expect(DEFAULT_SCENE_MS.video).toBe(30000);
    expect(SCENES).toContain('video');
  });
  it('buildScenes la suma al final usando videoSrc y sceneDurations.video', () => {
    const s = buildScenes({ ...defaultConfig, videoSrc: '/x.mp4', sceneDurations: { video: 45000 } }, new ZapStore());
    const v = s[s.length - 1];
    expect([v.name, v.duration]).toEqual(['video', 45000]);
    const root = document.createElement('div');
    v.render(root);
    expect(root.querySelector('video')!.getAttribute('src')).toBe('/x.mp4');
  });
});
