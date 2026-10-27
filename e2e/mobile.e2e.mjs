// Phone flows: navigating the feed and coming back after a reload.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, openMobile, feedReady, settled, splashGone } from '../browser/harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

test('arrastrar la barra lateral hasta abajo lleva al último post', async () => {
  const page = await openMobile(app.browser, [390, 844]);
  await feedReady(page);
  const [x, y, w, h] = await page.evaluate(() => { const b = document.querySelector('.m-scrub').getBoundingClientRect(); return [b.left, b.top, b.width, b.height]; });
  await page.mouse.move(x + w / 2, y + 2); await page.mouse.down(); await page.mouse.move(x + w / 2, y + h - 1, { steps: 5 }); await page.mouse.up();
  await settled(page);
  const last = await page.evaluate(() => { const r = document.querySelector('.m-reel'); return { at: Math.round(r.scrollTop / r.clientHeight), n: r.children.length, now: Number(document.querySelector('.m-scrub').getAttribute('aria-valuenow')) }; });
  assert.deepEqual([last.at, last.now], [last.n - 1, last.n]);
  await page.close();
});

test('al recargar vuelve al mismo post del feed', async () => {
  const page = await openMobile(app.browser, [390, 700]);
  await feedReady(page);
  const third = await page.evaluate(() => { const r = document.querySelector('.m-reel'); r.scrollTop = r.children[2].offsetTop; return r.children[2].dataset.id; });
  await settled(page);
  await page.reload(); await feedReady(page);
  assert.equal(await page.evaluate(() => { const r = document.querySelector('.m-reel'); return r.children[Math.round(r.scrollTop / r.clientHeight)]?.dataset.id; }), third);
  await page.close();
});

test('al recargar Top posts conserva la fila abierta y el scroll', async () => {
  const page = await openMobile(app.browser, [390, 700]);
  await feedReady(page);
  await page.getByRole('tab', { name: 'Top posts' }).click();
  await page.locator('.m-top-head').nth(1).click();
  await page.evaluate(() => { document.querySelector('#mobile-top').scrollTop = 40; });
  await settled(page);
  await page.reload(); await splashGone(page); await page.waitForSelector('#mobile-top:not([hidden])'); await settled(page);
  assert.deepEqual(await page.evaluate(() => ({ open: document.querySelectorAll('.m-top-head[aria-expanded="true"]').length, scroll: document.querySelector('#mobile-top').scrollTop })), { open: 1, scroll: 40 });
  await page.close();
});
