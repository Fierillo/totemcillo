// Chequeo e2e de layout: nada se superpone ni desborda en 3 viewports. Uso: pnpm test:e2e
import { preview } from 'vite';
import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';

const out = process.env.SHOTS ?? 'shots';
mkdirSync(out, { recursive: true });
const server = await preview({ preview: { port: 4179, strictPort: true }, logLevel: 'silent' });
const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/usr/bin/google-chrome', args: ['--no-sandbox'] });

const now = Math.floor(Date.now() / 1000);
const hex = (n) => n.toString(16).padStart(64, '0');
const lorem = 'Bitcoin Lightning Nostr zap La Crypta LABITCONF comunidad Buenos Aires soberanía código abierto descentralización '.split(' ');
let long = '';
for (let i = 0; long.length < 1880; i++) long += lorem[i % lorem.length] + (i % 17 === 16 ? '\n' : ' ');
long += ' https://ejemplo.com/' + 'x'.repeat(100);
long = long.slice(0, 2000);
const posts = [
  { id: hex(1), pubkey: 'ab'.repeat(32), content: long, created_at: now - 60 },
  { id: hex(2), pubkey: 'ab'.repeat(32), content: 'POST VIEJO fuera de la ventana de 24 h', created_at: now - 25 * 3600 },
];
const zaps = Array.from({ length: 40 }, (_, i) => ({
  id: hex(100 + i), postId: hex(1), sender: 'cd'.repeat(32), msats: (i + 1) * 21_000_000,
  comment: 'Comentario larguísimo de prueba para el tótem '.repeat(6).slice(0, 280), created_at: now - i * 10,
}));
zaps.push({ id: hex(999), postId: hex(2), sender: 'cd'.repeat(32), msats: 1e12, comment: 'zap a post viejo', created_at: now - 25 * 3600 });
const cfg = { relays: [], hashtags: ['lacrypta', 'labitconf'], sceneDurations: { post: 3000, latestZaps: 3000, top10Historico: 3000, top10Ultimas3h: 60000 } , talks: [], announcement: '', noteUriTemplate: 'https://njump.me/{nevent}' };

