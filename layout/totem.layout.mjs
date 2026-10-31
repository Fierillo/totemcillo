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
  test(`Mensajes: ninguna caja (tampoco las agrandadas) pisa la zona del QR en ${w}x${h}@${dpr}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, dpr, zappable: true, data: { posts: mixPosts, zaps: mixZaps } });
    await kiosk(page, sceneDurations);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    const r = await page.evaluate(() => {
      const ul = document.querySelector('.post-list'), q = document.querySelector('figure.qr').getBoundingClientRect();
      const gap = parseFloat(getComputedStyle(ul).rowGap) / 2; // a margin around the QR (fitBoxes keeps a whole gap)
      const boxes = [...ul.querySelectorAll('.post-row')];
      // layout spots (the float's transform aside)
      const hits = boxes.filter((b) => { const o = b.offsetParent.getBoundingClientRect(), x = o.left + b.offsetLeft, y = o.top + b.offsetTop; return x + b.offsetWidth > q.left - gap && x < q.right + gap && y + b.offsetHeight > q.top - gap && y < q.bottom + gap; });
      return { hits: hits.map((b) => `${b.classList.contains('is-long') ? 'agrandada' : 'normal'}: ${b.textContent.trim().slice(0, 30)}`), long: ul.querySelectorAll('.post-row.is-long').length };
    });
    assert.ok(r.long > 0, 'sin cajas agrandadas para probar');
    assert.deepEqual(r.hits, []);
    await page.close();
  });
}

for (const [w, h] of [[1920, 1080], [1366, 657], [1024, 434]]) {
  test(`Batalla con muchos posts: un mensaje sólo se trunca a la letra mínima y usando todo el alto y el ancho de su barra en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, zappable: true, data: { posts: mixPosts, zaps: mixZaps } });
    const k = await kiosk(page, sceneDurations);
    await page.goto(`${BASE}/`);
    await k.show('batalla');
    await page.waitForSelector('.batalla > li', { timeout: 15000 });
    await settled(page);
    assert.deepEqual(await page.evaluate(check, 'batalla'), []);
    await page.close();
  });
}

for (const [w, h] of [[1024, 434], [1280, 631], [1366, 657], [1920, 1080]]) {
  test(`Mensajes: con muchos posts, ningún hueco donde entra una caja que quedó afuera en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, zappable: true, data: { posts: mixPosts, zaps: mixZaps } });
    await kiosk(page, sceneDurations);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    assert.deepEqual(await page.evaluate(check, 'post'), []);
    await page.close();
  });
}

test('Mensajes: en una pantalla baja (915x412) la letra baja antes de dejar cajas afuera: más de 2 cajas', async () => {
  const page = await openApp(app.browser, { viewport: { width: 915, height: 412 }, data: { posts, zaps } });
  await kiosk(page, sceneDurations);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.scene-post .post-row');
  await settled(page);
  assert.deepEqual(await page.evaluate(check, 'post'), []);
  const n = await page.evaluate(() => document.querySelectorAll('.post-list .post-row').length);
  assert.ok(n > 2, `sólo ${n} cajas`);
  await page.close();
});

for (const [w, h] of [[1920, 1080], [1280, 631]]) {
  test(`Mensajes: masonry (cajas del alto de su contenido, sin huecos ni solapes, en orden) y letra cómoda en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, data: { posts, zaps } });
    await kiosk(page, sceneDurations);
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    const r = await page.evaluate(() => {
      const list = document.querySelector('.post-list'), gap = parseFloat(getComputedStyle(list).rowGap);
      const boxes = [...list.querySelectorAll('.post-row')].map((b) => ({ x: b.offsetLeft, y: b.offsetTop, w: b.offsetWidth, h: b.offsetHeight, content: b.querySelector('.row-main').offsetHeight + parseFloat(getComputedStyle(b).paddingTop) + parseFloat(getComputedStyle(b).paddingBottom) + 2, long: b.classList.contains('is-long'), text: b.textContent.trim().slice(0, 30) }));
      return { boxes, gap, font: parseFloat(list.style.fontSize), floor: Number(list.dataset.floor) };
    });
    assert.ok(r.font >= r.floor, JSON.stringify(r));
    assert.ok(r.boxes.some((b) => b.long), 'sin cajas agrandadas para probar');
    // a short box is as tall as its content: no empty space inside
    assert.deepEqual(r.boxes.filter((b) => Math.abs(b.h - b.content) > 2).map((b) => `${b.text}: ${b.h} vs ${b.content}`), []);
    // no overlaps (layout spots)
    const hit = (a, b) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    assert.deepEqual(r.boxes.flatMap((a, i) => r.boxes.slice(i + 1).filter((b) => hit(a, b)).map((b) => `${a.text} × ${b.text}`)), []);
    // no holes: in each column the next box starts one gap below the previous one
    const cols = [...new Set(r.boxes.map((b) => b.x))];
    for (const x of cols) {
      const col = r.boxes.filter((b) => b.x === x).sort((a, b) => a.y - b.y);
      for (let i = 1; i < col.length; i++) assert.ok(Math.abs(col[i].y - (col[i - 1].y + col[i - 1].h + r.gap)) <= 1.5, JSON.stringify(col));
    }
    // the order: shrink → grow → truncate. A grown box never holds a message that fit a normal box at the minimum font.
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
    // reading order: each box starts at or below the previous one (same top: to its right), in message order
    const order = r.boxes.map((b) => [b.y, b.x]);
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
    for (const [scene, expected] of [['post', 'Todavía no hay posts con #lacrypta'], ['batalla', 'Todavía no hay zaps']]) { // no announcement: its scene is skipped
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

for (const [w, h] of [[915, 412], [1280, 720], [1920, 1080]]) {
  test(`Mensajes: pocos mensajes llenan la pantalla (medidas relativas) en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, data: { posts: five, zaps: fiveZaps } });
    await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 });
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    const r = await page.evaluate(() => {
      const ul = document.querySelector('.post-list').getBoundingClientRect(), rows = [...document.querySelectorAll('.post-row')].map((b) => b.getBoundingClientRect());
      const qb = document.querySelector('figure.qr').getBoundingClientRect(), q = qb.width ? qb : { left: ul.right }; // up to the QR's lane, or the list's edge if hidden
      const top = Math.min(...rows.map((b) => b.top)), bottom = Math.max(...rows.map((b) => b.bottom));
      const left = Math.min(...rows.map((b) => b.left)), right = Math.min(q.left, Math.max(...rows.map((b) => b.right)));
      return { h: (bottom - top) / ul.height, w: (right - left) / (q.left - ul.left) };
    });
    assert.ok(r.h >= 0.7, `las cajas ocupan sólo ${Math.round(r.h * 100)}% del alto`);
    assert.ok(r.w >= 0.85, `las cajas ocupan sólo ${Math.round(r.w * 100)}% del ancho`);
    await page.close();
  });
}

// A phone in landscape mirrored onto a TV: its CSS px are big on screen, so the legible floor scales with the height (like the PC's).
for (const [w, h] of [[915, 412], [800, 360], [851, 393], [932, 430], [915, 350]]) {
  test(`Mensajes: un celular apaisado muestra casi tantos mensajes como la PC (1366x768) en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, dpr: 3, zappable: true, data: { posts: mixPosts, zaps: mixZaps } });
    await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 });
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    const n = await page.evaluate(() => document.querySelectorAll('.post-list > .post-row').length);
    assert.ok(n >= 10, `sólo ${n} mensajes`);
    assert.deepEqual(await page.evaluate(check, 'post'), []);
    await page.close();
  });
}

