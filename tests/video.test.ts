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

describe('videoScene: modo clip (videoMode)', () => {
  const meta = (v: HTMLVideoElement, duration: number) => {
    Object.defineProperty(v, 'duration', { value: duration, configurable: true });
    v.dispatchEvent(new Event('loadedmetadata'));
  };
  const at = (v: HTMLVideoElement, t: number) => { v.currentTime = t; v.dispatchEvent(new Event('timeupdate')); };
  it('por defecto es full; config: videoMode full y videoClipSeconds 21', () => {
    expect(videoScene('/v.webm').videoMode).toBe('full');
    expect(defaultConfig.videoMode).toBe('full');
    expect(defaultConfig.videoClipSeconds).toBe(21);
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const json = JSON.parse(readFileSync(new URL('../public/config.json', import.meta.url), 'utf8'));
    expect([json.videoMode, json.videoClipSeconds]).toEqual(['full', 21]);
    const v = buildScenes({ ...defaultConfig, videoMode: 'clip', videoClipSeconds: 10 }, new ZapStore()).at(-1)!;
    expect(v.videoMode).toBe('clip');
    expect(v.clipSeconds).toBe(10);
  });
  it('clip: arranca en un punto al azar de [0, duración-21] y termina a los 21 s', () => {
    const { v, done } = show('/v.webm', { mode: 'clip', random: () => 0.5 });
    meta(v!, 121);
    expect(v!.currentTime).toBe(50);
    at(v!, 60);
    expect(done).not.toHaveBeenCalled();
    at(v!, 71);
    expect(done).toHaveBeenCalledOnce();
  });
  it('clip: respeta clipSeconds y tiene timeout por si no llegan timeupdates', () => {
    const { v, done } = show('/v.webm', { mode: 'clip', clipSeconds: 5, random: () => 1 });
    meta(v!, 100);
    expect(v!.currentTime).toBe(95);
    at(v!, 96);
    vi.advanceTimersByTime(5000);
    expect(done).toHaveBeenCalledOnce();
  });
  it('clip con video de 21 s o menos: desde 0 hasta el final', () => {
    const { v, done } = show('/v.webm', { mode: 'clip', random: () => 0.7 });
    meta(v!, 21);
    expect(v!.currentTime).toBe(0);
    at(v!, 20);
    vi.advanceTimersByTime(30000);
    expect(done).not.toHaveBeenCalled();
    v!.dispatchEvent(new Event('ended'));
    expect(done).toHaveBeenCalledOnce();
  });
  it('clipSeconds cambiado en caliente: nunca deja menos de X s por delante', () => {
    const s = videoScene('/v.webm', { mode: 'clip', random: () => 1 });
    s.clipSeconds = 30;
    const root = document.createElement('div');
    const done = vi.fn();
    s.render(root, done);
    const v = root.querySelector('video')!;
    meta(v, 100);
    expect(v.currentTime).toBe(70);
    at(v, 99);
    expect(done).not.toHaveBeenCalled();
    at(v, 100);
    expect(done).toHaveBeenCalledOnce();
  });
  it('el modo se puede cambiar en caliente (rige desde la próxima vez)', () => {
    const s = videoScene('/v.webm', { random: () => 0.5 });
    s.videoMode = 'clip';
    const root = document.createElement('div');
    s.render(root, () => {});
    const v = root.querySelector('video')!;
    meta(v, 121);
    expect(v.currentTime).toBe(50);
  });
});