function check(scene) {
  const P = [];
  const q = (s) => document.querySelector(s);
  const R = (el) => el.getBoundingClientRect();
  const VP = { getBoundingClientRect: () => new DOMRect(0, 0, innerWidth, innerHeight) };
  const need = (s) => { const el = q(s); if (!el) P.push(`falta ${s}`); return el; };
  const inside = (name, a, b) => {
    if (!a || !b) return;
    const A = R(a), B = R(b);
    if (A.left < B.left - 1 || A.top < B.top - 1 || A.right > B.right + 1 || A.bottom > B.bottom + 1) P.push(`${name} se sale de su región`);
  };
  const disjoint = (items) => {
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const [ni, a] = items[i], [nj, b] = items[j];
      if (!a || !b) continue;
      const A = R(a), B = R(b);
      if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) P.push(`${ni} se superpone con ${nj}`);
    }
  };
  const noOverflow = (name, el) => {
    if (el && (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1))
      P.push(`${name} desborda (${el.scrollWidth}x${el.scrollHeight} > ${el.clientWidth}x${el.clientHeight})`);
  };
  const itemsInside = (name, ul) => ul && [...ul.children].forEach((li, i) => inside(`${name} item ${i}`, li, ul));

  const top = need('.topbar'), main = need('#scene'), foot = need('.footer');
  disjoint([['topbar', top], ['escena', main], ['footer', foot]]);
  [['topbar', top], ['escena', main], ['footer', foot]].forEach(([n, el]) => inside(n, el, VP));
  if (scene === 'post') {
    const cards = [...document.querySelectorAll('.card')];
    if (!cards.length) P.push('no hay tarjetas de posts');
    cards.forEach((c, i) => inside(`tarjeta ${i}`, c, main));
    disjoint(cards.map((c, i) => [`tarjeta ${i}`, c]));
    if (document.querySelectorAll('figure.qr').length !== 1) P.push('tiene que haber exactamente un QR');
    cards.forEach((card, i) => {
      const g = (s) => { const el = card.querySelector(s); if (!el) P.push(`tarjeta ${i}: falta ${s}`); return el; };
      const head = g('.card-head'), body = g('.card-body'), zl = g('.card-zaps'), total = g('.card-total'), content = g('.card-content'), author = g('.author');
      [['cabecera', head], ['cuerpo', body], ['zaps', zl], ['total', total]].forEach(([n, el]) => inside(`tarjeta ${i} ${n}`, el, card));
      disjoint([[`t${i} cabecera`, head], [`t${i} cuerpo`, body], [`t${i} zaps`, zl], [`t${i} total`, total]]);
      inside(`tarjeta ${i} texto`, content, body);
      const qr = card.querySelector('.qr');
      if (qr) { inside(`tarjeta ${i} QR`, qr, body); disjoint([[`t${i} texto`, content], [`t${i} QR`, qr]]); if (qr.getBoundingClientRect().width < 120) P.push(`QR demasiado chico (${qr.getBoundingClientRect().width}px)`); }
      const chars = content ? [...new Intl.Segmenter().segment(content.textContent)].length : 0;
      if (chars > 210) P.push(`tarjeta ${i}: texto con ${chars} caracteres (> 210)`);
      if (content?.textContent.includes('POST VIEJO')) P.push('muestra un post fuera de la ventana de 24 h');
      if (content && parseFloat(content.style.fontSize) < 11) P.push(`tarjeta ${i}: texto ilegible (${content.style.fontSize})`);
      noOverflow(`t${i} texto`, content); noOverflow(`t${i} autor`, author); noOverflow(`t${i} zaps`, zl); noOverflow(`t${i} total`, total);
      itemsInside(`t${i} zap`, zl);
    });
  } else if (scene.startsWith('top')) {
    const h1 = need('h1.top-title'), ol = need('.top-list');
    const expected = scene === 'top10Historico' ? 'Top 10 histórico' : 'Top 10 · últimas 3 horas';
    if (h1 && h1.textContent !== expected) P.push(`título "${h1.textContent}" != "${expected}"`);
    if (h1 && (parseFloat(getComputedStyle(h1).fontSize) < 24 || R(h1).height < 20)) P.push(`título demasiado chico (${getComputedStyle(h1).fontSize}, alto ${R(h1).height}, scroll ${h1.scrollWidth}x${h1.scrollHeight} client ${h1.clientWidth}x${h1.clientHeight})`);
    inside('título', h1, main); inside('ranking', ol, main); disjoint([['título', h1], ['ranking', ol]]);
    noOverflow('título', h1); noOverflow('ranking', ol); itemsInside('fila', ol);
    if (ol && !ol.children.length) P.push('ranking vacío');
    if (ol && /POST VIEJO|post no disponible|1\.000\.000\.000/.test(ol.textContent)) P.push('el ranking incluye un post vencido o un zap huérfano');
  } else {
    const h1 = need('h1'), ul = need('.zap-list');
    inside('título', h1, main); inside('lista', ul, main); disjoint([['título', h1], ['lista', ul]]);
    noOverflow('lista de últimos zaps', ul); itemsInside('último zap', ul);
    if (ul && !ul.children.length) P.push('lista vacía');
  }
  document.querySelectorAll('.amount, .rank, .total, .card-total').forEach((el, i) => {
    if (el.scrollWidth > el.clientWidth + 1) P.push(`monto/rank recortado #${i}: "${el.textContent.trim()}"`);
  });
  return P;
}

function checkEmpty([scene, expected]) {
  const P = [];
  const R = (el) => el.getBoundingClientRect();
  const main = document.getElementById('scene');
  if (main.className !== `scene scene-${scene}`) P.push(`escena actual "${main.className}"`);
  const inside = (name, el) => { const A = R(el), B = R(main); if (A.left < B.left - 1 || A.top < B.top - 1 || A.right > B.right + 1 || A.bottom > B.bottom + 1) P.push(`${name} se sale de la escena`); };
  const noOverflow = (name, el) => { if (el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1) P.push(`${name} desborda`); };
  const msg = main.querySelector('.empty-msg');
  if (!msg) { P.push('falta el mensaje de estado vacío'); return P; }
  if (msg.textContent !== expected) P.push(`mensaje "${msg.textContent}"`);
  if (parseFloat(getComputedStyle(msg).fontSize) < 16) P.push('mensaje demasiado chico');
  inside('mensaje', msg); noOverflow('mensaje', msg);
  const h1 = main.querySelector('h1');
  if (h1) {
    inside('título', h1); noOverflow('título', h1);
    const A = R(h1), B = R(msg);
    if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) P.push('título se superpone con el mensaje');
  }
  return P;
}