for (const [w, h] of [[1920, 1080], [915, 412]]) {
  test(`firma «totemcillo fue hecho con 💚 por Fierillo» pegada a la esquina inferior derecha, chica, sin pisar nada, en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, zappable: true, data: { posts: mixPosts, zaps: mixZaps } });
    await kiosk(page, { post: 60000, batalla: 60000, anuncio: 60000 });
    await page.goto(`${BASE}/`);
    await page.waitForSelector('.scene-post .post-row');
    await settled(page);
    const r = await page.evaluate(() => {
      const f = document.querySelector('.firma'), a = f?.querySelector('a[href="https://github.com/Fierillo"]');
      if (!f || !a) return { missing: true };
      const b = f.getBoundingClientRect(), hit = (e) => { const o = e.getBoundingClientRect(); return o.width && b.right > o.left && b.left < o.right && b.bottom > o.top && b.top < o.bottom; };
      const others = [...document.querySelectorAll('figure.qr, .post-row, .fs-toggle, .repo-link, #live-strip > *')].filter(hit).map((e) => e.className || e.tagName);
      return { text: f.textContent.replace(/\s+/g, ' ').trim(), href: a.href, label: a.textContent.trim(), target: a.target, rel: a.rel, others,
        right: innerWidth - b.right, bottom: innerHeight - b.bottom, center: b.left > innerWidth / 2, ratio: parseFloat(getComputedStyle(f).fontSize) / parseFloat(getComputedStyle(f.closest('.footer')).fontSize) };
    });
    assert.equal(r.missing, undefined, 'falta la firma');
    assert.equal(r.text, 'totemcillo fue hecho con 💚 por Fierillo');
    assert.deepEqual([r.href, r.label, r.target], ['https://github.com/Fierillo', 'Fierillo', '_blank']);
    assert.match(r.rel, /noopener/);
    assert.deepEqual(r.others, []);
    assert.ok(r.center && r.bottom < h * 0.06, `no está abajo a la derecha: ${JSON.stringify(r)}`);
    assert.ok(r.right < 44 && r.bottom < Math.max(6, h * 0.012), `no está pegada a la esquina: ${JSON.stringify(r)}`);
    assert.ok(r.ratio <= 0.57, `letra de la firma no achicada: ${JSON.stringify(r)}`);
    await page.screenshot({ path: `/workspace/totemcillo-firma3-${w}x${h}.png` });
    await page.close();
  });
}

// Batalla on a phone in landscape (mirrored onto a TV): bars scale with the height like the PC's, not a fixed px minimum.
const batallaPosts = Array.from({ length: 20 }, (_, i) => ({ id: hex(900 + i), pubkey: AUTHOR, content: `Mensaje de la batalla número ${i + 1} con #lacrypta`, created_at: now - 100 - i }));
const batallaZaps = batallaPosts.map((p, i) => ({ id: hex(1900 + i), postId: p.id, sender: 'cd'.repeat(32), msats: (30 - i) * 1000, domain: 'getalby.com', comment: '', created_at: now - 30 - i }));
for (const [w, h] of [[915, 412], [800, 360], [851, 393]]) {
  test(`Batalla: un celular apaisado muestra casi tantos puestos como la PC (1366x768) en ${w}x${h}`, async () => {
    const page = await openApp(app.browser, { viewport: { width: w, height: h }, dpr: 3, zappable: true, data: { posts: batallaPosts, zaps: batallaZaps } });
    const k = await kiosk(page, { post: 60000, batalla: 60000 });
    await page.goto(`${BASE}/`);
    await k.show('batalla');
    await page.waitForSelector('.batalla > li', { timeout: 15000 });
    await settled(page);
    const n = await page.evaluate(() => document.querySelectorAll('.batalla > li').length);
    assert.ok(n >= 8, `sólo ${n} puestos`);
    assert.deepEqual(await page.evaluate(check, 'batalla'), []);
    await page.screenshot({ path: `${out}/${w}x${h}-batalla-phone.png` });
    await page.close();
  });
}

// An author whose profile hasn't loaded yet but cached as zappable: the name's skeleton stays inline, so the bar still shows the message (not just "…").
test('Batalla: con el perfil del autor cargando, la barra muestra el mensaje', async () => {
  const stranger = 'cd'.repeat(32), p = { id: hex(990), pubkey: stranger, content: 'Mensaje de un autor sin perfil todavía #lacrypta', created_at: now - 100 };
  const page = await openApp(app.browser, { viewport: { width: 1920, height: 1080 }, data: { posts: [p], zaps: [{ id: hex(1990), postId: p.id, sender: 'ef'.repeat(32), msats: 21_000, domain: 'getalby.com', comment: '', created_at: now - 30 }] } });
  await page.addInitScript(([k, pk]) => localStorage.setItem(k, JSON.stringify({ [pk]: [1, Date.now(), 0] })), ['totemcillo:canzap:v1', stranger]);
  await kiosk(page, { post: 0, batalla: 60000, anuncio: 0 });
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.batalla > li');
  await settled(page);
  const r = await page.evaluate(() => ({ text: document.querySelector('.bar-text').textContent, skel: !!document.querySelector('.bar-label .skel') }));
  assert.ok(r.skel, 'el perfil ya cargó: el test no prueba el esqueleto');
  assert.equal(r.text, 'Mensaje de un autor sin perfil todavía #lacrypta');
  await page.close();
});

for (const [w, h, H] of [[1920, 969, 1080], [1920, 947, 1080], [1280, 631, 720]]) test(`Mensajes: pantalla completa (${w}x${H}) muestra al menos tantas cajas como la ventana (${w}x${h}), al pasar a pantalla completa`, async () => {
  const many = Array.from({ length: 24 }, (_, i) => ({ ...posts[i % posts.length], id: hex(900 + i), created_at: posts[i % posts.length].created_at - i }));
  const page = await openApp(app.browser, { viewport: { width: w, height: h }, zappable: true, data: { posts: many, zaps } });
  await kiosk(page, sceneDurations);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.scene-post .post-row');
  await settled(page);
  const count = () => page.evaluate(() => document.querySelectorAll('.post-list > .post-row').length);
  const windowed = await count();
  await page.setViewportSize({ width: w, height: H }); // entering fullscreen: a resize to the whole screen
  await page.waitForTimeout(400);
  await settled(page);
  const full = await count();
  assert.ok(full >= windowed, `pantalla completa ${full} < ventana ${windowed}`);
  await page.close();
});

test('con el QR oculto las cajas usan su zona (más cajas que con QR) en 1920x1080', async () => {
  const page = await openApp(app.browser, { viewport: { width: 1920, height: 1080 }, zappable: true, data: { posts: mixPosts, zaps: mixZaps } });
  await kiosk(page, sceneDurations);
  await page.goto(`${BASE}/`);
  await page.waitForSelector('.scene-post .post-row');
  await settled(page);
  const placed = () => page.evaluate(() => document.querySelectorAll('.post-list > .post-row:not([hidden]):not([data-out])').length);
  const hidden = await placed();
  assert.equal(await page.evaluate(() => document.querySelector('figure.qr').getBoundingClientRect().width), 0, 'el QR de la TV debería estar oculto');
  await page.evaluate(() => { document.querySelector('.qr-box').classList.remove('qr-off'); dispatchEvent(new Event('resize')); });
  await settled(page);
  const shown = await placed();
  console.log(`cajas 1920x1080: QR oculto ${hidden}, QR visible ${shown}`);
  assert.ok(hidden > shown, `QR oculto ${hidden} cajas, visible ${shown}`);
  await page.close();
});
