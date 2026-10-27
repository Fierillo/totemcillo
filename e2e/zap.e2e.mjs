// Zap flow through the live path (dev server exposes window.__totemDemo).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, startDev, openApp, splashGone, settled, AUTHOR } from '../browser/harness.mjs';

let app, dev;
before(async () => { app = await startApp(); dev = await startDev(app.browser); });
after(async () => { await dev.close(); await app.close(); });

test('un zap en el celular reordena Top y el rayo cae en la fila zapeada', async () => {
  const page = await openApp(app.browser, { viewport: { width: 390, height: 844 }, mobile: true, zappable: true });
  await page.goto(dev.url);
  await page.waitForFunction(() => window.__totemDemo);
  await splashGone(page);
  await page.evaluate((a) => [3, 2, 1].forEach((k) => window.__totemDemo.zap(window.__totemDemo.post(`Post e2e ${k} #lacrypta`, a), k * 1_000_000)), AUTHOR); // the last row has the least
  await page.getByRole('tab', { name: 'Top posts' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.m-top-row').length >= 3);
  await settled(page);
  // Something wider than the screen (the phone zooms out) must not move the bolt off the row.
  const hit = await page.evaluate(() => new Promise((res) => {
    const wide = Object.assign(document.createElement('div'), { style: 'position:absolute;top:0;left:0;width:520px;height:1px' }); document.body.append(wide);
    const id = [...document.querySelectorAll('.m-top-row')].find((r) => r.textContent.includes('Post e2e 1')).dataset.id;
    new MutationObserver((ms, o) => { for (const m of ms) for (const n of m.addedNodes) if (n.classList?.contains('strike')) {
      o.disconnect(); wide.remove();
      const c = n.querySelector('circle.impact').getBoundingClientRect(), r = document.querySelector(`.m-top-row[data-id="${id}"]`).getBoundingClientRect();
      const x = (c.left + c.right) / 2, y = (c.top + c.bottom) / 2;
      res({ inside: x >= r.left && x <= r.right && y >= r.top && y <= r.bottom, rank: [...document.querySelectorAll('.m-top-row')].findIndex((e) => e.dataset.id === id) });
    } }).observe(document.body, { childList: true });
    window.__totemDemo.zap(id, 100_000_000);
  }));
  assert.deepEqual(hit, { inside: true, rank: 0 });
  await page.close();
});
