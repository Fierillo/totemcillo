// Totem (desktop) flows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, startApp, openApp, kiosk, settled, five, fiveZaps } from '../browser/harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('al volver a entrar a Mensajes el tótem muestra los mismos posts y totales', async () => {
  const page = await openApp(app.browser, { config: { publicUrl: 'https://totem.lacrypta.ar/' }, data: { posts: five, zaps: fiveZaps } });
  const k = await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 });
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.scene-post .post-row');
  await settled(page);
  const shown = () => page.evaluate(() => [...document.querySelectorAll('.post-row')].map((c) => c.querySelector('.excerpt').textContent + '|' + c.querySelector('.row-total').textContent).join('\n'));
  const first = await shown();
  for (let i = 0; i < 2; i++) {
    await k.show('post');
    await settled(page);
    assert.equal(await shown(), first);
  }
  await page.close();
});
