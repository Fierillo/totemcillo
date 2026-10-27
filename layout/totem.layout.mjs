// Totem geometry: nothing overlaps, overflows or clips, at kiosk sizes, small windows and usual DPRs.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { BASE, out, startApp, openApp, kiosk, settled, hex, now, AUTHOR, posts, zaps, sceneDurations, comments, five, fiveZaps, mixPosts, mixZaps } from '../browser/harness.mjs';
import { check, checkEmpty, checkHeader, checkRepoLink } from './checks.mjs';

const viewports = [[1280, 720], [1920, 1080], [1080, 1920]];
const smallViewports = [[1024, 600], [1024, 415], [1024, 400], [800, 600], [1366, 500], [1024, 300]];
// Normal browser windows (tabs + URL bar) at the usual DPR / zoom levels.
const windowViewports = [[1366, 657], [1280, 631], [1536, 730], [1920, 947], [1024, 600]].flatMap(([w, h]) => [1, 1.25, 1.5, 2].map((d) => [w, h, d]));
const tagged = (tag, list) => list.map((p) => `${tag}: ${p}`);

let app;
before(async () => { app = await startApp(); });
after(() => app.close());

for (const [w, h, dpr = 1] of [...viewports, ...smallViewports, ...windowViewports]) {
  test(`Mensajes y Batalla entran sin cortes en ${w}x${h}@${dpr}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, dpr, zappable: true, data: { posts, zaps } });
    const k = await kiosk(page, sceneDurations);
    await page.goto(`${BASE}/`);
    const problems = [];
    for (const scene of ['post', 'batalla']) {
      await k.show(scene);
      if (scene === 'batalla') await page.waitForSelector('.batalla > li', { timeout: 15000 });
      await settled(page);
      problems.push(...tagged(scene, await page.evaluate(check, scene)), ...tagged(scene, await page.evaluate(checkRepoLink)));
      if (scene === 'post') problems.push(...tagged('header', await page.evaluate(checkHeader)));
      await page.screenshot({ path: `${out}/${w}x${h}@${dpr}-${scene}.png` });
    }
    await k.show('video');
    problems.push(...tagged('video', await page.evaluate(checkRepoLink)));
    assert.deepEqual(problems, []);
    await page.close();
  });
}

for (const [w, h, dpr] of [[1920, 1080], [1280, 631], [1024, 447], [1366, 657]].flatMap(([w, h]) => [1, 1.5].map((d) => [w, h, d]))) {
  test(`Mensajes: ninguna caja (tampoco las de dos filas) pisa la zona del QR en ${w}x${h}@${dpr}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, dpr, zappable: true, data: { posts: mixPosts, zaps: mixZaps } });
    await kiosk(page, sceneDurations);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    const r = await page.evaluate(() => {
      const ul = document.querySelector('.post-list'), q = document.querySelector('figure.qr').getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(ul).rowGap) / 2; // a margin around the QR
      const boxes = [...ul.querySelectorAll('.post-row')];
      // layout spots (the float's transform aside)
      const hits = boxes.filter((b) => { const o = b.offsetParent.getBoundingClientRect(), x = o.left + b.offsetLeft, y = o.top + b.offsetTop; return x + b.offsetWidth > q.left - gap && x < q.right + gap && y + b.offsetHeight > q.top - gap && y < q.bottom + gap; });
      return { hits: hits.map((b) => `${b.classList.contains('is-long') ? '2 filas' : '1 fila'}: ${b.textContent.trim().slice(0, 30)}`), long: ul.querySelectorAll('.post-row.is-long').length };
    });
    assert.ok(r.long > 0, 'sin cajas de dos filas para probar');
    assert.deepEqual(r.hits, []);
    await page.close();
  });
}

