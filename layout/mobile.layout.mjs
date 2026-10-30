// Phone geometry: the feed post always fits the screen, the floating button and the scrubber never cover it.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, out, startApp, openApp, openMobile, feedReady, splashGone } from '../browser/harness.mjs';
import { checkHeader } from './checks.mjs';

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

for (const [w, h] of [[360, 640], [390, 700], [390, 844], [412, 915]]) {
  test(`el post del feed, el botón flotante y la barra lateral entran sin taparse en ${w}x${h}`, async () => {
    const page = await openMobile(app.browser, [w, h]);
    await page.waitForSelector('.m-splash[role="status"]', { timeout: 5000 });
    await feedReady(page);
    const m = await page.evaluate(() => {
      const card = document.querySelector('.m-reel > .m-post'), ex = card.querySelector('.m-excerpt'), side = card.querySelector('.m-side');
      const fab = document.querySelector('.m-fab').getBoundingClientRect(), c = card.getBoundingClientRect(), e = ex.getBoundingClientRect(), s = side.getBoundingClientRect();
      const link = card.querySelector('.m-body a:last-of-type')?.getBoundingClientRect();
      const bar = document.querySelector('.m-scrub').getBoundingClientRect(), hit = (el) => { const r = el.getBoundingClientRect(); return !(r.right <= bar.left || r.left >= bar.right || r.bottom <= bar.top || r.top >= bar.bottom); };
      return {
        cardOut: c.bottom > innerHeight + 1, textOverflow: ex.scrollHeight > ex.clientHeight + 1 || ex.scrollWidth > ex.clientWidth + 1,
        underFab: (e.bottom > fab.top + 1 && e.right > fab.left) || (s.bottom > fab.top + 1 && s.right > fab.left) || (!!link && link.bottom > fab.top + 1 && link.right > fab.left),
        scrollInside: [...card.querySelectorAll('*')].some((el) => /auto|scroll/.test(getComputedStyle(el).overflowY)),
        smallFont: !(parseFloat(ex.style.fontSize) >= 10), pageScroll: document.documentElement.scrollHeight > innerHeight + 1,
        fabOff: fab.height < 40 || parseFloat(getComputedStyle(document.querySelector('.m-fab')).fontSize) > 13 || innerWidth - fab.right > 16 || innerHeight - fab.bottom < 40 || fab.width > innerWidth * 0.6,
        scrubOut: bar.left < 0 || bar.right > innerWidth || document.documentElement.scrollWidth > innerWidth,
        ctaOff: (() => { const b = card.querySelector('.m-zap-cta')?.getBoundingClientRect(), hits = (r) => !(b.right <= r.left || b.left >= r.right || b.bottom <= r.top || b.top >= r.bottom);
          return !b || b.height < 40 || b.bottom > innerHeight || b.left < 0 || hits(e) || hits(s) || hits(fab) || (!!link && hits(link)); })(),
        scrubHits: [...document.querySelectorAll('.m-side')].some(hit) || hit(document.querySelector('.m-fab')) || hit(card.querySelector('.m-body')),
      };
    });
    assert.deepEqual(m, { cardOut: false, textOverflow: false, underFab: false, scrollInside: false, smallFont: false, pageScroll: false, fabOff: false, ctaOff: false, scrubOut: false, scrubHits: false });
    assert.deepEqual(await page.evaluate(checkHeader), []);
    await page.screenshot({ path: `${out}/${w}x${h}-mobile.png` });
    await page.close();
  });
}

test('un anuncio con una URL de 300 caracteres no ensancha la página del celular', async () => {
  const page = await openApp(app.browser, { viewport: { width: 390, height: 844 }, mobile: true });
  const url = `Mirá https://lacrypta.ar/${'a'.repeat(275)}`; // mobile reads the announcement from /api/settings
  await page.route('**/api/settings*', async (r) => r.fulfill({ json: { ...(await (await r.fetch()).json()), announcement: url } }));
  await page.goto(`${BASE}/`);
  await splashGone(page);
  await page.click('[data-ann]');
  await page.waitForFunction(() => document.querySelector('.m-anuncio')?.textContent.length > 250); // capped at MAX_ANNOUNCEMENT (280)
  const r = await page.evaluate(() => { const a = document.querySelector('.m-anuncio'); return { sw: Math.max(document.documentElement.scrollWidth, a.scrollWidth + a.getBoundingClientRect().left), vw: innerWidth }; });
  assert.ok(r.sw <= r.vw, JSON.stringify(r));
  await page.close();
});

test('celular: la firma «totemcillo fue hecho con 💚 por Fierillo» al pie, con sus dos enlaces, sin taparse', async () => {
  const page = await openMobile(app.browser, [390, 844]);
  await feedReady(page);
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  const r = await page.evaluate(() => {
    const f = document.querySelector('footer .firma');
    if (!f || !f.getBoundingClientRect().width) return { missing: true };
    const b = f.getBoundingClientRect(), fab = document.querySelector('.m-fab').getBoundingClientRect();
    return { text: f.textContent.replace(/\s+/g, ' ').trim(), links: [...f.querySelectorAll('a')].map((a) => [a.textContent, a.href, a.target, /noopener/.test(a.rel)]),
      out: b.left < 0 || b.right > innerWidth || b.bottom > innerHeight + 1, fab: !(b.right <= fab.left || b.left >= fab.right || b.bottom <= fab.top || b.top >= fab.bottom),
      icon: !!document.querySelector('.repo-link') };
  });
  assert.deepEqual(r, { text: 'totemcillo fue hecho con 💚 por Fierillo', links: [['totemcillo', 'https://github.com/Fierillo/totemcillo', '_blank', true], ['Fierillo', 'https://github.com/Fierillo', '_blank', true]], out: false, fab: false, icon: false });
  await page.screenshot({ path: '/workspace/totemcillo-firma2-mobile-390x844-footer.png' });
  await page.close();
});
