// Post images: a huge image stays inside its card on the phone and as a bounded thumbnail on the TV (boxes don't collapse).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { deflateSync } from 'node:zlib';
import { BASE, startApp, openApp, kiosk, settled, splashGone, hex, now, AUTHOR, sceneDurations, mixPosts, mixZaps, fiveZaps, five } from '../browser/harness.mjs';
import { check } from './checks.mjs';

const crc = (b) => { let c, r = -1; for (const x of b) { c = (r ^ x) & 0xff; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; r = (r >>> 8) ^ c; } return (r ^ -1) >>> 0; };
const chunk = (t, d) => { const b = Buffer.alloc(12 + d.length); b.writeUInt32BE(d.length); b.write(t, 4); d.copy(b, 8); b.writeUInt32BE(crc(b.subarray(4, 8 + d.length)), 8 + d.length); return b; };
/** A huge (2400x1800) solid PNG. */
const png = (() => { const w = 2400, h = 1800, ih = Buffer.alloc(13); ih.writeUInt32BE(w); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  const row = Buffer.alloc(1 + w * 3, 0x7a); row[0] = 0; const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ih), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]); })();
export const IMG = 'https://img.e2e.invalid/foto.png?w=2400';
// Images go through the server proxy (/api/avatar?img=1): stub it, and fail the test if the browser ever asks the image host directly.
const direct = [];
const serve = async (page) => {
  await page.route('**/api/avatar?img=1*', (r) => r.fulfill({ body: png, contentType: 'image/png' }));
  await page.route('https://img.e2e.invalid/**', (r) => { direct.push(r.request().url()); return r.abort(); });
};
const imgPost = { id: hex(600), pubkey: AUTHOR, content: `Foto del stand #lacrypta ${IMG}`, created_at: now - 2 };

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

for (const [w, h] of [[390, 844], [412, 915]]) {
  test(`móvil: el post con imagen entra en su tarjeta (feed y Top ampliado), sin la URL en el texto, en ${w}x${h}`, async () => {
    const data = { posts: [imgPost, ...five.map((p) => ({ ...p, pubkey: AUTHOR }))], zaps: [...fiveZaps, { ...fiveZaps[0], id: hex(990), postId: imgPost.id, msats: 900000 }] };
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, mobile: true, zappable: true, data });
    await serve(page); await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 });
    await page.goto(`${BASE}/`); await splashGone(page);
    await page.waitForFunction(() => document.querySelector('.m-reel > .m-post .m-media img')?.complete); await settled(page);
    const inCard = (sel) => page.evaluate((s) => { const c = document.querySelector(s), i = c.querySelector('.m-media img'), r = i.getBoundingClientRect(), b = c.getBoundingClientRect();
      return { loaded: i.naturalWidth === 2400, big: r.height >= innerHeight * 0.4 || r.width >= c.querySelector('.m-body').getBoundingClientRect().width - 1, inside: r.left >= b.left - 1 && r.right <= b.right + 1 && r.top >= b.top - 1 && r.bottom <= Math.min(b.bottom, innerHeight) + 1, urlShown: c.querySelector('.m-excerpt').textContent.includes('https://') }; }, sel);
    assert.deepEqual(await inCard('.m-reel > .m-post'), { loaded: true, big: true, inside: true, urlShown: false });
    await page.getByRole('tab', { name: 'Top posts' }).click();
    await page.locator('.m-top-head').first().click();
    await page.waitForFunction(() => document.querySelector('.m-top-row > .m-post .m-media img')?.complete);
    assert.deepEqual(await inCard('.m-top-row > .m-post'), { loaded: true, big: true, inside: true, urlShown: false });
    assert.deepEqual(direct, []);
    await page.close();
  });
}

for (const [w, h] of [[1920, 1080], [1280, 720]]) {
  test(`TV: un post con imagen es una caja grande con la imagen protagonista, sin pisar nada, en ${w}x${h}`, async () => {
    const count = async (posts) => {
      const page = await openApp(app.browser, { viewport: { width: w, height: h }, zappable: true, data: { posts, zaps: mixZaps } });
      await serve(page); await kiosk(page, sceneDurations);
      await page.goto(`${BASE}/`); await page.waitForSelector('.scene-post .post-row'); await settled(page);
      await page.waitForFunction(() => [...document.querySelectorAll('.row-media img')].every((i) => i.complete)); await settled(page);
      const r = await page.evaluate(() => { const i = document.querySelector('.row-media img'), b = i?.closest('.post-row').getBoundingClientRect(), m = i?.getBoundingClientRect();
        const others = [...document.querySelectorAll('.post-list > li:not([hidden])')].filter((li) => !li.querySelector('.row-media')).map((li) => li.getBoundingClientRect().height).sort((x, y) => x - y);
        return { n: others.length, thumb: m ? m.height >= innerHeight * 0.18 && m.height <= innerHeight * 0.3 && m.right <= b.right + 1 && m.bottom <= b.bottom + 1
          && b.height >= 1.75 * others[others.length >> 1] : null }; });
      const issues = await page.evaluate(check, 'post');
      await page.close();
      return { ...r, issues };
    };
    const plain = await count(mixPosts), withImg = await count([imgPost, ...mixPosts]);
    assert.deepEqual(withImg.issues, []);
    assert.equal(withImg.thumb, true);
    assert.deepEqual(direct, []);
    assert.ok(withImg.n >= plain.n / 2, `cajas con imagen ${withImg.n} vs sin ${plain.n}`); // the image box takes room, the rest still shows
  });
}
