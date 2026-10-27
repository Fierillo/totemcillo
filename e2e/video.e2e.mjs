// Video scene flows: the schedule plays it and always moves on.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startApp, openApp, kiosk, sceneIs, sceneOf } from '../browser/harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('el video se reproduce desde el inicio, sin loop ni sonido, y al terminar pasa a Mensajes', async () => {
  const page = await openApp(app.browser, { config: { videoSrc: '/video/totem-video.webm' } });
  const k = await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 }, { videoMode: 'full', videoDurationSec: 6 });
  await page.goto(`${BASE}/`);
  await k.show('video');
  await page.waitForFunction(() => document.querySelector('.scene-video video')?.currentTime > 0, null, { timeout: 5000 });
  const v = await page.evaluate(() => { const el = document.querySelector('.scene-video video'); return { loop: el.loop, muted: el.muted, paused: el.paused, early: el.currentTime <= 4 }; });
  assert.deepEqual(v, { loop: false, muted: true, paused: false, early: true });
  await sceneIs(page, 'scene scene-post', 10000);
  assert.equal(await sceneOf(page), 'scene scene-post');
  await page.close();
});

test('con videoEveryCycles 2 el video sale una vuelta sí y otra no', async () => {
  const page = await openApp(app.browser, { config: { videoSrc: '/video/no-existe.webm', settingsPollMs: 600000 } });
  await kiosk(page, { post: 400, batalla: 400, anuncio: 400 }, { videoEveryCycles: 2, videoMode: 'full', videoDurationSec: 0.4 });
  await page.addInitScript(() => {
    window.__seq = [];
    setInterval(() => { const c = document.getElementById('scene')?.className.replace('scene scene-', ''); if (c && c !== 'scene' && window.__seq.at(-1) !== c) window.__seq.push(c); }, 50);
  });
  await page.goto(`${BASE}/`);
  await page.waitForFunction(() => window.__seq.filter((c) => c === 'post').length >= 6, null, { timeout: 30000 });
  const cycles = (await page.evaluate(() => window.__seq)).join(' ').split(/(?=post)/).map((c) => c.trim()).filter(Boolean).slice(1, -1); // first and last may be partial
  const withVideo = cycles.slice(0, 4).map((c) => c.includes('video'));
  assert.ok(withVideo.length >= 2 && withVideo.every((x, i) => i === 0 || x !== withVideo[i - 1]), JSON.stringify(cycles));
  await page.close();
});

test('un video roto no traba el tótem: la agenda sigue a Mensajes', async () => {
  const page = await openApp(app.browser, { config: { videoSrc: '/video/no-existe.webm' } });
  const k = await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 }, { videoMode: 'full', videoDurationSec: 3 });
  await page.goto(`${BASE}/`);
  await k.show('video');
  assert.equal(await sceneOf(page), 'scene scene-video');
  await sceneIs(page, 'scene scene-post', 8000);
  assert.equal(await sceneOf(page), 'scene scene-post');
  await page.close();
});