for (const [w, h] of [[1920, 1080], [1280, 631]]) {
  test(`Mensajes: la caja de un mensaje largo ocupa dos filas y la letra de la lista es cómoda en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, data: { posts, zaps } });
    await kiosk(page, sceneDurations);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    const r = await page.evaluate(() => {
      const list = document.querySelector('.post-list'), css = getComputedStyle(list);
      const row = parseFloat(css.gridTemplateRows), long = document.querySelector('.post-row.is-long');
      return { long: long?.offsetHeight, row, font: parseFloat(list.style.fontSize), floor: Number(list.dataset.floor) };
    });
    assert.ok(r.long > r.row, JSON.stringify(r)); // spans two rows
    assert.ok(r.font >= r.floor, JSON.stringify(r));
    // the order: shrink → grow → truncate. A two-row box never holds a message that fit one cell at the minimum font.
    const wasted = await page.evaluate(() => {
      const ul = document.querySelector('.post-list'), min = Number(ul.dataset.boxMin);
      return [...ul.querySelectorAll('.post-row.is-long')].filter((box) => {
        const p = box.querySelector('.excerpt'), size = p.style.fontSize;
        box.classList.remove('is-long'); p.style.fontSize = `${min}px`;
        const fit = p.scrollHeight <= p.clientHeight + 1;
        box.classList.add('is-long'); p.style.fontSize = size;
        return fit;
      }).map((b) => b.textContent.trim().slice(0, 40));
    });
    assert.deepEqual(wasted, []);
    // reading order: the boxes appear left→right, top→bottom in message order (no dense refill)
    const order = await page.evaluate(() => [...document.querySelectorAll('.post-list > .post-row')].map((b) => [b.offsetTop, b.offsetLeft])); // layout spots, not the float
    for (let i = 1; i < order.length; i++) assert.ok(order[i][0] > order[i - 1][0] || (order[i][0] === order[i - 1][0] && order[i][1] > order[i - 1][1]), JSON.stringify(order));
    await page.close();
  });
}

for (const [w, h] of viewports) {
  test(`8 zaps con comentario: filas, QR y letra legibles en ${w}x${h}`, async () => {
    const post = [{ id: hex(1), pubkey: AUTHOR, content: 'Probando #lacrypta con un texto normal de un post', created_at: now - 600 }];
    const realZaps = comments.map((c, i) => ({ id: hex(500 + i), postId: hex(1), sender: (i + 1).toString().repeat(64), msats: (i + 1) * 21000, comment: c, created_at: now - i * 30, domain: 'getalby.com' }));
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, zappable: true, data: { posts: post, zaps: realZaps } });
    const k = await kiosk(page, { post: 60000, batalla: 60000 });
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    const r = await page.evaluate(() => { const ul = document.querySelector('ul.post-list'); return { font: parseFloat(ul.style.fontSize), vh: innerHeight, qr: !!document.querySelector('figure.qr') }; });
    assert.ok(r.qr, 'falta el QR');
    assert.ok(r.font <= r.vh * 0.05 + 1, `fuente ${r.font}px > 5vh`);
    await k.show('batalla');
    await page.waitForSelector('.batalla > li', { timeout: 15000 });
    await settled(page);
    assert.deepEqual(await page.evaluate(check, 'batalla'), []);
    await page.close();
  });

  test(`5 posts: al menos 3 visibles a la vez y un solo QR en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, config: { publicUrl: 'https://totem.lacrypta.ar/' }, data: { posts: five, zaps: fiveZaps } });
    await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 });
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    assert.deepEqual(await page.evaluate(check, 'post'), []);
    const r = await page.evaluate(() => {
      const main = document.getElementById('scene').getBoundingClientRect();
      const visible = [...document.querySelectorAll('.post-row')].filter((c) => { const b = c.getBoundingClientRect(); return b.width > 50 && b.height > 30 && b.top >= main.top - 1 && b.bottom <= main.bottom + 1; }).length;
      return { visible, qr: document.querySelectorAll('figure.qr').length };
    });
    assert.ok(r.visible >= 3, `sólo ${r.visible} visibles`);
    assert.equal(r.qr, 1);
    await page.screenshot({ path: `${out}/${w}x${h}-5posts-post.png` });
    await page.close();
  });

  test(`estados vacíos y anuncio alrededor del QR en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h } });
    const k = await kiosk(page, { post: 60000, batalla: 60000 });
    await page.goto(`${BASE}/`);
    const problems = [];
    for (const [scene, expected] of [['post', 'Todavía no hay posts con #lacrypta'], ['batalla', 'Todavía no hay zaps en las últimas 3 horas'], ['anuncio', 'Sin anuncios por ahora']]) {
      await k.show(scene);
      await settled(page);
      problems.push(...tagged(scene, await page.evaluate(checkEmpty, [scene, expected])));
    }
    assert.deepEqual(problems, []);
    await (await kiosk(page, { anuncio: 60000 }, { announcement: 'Bitcoin, Nostr y proyectos de la comunidad. '.repeat(40) })).show('anuncio');
    await settled(page);
    const flow = await page.evaluate(() => {
      const text = document.querySelector('.anuncio-msg'), qr = document.querySelector('.qr').getBoundingClientRect();
      const box = text.getBoundingClientRect(), heading = document.querySelector('#scene h1').getBoundingClientRect(), main = document.querySelector('#scene').getBoundingClientRect();
      const range = document.createRange(); range.selectNodeContents(text);
      const lines = [...range.getClientRects()];
      return {
        overlaps: lines.some((r) => r.right > qr.left + 1 && r.left < qr.right - 1 && r.bottom > qr.top + 1 && r.top < qr.bottom - 1),
        fullWidthAbove: lines.some((r) => r.bottom < qr.top && r.right > qr.left),
        overflow: text.scrollHeight > text.clientHeight + 1,
        outside: box.top < heading.bottom - 1 || box.bottom > main.bottom + 1,
        offCenter: Math.abs((box.top + box.bottom - main.top - main.bottom) / 2) > 2,
      };
    });
    assert.deepEqual(flow, { overlaps: false, fullWidthAbove: true, overflow: false, outside: false, offCenter: false });
    await page.screenshot({ path: `${out}/${w}x${h}-announcement-flow.png` });
    await page.close();
  });

  test(`el video ocupa la escena con object-fit contain y fondo negro en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, config: { videoSrc: '/video/totem-video.webm' } });
    const k = await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 }, { videoMode: 'full', videoDurationSec: 60 });
    await page.goto(`${BASE}/`);
    await k.show('video');
    await page.waitForSelector('.scene-video video');
    await settled(page);
    const v = await page.evaluate(() => {
      const el = document.querySelector('.scene-video video'), r = el.getBoundingClientRect(), m = document.getElementById('scene').getBoundingClientRect();
      return { fit: getComputedStyle(el).objectFit, fills: Math.abs(r.width - m.width) <= 2 && Math.abs(r.height - m.height) <= 2, bg: getComputedStyle(document.getElementById('scene')).backgroundColor };
    });
    assert.deepEqual(v, { fit: 'contain', fills: true, bg: 'rgb(0, 0, 0)' });
    await page.screenshot({ path: `${out}/${w}x${h}-video.png` });
    await page.close();
  });
}
