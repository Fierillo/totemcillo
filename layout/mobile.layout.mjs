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
        // Zapear and «Mandá mensaje anónimo» share one row: same vertical center, Zapear on the left.
        rowOff: (() => { const b = card.querySelector('.m-zap-cta').getBoundingClientRect(); return Math.abs((b.top + b.bottom) / 2 - (fab.top + fab.bottom) / 2) > 2 || b.right > fab.left; })(),
        ctaBg: getComputedStyle(card.querySelector('.m-zap-cta')).backgroundColor, fabBg: getComputedStyle(document.querySelector('.m-fab')).backgroundColor,
        // Same height, Zapear clearly wider, the anonymous label compact on two lines.
        shape: (() => { const b = card.querySelector('.m-zap-cta').getBoundingClientRect(), f = document.querySelector('.m-fab'), r = document.createRange(); r.selectNodeContents(f.querySelector('.m-fab-label'));
          const lines = new Set([...r.getClientRects()].map((x) => Math.round(x.top))).size, fs = (el) => parseFloat(getComputedStyle(el).fontSize);
          return { sameHeight: Math.abs(b.height - fab.height) < 0.5, wider: b.width > fab.width * 1.6, lines, smaller: fs(f) < fs(card.querySelector('.m-zap-cta')) }; })(),
      };
    });
    assert.deepEqual(m, { cardOut: false, textOverflow: false, underFab: false, scrollInside: false, smallFont: false, pageScroll: false, fabOff: false, ctaOff: false, scrubOut: false, scrubHits: false, rowOff: false, ctaBg: 'rgb(199, 255, 91)', fabBg: 'rgb(139, 92, 246)', shape: { sameHeight: true, wider: true, lines: 2, smaller: true } });
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

for (const [w, h] of [[360, 640], [390, 844], [412, 915]]) {
  test(`celular ${w}x${h}: al deslizar hasta el fondo la firma del pie se ve entera, sin taparla los botones`, async () => {
    const page = await openMobile(app.browser, [w, h]);
    await feedReady(page);
    await page.evaluate(() => { const r = document.querySelector('.m-reel'); r.scrollTop = r.scrollHeight; window.scrollTo(0, document.documentElement.scrollHeight); });
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const f = document.querySelector('footer .firma').getBoundingClientRect();
      const hits = (el) => { const b = el.getBoundingClientRect(); return b.width > 0 && !(b.right <= f.left || b.left >= f.right || b.bottom <= f.top || b.top >= f.bottom); };
      return { out: f.top < 0 || f.bottom > innerHeight + 1 || !f.width, covered: [...document.querySelectorAll('.m-fab, .m-zap-cta')].some(hits) };
    });
    assert.deepEqual(r, { out: false, covered: false });
    await page.close();
  });
}

test('celular 390x844: el modal anónimo no deja huecos vacíos y el título respira', async () => {
  const page = await openMobile(app.browser, [390, 844]);
  await feedReady(page);
  await page.click('.m-fab');
  await page.waitForSelector('dialog.m-compose');
  const r = await page.evaluate(() => {
    const d = document.querySelector('dialog.m-compose'), t = d.querySelector('textarea'), w = d.querySelector('.m-compose-warn'), send = d.querySelector('[type="submit"]');
    const h = d.querySelector('h2').getBoundingClientRect(), x = d.querySelector('.m-compose-x').getBoundingClientRect(), box = d.getBoundingClientRect();
    const empties = [...d.querySelectorAll('p, div')].filter((el) => !el.textContent.trim() && !el.querySelector('svg, textarea, button') && el.getBoundingClientRect().height > 0).map((el) => el.className);
    return { empties, gapBeforeSend: Math.round(send.getBoundingClientRect().top - w.getBoundingClientRect().bottom) <= 20, titleTop: h.top - box.top >= 26, titleToX: x.left - h.right >= 12, belowText: w.getBoundingClientRect().top >= t.getBoundingClientRect().bottom };
  });
  assert.deepEqual(r, { empties: [], gapBeforeSend: true, titleTop: true, titleToX: true, belowText: true });
  await page.close();
});
