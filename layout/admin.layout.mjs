// Admin panel geometry: wide grid on desktop, one column with sticky tabs on the phone; nothing overflows.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { out, startApp, adminLogin, settled } from '../browser/harness.mjs';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

const cards = (page) => page.evaluate(() => ({
  vw: innerWidth, sw: document.documentElement.scrollWidth, pw: document.querySelector('.panel').getBoundingClientRect().width,
  cards: [...document.querySelectorAll('.panel .card')].filter((c) => c.getBoundingClientRect().width > 0).map((c) => { const r = c.getBoundingClientRect(); return { l: Math.round(r.left), r: r.right, over: c.scrollWidth > c.clientWidth + 1 }; }),
}));
const overflows = (c) => c.sw > c.vw || c.cards.some((x) => x.r > c.vw || x.over);

test('admin en 1920: aprovecha el ancho, sin pestañas y sin desbordes', async () => {
  const page = await adminLogin(app.browser, { width: 1920, height: 1080 });
  await settled(page);
  const c = await cards(page);
  assert.equal(await page.isVisible('nav.tabs'), false);
  assert.ok(c.cards.length >= 4 && c.pw >= c.vw * 0.5 && !overflows(c), JSON.stringify(c));
  await page.screenshot({ path: `${out}/admin-panel.png`, fullPage: true });
  await page.close();
});

test('admin en 390: una columna, pestañas fijas que cambian el contenido, sin desbordes', async () => {
  const page = await adminLogin(app.browser, { width: 390, height: 844 });
  await settled(page);
  const c = await cards(page);
  assert.ok(c.cards.length >= 4 && new Set(c.cards.map((x) => x.l)).size === 1 && !overflows(c), JSON.stringify(c));
  await page.evaluate(() => window.scrollTo(0, 250));
  await page.waitForFunction(() => Math.abs(document.querySelector('nav.tabs').getBoundingClientRect().top) <= 1, null, { timeout: 2000 });
  await page.click('[data-tab="mod"]');
  assert.deepEqual([await page.isVisible('[data-pane="config"]'), await page.isVisible('[data-pane="mod"]')], [false, true]);
  await page.click('[data-tab="config"]');
  assert.deepEqual([await page.isVisible('[data-pane="config"]'), await page.isVisible('[data-pane="mod"]')], [true, false]);
  await page.screenshot({ path: `${out}/admin-panel-390.png`, fullPage: true });
  await page.close();
});