const problems = [];
const viewports = [[1280, 720], [1920, 1080], [1080, 1920]];
try {
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route('**/config.json', (r) => r.fulfill({ json: cfg }));
    await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts, zaps }));
    await page.goto('http://localhost:4179/');
    for (const scene of ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h']) {
      await page.waitForSelector(`.scene-${scene}`, { timeout: 15000 });
      await page.waitForTimeout(1200);
      problems.push(...(await page.evaluate(check, scene)).map((p) => `${w}x${h} ${scene}: ${p}`));
      await page.screenshot({ path: `${out}/${w}x${h}-${scene}.png` });
    }
    await page.close();
  }
  // Navegación con teclado (activable por config)
  for (const keyboardNav of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, keyboardNav, sceneDurations: { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000 } } }));
    await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts, zaps }));
    await page.goto('http://localhost:4179/');
    await page.waitForSelector('.scene-post');
    const scene = () => page.evaluate(() => document.getElementById('scene').className);
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(300);
    const afterRight = await scene();
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(300);
    const afterLefts = await scene();
    if (keyboardNav && (afterRight !== 'scene scene-latestZaps' || afterLefts !== 'scene scene-top10Ultimas3h'))
      problems.push(`teclado: → dio "${afterRight}", ←← dio "${afterLefts}"`);
    if (!keyboardNav && (afterRight !== 'scene scene-post' || afterLefts !== 'scene scene-post'))
      problems.push(`teclado desactivado pero cambió de escena: "${afterRight}" / "${afterLefts}"`);
    await page.close();
  }
  // Zaps reales con comentarios: se ven ≥5 mensajes y los comentarios cortos no se recortan
  const comments = ['¡Grande La Crypta! 🧡', 'Vamos LABITCONF ⚡⚡', 'Excelente charla, gracias', 'pura vida', 'Zap desde Córdoba', '🔥🔥🔥', 'Nos vemos en el stand', 'Lightning > todo'];
  const realPost = [{ id: hex(1), pubkey: 'ab'.repeat(32), content: 'Probando #lacrypta con un texto normal de un post', created_at: now - 600 }];
  const realZaps = comments.map((c, i) => ({ id: hex(500 + i), postId: hex(1), sender: (i + 1).toString().repeat(64), msats: (i + 1) * 21000, comment: c, created_at: now - i * 30 }));
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, sceneDurations: { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000 } } }));
    await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts: realPost, zaps: realZaps }));
    await page.goto('http://localhost:4179/');
    for (const scene of ['post', 'latestZaps']) {
      await page.waitForTimeout(1200);
      if (scene === 'post') {
        const n = await page.evaluate(() => document.querySelectorAll('.card-zaps li').length);
        if (n < 3) problems.push(`${w}x${h} 8 zaps post: sólo ${n} zaps en la tarjeta`);
        await page.screenshot({ path: `${out}/${w}x${h}-8zaps-${scene}.png` });
        await page.keyboard.press('ArrowRight');
        continue;
      }
      const r = await page.evaluate(() => {
        const ul = document.querySelector('#scene ul');
        const clipped = [...document.querySelectorAll('#scene [data-clip]')].filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim().slice(0, 40));
        return { items: ul ? ul.children.length : 0, font: ul ? parseFloat(ul.style.fontSize) : 0, clipped, vh: innerHeight };
      });
      if (r.items < 5) problems.push(`${w}x${h} 8 zaps ${scene}: sólo ${r.items} mensajes visibles`);
      if (r.font > r.vh * 0.032 + 1) problems.push(`${w}x${h} 8 zaps ${scene}: fuente de lista ${r.font}px > 3.2vh`);
      if (r.clipped.length) problems.push(`${w}x${h} 8 zaps ${scene}: mensajes recortados: ${r.clipped.join(' | ')}`);
      await page.screenshot({ path: `${out}/${w}x${h}-8zaps-${scene}.png` });
      await page.keyboard.press('ArrowRight');
    }
    await page.close();
  }

  // 5 posts: se ven ≥3 a la vez y navegar con flechas muestra siempre lo mismo
  const five = Array.from({ length: 5 }, (_, i) => ({ id: hex(700 + i), pubkey: (i + 1).toString().repeat(64), content: `Post número ${i + 1} sobre #lacrypta y la LABITCONF, con un texto de largo normal para ver cómo entra`, created_at: now - (i + 1) * 300 }));
  const fiveZaps = five.flatMap((p, i) => Array.from({ length: i + 1 }, (_, j) => ({ id: hex(800 + i * 10 + j), postId: p.id, sender: (j + 1).toString().repeat(64), msats: (j + 1) * 21000, comment: comments[j], created_at: now - j * 20 })));
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, keyboardNav: true, sceneDurations: { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000 } } }));
    await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts: five, zaps: fiveZaps }));
    await page.goto('http://localhost:4179/');
    await page.waitForSelector('.scene-post .card');
    await page.waitForTimeout(1200);
    const sig = () => page.evaluate(() => {
      const main = document.getElementById('scene').getBoundingClientRect();
      const cards = [...document.querySelectorAll('.card')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 50 && r.height > 50 && r.top >= main.top - 1 && r.bottom <= main.bottom + 1; });
      return { cls: document.getElementById('scene').className, visible: cards.length, text: cards.map((c) => c.querySelector('.card-content').textContent + '|' + c.querySelector('.card-total').textContent).join('\n') };
    });
    problems.push(...(await page.evaluate(check, 'post')).map((p) => `${w}x${h} 5 posts: ${p}`));
    const first = await sig();
    if (first.visible < 3) problems.push(`${w}x${h} 5 posts: sólo ${first.visible} posts visibles a la vez`);
    await page.screenshot({ path: `${out}/${w}x${h}-5posts-post.png` });
    for (const keys of [['ArrowRight', 'ArrowRight', 'ArrowRight', 'ArrowRight'], ['ArrowLeft', 'ArrowRight'], ['ArrowRight', 'ArrowLeft']]) {
      for (const k of keys) { await page.keyboard.press(k); await page.waitForTimeout(150); }
      await page.waitForTimeout(600);
      const again = await sig();
      if (again.cls !== 'scene scene-post' || again.text !== first.text) problems.push(`${w}x${h} 5 posts: tras ${keys.join(',')} cambió el contenido (${again.cls})`);
    }
    await page.close();
  }

  // Estados vacíos: store vacío, se recorren todas las escenas con →
  const empties = [
    ['post', 'Todavía no hay posts con #lacrypta / #labitconf'],
    ['latestZaps', 'Todavía no hay zaps'],
    ['top10Historico', 'Todavía no hay zaps en este período'],
    ['top10Ultimas3h', 'Todavía no hay zaps en este período'],
  ];
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, keyboardNav: true, sceneDurations: { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000 } } }));
    await page.goto('http://localhost:4179/');
    await page.waitForTimeout(800);
    for (const [scene, expected] of empties) {
      await page.waitForTimeout(700);
      problems.push(...(await page.evaluate(checkEmpty, [scene, expected])).map((p) => `${w}x${h} vacío ${scene}: ${p}`));
      await page.screenshot({ path: `${out}/${w}x${h}-empty-${scene}.png` });
      await page.keyboard.press('ArrowRight');
    }
    await page.close();
  }
} finally {
  await browser.close();
  server.httpServer.close();
}
if (problems.length) {
  console.error('PROBLEMAS DE LAYOUT:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Layout OK en ${viewports.map((v) => v.join('x')).join(', ')}. Capturas en ${out}`);
