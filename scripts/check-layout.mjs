// E2E layout check: nothing overlaps or overflows in 3 viewports. Usage: pnpm test:e2e
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
  id: hex(100 + i), postId: hex(1), sender: 'cd'.repeat(32), msats: (i + 1) * 21_000_000, domain: 'getalby.com',
  comment: 'Comentario larguísimo de prueba para el tótem '.repeat(6).slice(0, 280), created_at: now - i * 10,
}));
zaps.push({ id: hex(999), postId: hex(2), sender: 'cd'.repeat(32), msats: 1e12, domain: 'getalby.com', comment: 'zap a post viejo', created_at: now - 25 * 3600 });
const cfg = { relays: [], hashtags: ['lacrypta', 'labitconf'] };
const sceneDurations = { post: 3000, latestZaps: 3000, top10Historico: 3000, top10Ultimas3h: 60000, anuncio: 3000 };


// The totem follows the server schedule (/api/kiosk + /api/version), not local timers or keys.
// `kiosk(page, durations, extra)` serves a stubbed schedule; `show(scene)` re-anchors `epoch` so that
// scene is on air right now and reloads the page (the totem computes the scene from epoch + server time).
const ORDER = ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio', 'video'];
const START_LINE = new Date((now - 24 * 3600) * 1000).toISOString(); // older fixtures fall before the start line
async function kiosk(page, sceneDurations, extra = {}) {
  const base = await (await fetch('http://localhost:4179/api/kiosk')).json();
  const st = { ...base, startLine: START_LINE, ...extra, sceneDurations, epoch: Date.now(), version: 1 };
  await page.route('**/api/kiosk*', (r) => r.fulfill({ json: st }));
  await page.route('**/api/version*', (r) => r.fulfill({ json: { version: st.version } }));
  const durs = { post: 21000, latestZaps: 21000, top10Historico: 21000, top10Ultimas3h: 21000, anuncio: 21000, ...sceneDurations };
  return {
    async show(scene, reload = true) {
      const i = ORDER.indexOf(scene);
      st.epoch = Date.now() - ORDER.slice(0, i).reduce((a, n) => a + durs[n], 0) - 200;
      if (reload) { await page.reload(); await page.waitForSelector(`.scene-${scene}`, { timeout: 15000 }); }
    },
  };
}

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

  const top = need('.topbar'), main = need('#scene');
  disjoint([['topbar', top], ['escena', main]]);
  [['topbar', top], ['escena', main]].forEach(([n, el]) => inside(n, el, VP));
  if (scene === 'post') {
    const list = need('ul.post-list'), qr = need('figure.qr');
    inside('lista', list, main); inside('QR', qr, main);
    if (qr && qr.getBoundingClientRect().width < 120) P.push(`QR demasiado chico (${qr.getBoundingClientRect().width}px)`);
    if (qr && !/Escaneá.*celular|Abrí.*celular|Escaneá y abrí/i.test(qr.textContent)) P.push('QR sin leyenda para el celular');
    const rows = [...document.querySelectorAll('.post-row')];
    if (!rows.length) P.push('no hay filas de posts');
    rows.forEach((row, i) => {
      inside(`fila ${i}`, row, list);
      disjoint([[`fila ${i}`, row], ['QR', qr]]);
      for (const sel of ['.author', '.ago', '.excerpt', '.row-total']) if (!row.querySelector(sel)) P.push(`fila ${i}: falta ${sel}`);
      if (row.querySelector('.row-zaps')) P.push(`fila ${i}: muestra mensajes de zaps`);
      const excerpt = row.querySelector('.excerpt');
      const chars = excerpt ? [...new Intl.Segmenter().segment(excerpt.textContent)].length : 0;
      if (chars > 210) P.push(`fila ${i}: extracto con ${chars} caracteres (> 210)`);
      if (excerpt?.textContent.includes('POST VIEJO')) P.push('muestra un post fuera de la ventana de 24 h');
      noOverflow(`fila ${i} extracto`, excerpt);
    });
    noOverflow('lista de posts', list);
  } else if (scene.startsWith('top')) {
    const h1 = need('h1.top-title'), ol = need('.top-list');
    const expected = scene === 'top10Historico' ? 'Top 10 zaps · histórico' : 'Top 10 zaps · últimas 3 horas';
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
  const qr = document.querySelector('figure.qr');
  if (qr) {
    for (const row of document.querySelectorAll('.post-row, .zap-list > li, .top-list > li')) {
      disjoint([['fila', row], ['QR', qr]]);
      const parent = row.parentElement;
      const edge = R(parent).right - parseFloat(getComputedStyle(parent).paddingRight);
      const gap = parseFloat(getComputedStyle(main).fontSize);
      if (R(row).bottom < R(qr).top - gap - 1 && R(row).right < edge - 2) P.push('fila superior restringida por una columna invisible del QR');
    }
  }
  document.querySelectorAll('.amount, .rank, .total, .row-total').forEach((el, i) => {
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
  if (scene === 'anuncio' && Math.abs((R(msg).left + R(msg).right) / 2 - innerWidth / 2) > 2) P.push('anuncio descentrado horizontalmente');
  if (scene === 'anuncio' && Math.abs((R(msg).top + R(msg).bottom - R(main).top - R(main).bottom) / 2) > 2) P.push('anuncio descentrado verticalmente');
  const h1 = main.querySelector('h1');
  if (h1) {
    inside('título', h1); noOverflow('título', h1);
    const A = R(h1), B = R(msg);
    if (A.left < B.right - 1 && B.left < A.right - 1 && A.top < B.bottom - 1 && B.top < A.bottom - 1) P.push('título se superpone con el mensaje');
  }
  return P;
}

// Check rendered geometry and loaded assets, not the spelling/order of CSS declarations.
function checkHeader() {
  const problems = [], header = document.querySelector('.topbar');
  const logo = header?.querySelector('img'), cta = header?.querySelector('.cta');
  if (!header || !logo || !cta) return ['falta header, logo o invitación a publicar'];
  if (!logo.complete || !logo.naturalWidth || logo.alt !== 'La Crypta') problems.push('logo sin cargar o sin texto alternativo');
  if (!/Nostr/.test(cta.textContent) || !['#lacrypta', '#labitconf'].every((tag) => cta.textContent.includes(tag))) problems.push('faltan instrucciones de publicación');
  const h = header.getBoundingClientRect(), l = logo.getBoundingClientRect(), c = cta.getBoundingClientRect();
  for (const r of [l, c]) if (r.left < h.left - 1 || r.right > h.right + 1 || r.top < h.top - 1 || r.bottom > h.bottom + 1) problems.push('contenido fuera del header');
  if (l.right > c.left + 1 && l.bottom > c.top + 1 && l.top < c.bottom - 1) problems.push('logo e instrucciones superpuestos');
  if (logo.naturalHeight && Math.abs(l.width / l.height - logo.naturalWidth / logo.naturalHeight) > 0.1) problems.push('logo deformado');
  return problems;
}

function checkRepoLink() {
  const link = document.querySelector('a.repo-link');
  if (!link) return ['falta el enlace al repo'];
  const problems = [];
  if (link.href !== 'https://github.com/Fierillo/totemcillo' || !link.getAttribute('aria-label')) problems.push('enlace incorrecto o sin nombre accesible');
  if (!link.querySelector('svg') || link.textContent.trim()) problems.push('debe mostrar solo el ícono de GitHub');
  const footer = document.querySelector('footer');
  if (!footer || !footer.contains(link)) problems.push('falta la banda inferior con el enlace');
  if (footer) {
    const f = footer.getBoundingClientRect(), main = document.querySelector('#scene').getBoundingClientRect();
    if (f.top < main.bottom - 1 || f.bottom > innerHeight + 1) problems.push('banda inferior superpuesta o fuera de pantalla');
  }
  const r = link.getBoundingClientRect();
  if (r.width < 16 || r.width > 36 || r.height < 16 || r.height > 36) problems.push('ícono no es pequeño');
  if (Math.abs((r.left + r.right) / 2 - innerWidth / 2) > 1 || r.bottom > innerHeight || innerHeight - r.bottom > 24) problems.push('enlace fuera del centro inferior');
  return problems;
}

const problems = [];
const viewports = [[1280, 720], [1920, 1080], [1080, 1920]];
try {
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const k = await kiosk(page, sceneDurations);
    await page.route('**/config.json', (r) => r.fulfill({ json: cfg }));
    await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts, zaps }));
    await page.goto('http://localhost:4179/');
    for (const scene of ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h']) {
      await k.show(scene);
      await page.waitForTimeout(1200);
      problems.push(...(await page.evaluate(check, scene)).map((p) => `${w}x${h} ${scene}: ${p}`));
      problems.push(...(await page.evaluate(checkRepoLink)).map((p) => `${w}x${h} ${scene}: ${p}`));
      if (scene === 'post') problems.push(...(await page.evaluate(checkHeader)).map((p) => `${w}x${h} header: ${p}`));
      await page.screenshot({ path: `${out}/${w}x${h}-${scene}.png` });
    }
    await k.show('video');
    problems.push(...(await page.evaluate(checkRepoLink)).map((p) => `${w}x${h} video: ${p}`));
    await page.screenshot({ path: `${out}/${w}x${h}-video.png` });
    await page.close();
  }
  // Real zaps with comments: ≥5 messages visible and short comments are not clipped
  const comments = ['¡Grande La Crypta! 🧡', 'Vamos LABITCONF ⚡⚡', 'Excelente charla, gracias', 'pura vida', 'Zap desde Córdoba', '🔥🔥🔥', 'Nos vemos en el stand', 'Lightning > todo'];
  const realPost = [{ id: hex(1), pubkey: 'ab'.repeat(32), content: 'Probando #lacrypta con un texto normal de un post', created_at: now - 600 }];
  const realZaps = comments.map((c, i) => ({ id: hex(500 + i), postId: hex(1), sender: (i + 1).toString().repeat(64), msats: (i + 1) * 21000, comment: c, created_at: now - i * 30, domain: 'getalby.com' }));
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const k = await kiosk(page, { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000 });
    await page.route('**/config.json', (r) => r.fulfill({ json: cfg }));
    await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts: realPost, zaps: realZaps }));
    await page.goto('http://localhost:4179/');
    for (const scene of ['post', 'latestZaps']) {
      await page.waitForTimeout(1200);
      if (scene === 'post') {
        const r = await page.evaluate(() => {
          const ul = document.querySelector('ul.post-list');
          const clipped = [...document.querySelectorAll('#scene [data-clip]')].filter((c) => c.scrollWidth > c.clientWidth + 1).map((c) => c.textContent.trim().slice(0, 40));
          return { items: ul ? ul.querySelectorAll('.post-row').length : 0, font: ul ? parseFloat(ul.style.fontSize) : 0, clipped, vh: innerHeight, qr: !!document.querySelector('figure.qr') };
        });
        if (r.items < 1) problems.push(`${w}x${h} 8 zaps post: sin filas`);
        if (!r.qr) problems.push(`${w}x${h} 8 zaps post: falta el QR`);
        if (r.font > r.vh * 0.032 + 1) problems.push(`${w}x${h} 8 zaps post: fuente ${r.font}px > 3.2vh`);
        await page.screenshot({ path: `${out}/${w}x${h}-8zaps-${scene}.png` });
        await k.show('latestZaps');
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
    }
    await page.close();
  }

  // 5 posts: ≥3 visible at once, a single QR, and reloading shows the same thing
  const five = Array.from({ length: 5 }, (_, i) => ({ id: hex(700 + i), pubkey: (i + 1).toString().repeat(64), content: `Post número ${i + 1} sobre #lacrypta y la LABITCONF, con un texto de largo normal para ver cómo entra`, created_at: now - (i + 1) * 300 }));
  const fiveZaps = five.flatMap((p, i) => Array.from({ length: Math.min(i + 1, 2) }, (_, j) => ({ id: hex(800 + i * 10 + j), postId: p.id, sender: (j + 1).toString().repeat(64), msats: (j + 1) * 21000, comment: comments[j], created_at: now - j * 20, domain: 'getalby.com' })));
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const k = await kiosk(page, { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000, anuncio: 60000 });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, publicUrl: 'https://totem.lacrypta.ar/' } }));
    await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts: five, zaps: fiveZaps }));
    await page.goto('http://localhost:4179/');
    await page.waitForSelector('.scene-post .post-row');
    await page.waitForTimeout(1200);
    const sig = () => page.evaluate(() => {
      const main = document.getElementById('scene').getBoundingClientRect();
      const rows = [...document.querySelectorAll('.post-row')].filter((c) => { const r = c.getBoundingClientRect(); return r.width > 50 && r.height > 30 && r.top >= main.top - 1 && r.bottom <= main.bottom + 1; });
      return { cls: document.getElementById('scene').className, visible: rows.length, qr: document.querySelectorAll('figure.qr').length, text: rows.map((c) => c.querySelector('.excerpt').textContent + '|' + c.querySelector('.row-total').textContent).join('\n') };
    });
    problems.push(...(await page.evaluate(check, 'post')).map((p) => `${w}x${h} 5 posts: ${p}`));
    const first = await sig();
    if (first.visible < 3) problems.push(`${w}x${h} 5 posts: sólo ${first.visible} posts visibles a la vez`);
    if (first.qr !== 1) problems.push(`${w}x${h} 5 posts: ${first.qr} QRs (tiene que haber 1)`);
    await page.screenshot({ path: `${out}/${w}x${h}-5posts-post.png` });
    for (let i = 0; i < 2; i++) {
      await k.show('post');
      await page.waitForTimeout(1200);
      const again = await sig();
      if (again.cls !== 'scene scene-post' || again.text !== first.text) problems.push(`${w}x${h} 5 posts: al recargar cambió el contenido (${again.cls})`);
    }
    await page.close();
  }

  // Mobile: same route, scrollable, no QR, with Zapear
  {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: true });
    const k = await kiosk(page, { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000, anuncio: 60000 });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, publicUrl: 'https://totem.lacrypta.ar/' } }));
    await page.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts: five, zaps: fiveZaps }));
    await page.goto('http://localhost:4179/');
    await page.waitForSelector('.mobile .m-post');
    await page.waitForTimeout(800);
    const m = await page.evaluate(() => ({
      qr: document.querySelectorAll('figure.qr').length,
      posts: document.querySelectorAll('.m-post').length,
      extra: document.querySelectorAll('.m-post .m-zaps').length,
      meta: document.querySelectorAll('.m-post .m-meta .author').length,
      zaps: [...document.querySelectorAll('a.zap-btn')].map((a) => a.getAttribute('href')),
      alts: [...document.querySelectorAll('a.zap-alt')].map((a) => a.getAttribute('href')),
      scroll: document.documentElement.scrollHeight > innerHeight,
      rotator: !!document.querySelector('.scene-post, .scene-latestZaps'),
    }));
    if (m.qr) problems.push(`móvil: hay ${m.qr} QRs`);
    if (m.posts < 3) problems.push(`móvil: sólo ${m.posts} posts`);
    if (m.extra) problems.push('móvil: los posts muestran mensajes de zaps');
    if (m.meta < m.posts) problems.push('móvil: falta autor/hora en los posts');
    if (m.zaps.length < 3 || m.zaps.some((h) => !h?.startsWith('nostr:nevent'))) problems.push('móvil: faltan botones Zapear nostr:');
    if (m.alts.length < 3 || m.alts.some((h) => !h?.startsWith('https://njump.me/'))) problems.push('móvil: faltan links njump');
    if (!m.scroll) problems.push('móvil: la página no scrollea');
    if (m.rotator) problems.push('móvil: sigue rotando escenas de kiosko');
    if (await page.locator('[role="tab"]').count() !== 4 || await page.locator('[role="tabpanel"]:visible').count() !== 1) problems.push('móvil: faltan pestañas o hay secciones apiladas');
    problems.push(...(await page.evaluate(checkHeader)).map((p) => `móvil header: ${p}`));
    await page.screenshot({ path: `${out}/390x844-mobile.png`, fullPage: true });
    await page.evaluate(() => window.scrollTo(0, 300));
    const tabsVisible = await page.locator('.m-tabs').evaluate((el) => {
      const r = el.getBoundingClientRect(), header = document.querySelector('.topbar').getBoundingClientRect();
      return header.top >= -1 && r.top >= header.bottom - 1 && r.bottom < innerHeight;
    });
    if (!tabsVisible) problems.push('móvil: pestañas ocultas al desplazarse');
    await page.getByRole('tab', { name: 'Zaps', exact: true }).click();
    if (!(await page.locator('[role="tabpanel"]:visible').innerText()).includes('Últimos zaps')) problems.push('móvil: no cambia a la sección de zaps');
    await page.getByRole('tab', { name: 'Posts', exact: true }).click();
    // Reduced motion must suppress movement, even if decorative glow remains.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    const movement = await page.evaluate(async () => {
      const card = document.querySelector('.m-post');
      card.classList.add('is-new', 'is-zapped');
      await new Promise((resolve) => requestAnimationFrame(resolve));
      const animations = card.getAnimations({ subtree: true });
      return animations.some((animation) => animation.effect?.getKeyframes().some((frame) => frame.transform && frame.transform !== 'none'));
    });
    if (movement) problems.push('móvil: reduced motion todavía desplaza o escala contenido');
    await page.close();
  }

  // Empty states: empty store, every scene in turn
  const empties = [
    ['post', 'Todavía no hay posts con #lacrypta / #labitconf'],
    ['latestZaps', 'Todavía no hay zaps'],
    ['top10Historico', 'Todavía no hay zaps en este período'],
    ['top10Ultimas3h', 'Todavía no hay zaps en este período'],
    ['anuncio', 'Sin anuncios por ahora'],
  ];
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const k = await kiosk(page, { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000 });
    await page.route('**/config.json', (r) => r.fulfill({ json: cfg }));
    await page.goto('http://localhost:4179/');
    await page.waitForTimeout(800);
    for (const [scene, expected] of empties) {
      await k.show(scene);
      await page.waitForTimeout(700);
      problems.push(...(await page.evaluate(checkEmpty, [scene, expected])).map((p) => `${w}x${h} vacío ${scene}: ${p}`));
      await page.screenshot({ path: `${out}/${w}x${h}-empty-${scene}.png` });
    }
    const announcement = await kiosk(page, { anuncio: 60000 }, { announcement: 'Bitcoin, Nostr y proyectos de la comunidad. '.repeat(40) });
    await announcement.show('anuncio');
    await page.waitForTimeout(700);
    const flow = await page.evaluate(() => {
      const text = document.querySelector('.anuncio-msg'), qr = document.querySelector('.qr').getBoundingClientRect();
      const box = text.getBoundingClientRect(), heading = document.querySelector('#scene h1').getBoundingClientRect(), main = document.querySelector('#scene').getBoundingClientRect();
      const range = document.createRange();
      range.selectNodeContents(text);
      const lines = [...range.getClientRects()];
      return {
        overlaps: lines.some((r) => r.right > qr.left + 1 && r.left < qr.right - 1 && r.bottom > qr.top + 1 && r.top < qr.bottom - 1),
        fullWidthAbove: lines.some((r) => r.bottom < qr.top && r.right > qr.left),
        overflow: text.scrollHeight > text.clientHeight + 1,
        outside: box.top < heading.bottom - 1 || box.bottom > main.bottom + 1,
        offCenter: Math.abs((box.top + box.bottom - main.top - main.bottom) / 2) > 2,
      };
    });
    if (flow.overlaps || flow.overflow || flow.outside || flow.offCenter || !flow.fullWidthAbove) problems.push(`${w}x${h} anuncio no fluye alrededor del QR: ${JSON.stringify(flow)}`);
    await page.screenshot({ path: `${out}/${w}x${h}-announcement-flow.png` });
    await page.close();
  }
  // Video scene: fullscreen, no loop, plays; the schedule (videoDurationSec) ends it and moves on to post
  for (const [w, h] of viewports) {
    const page = await browser.newPage({ viewport: { width: w, height: h } });
    const k = await kiosk(page, { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000, anuncio: 60000 }, { videoMode: 'full', videoDurationSec: 6 });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, videoSrc: '/video/totem-video.webm' } }));
    await page.goto('http://localhost:4179/');
    await k.show('video');
    await page.waitForSelector('.scene-video video', { timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const v = await page.evaluate(() => {
      const el = document.querySelector('.scene-video video');
      if (!el) return null;
      const r = el.getBoundingClientRect(), m = document.getElementById('scene').getBoundingClientRect();
      return { loop: el.loop || el.hasAttribute('loop'), muted: el.muted, paused: el.paused, t: el.currentTime, fit: getComputedStyle(el).objectFit, w: r.width, h: r.height, mw: m.width, mh: m.height, bg: getComputedStyle(document.getElementById('scene')).backgroundColor };
    });
    if (!v) problems.push(`${w}x${h} video: no hay <video>`);
    else {
      if (v.loop || !v.muted) problems.push(`${w}x${h} video: loop/muted ${v.loop}/${v.muted}`);
      if (v.paused || v.t <= 0 || v.t > 4) problems.push(`${w}x${h} video: no arranca desde el inicio o no se reproduce (paused ${v.paused}, t ${v.t})`);
      if (v.fit !== 'contain') problems.push(`${w}x${h} video: object-fit ${v.fit}`);
      if (Math.abs(v.w - v.mw) > 2 || Math.abs(v.h - v.mh) > 2) problems.push(`${w}x${h} video: no ocupa la escena (${v.w}x${v.h} vs ${v.mw}x${v.mh})`);
      if (v.bg !== 'rgb(0, 0, 0)') problems.push(`${w}x${h} video: fondo ${v.bg}`);
      await page.screenshot({ path: `${out}/${w}x${h}-video.png` });
      await page.waitForTimeout(6000);
      const cls = await page.evaluate(() => document.getElementById('scene').className);
      if (cls !== 'scene scene-post') problems.push(`${w}x${h} video: al terminar no pasó a la siguiente escena (${cls})`);
    }
    await page.close();
  }
  // Video every 2 cycles in the automatic rotation
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const S = { post: 400, latestZaps: 400, top10Historico: 400, top10Ultimas3h: 400, anuncio: 400 };
    await kiosk(page, S, { videoEveryCycles: 2, videoMode: 'full', videoDurationSec: 0.4 });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, videoSrc: '/video/no-existe.webm', settingsPollMs: 600000 } }));
    await page.addInitScript(() => {
      window.__seq = [];
      setInterval(() => { const c = document.getElementById('scene')?.className.replace('scene scene-', ''); if (c && c !== 'scene' && window.__seq.at(-1) !== c) window.__seq.push(c); }, 50);
    });
    await page.goto('http://localhost:4179/');
    await page.waitForTimeout(9000);
    const seq = await page.evaluate(() => window.__seq);
    const cycles = seq.join(' ').split(/(?=post)/).map((c) => c.trim()).filter(Boolean).slice(1, -1); // first and last may be partial
    const withVideo = cycles.slice(0, 4).map((c) => c.includes('video'));
    const alternates = withVideo.length >= 2 && withVideo.every((x, i) => i === 0 || x !== withVideo[i - 1]);
    if (!alternates) problems.push(`video cada 2 vueltas: ${JSON.stringify(cycles)}`);
    await page.close();
  }
  // Broken video: the totem does not get stuck (the schedule moves on)
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    const k = await kiosk(page, { post: 60000, latestZaps: 60000, top10Historico: 60000, top10Ultimas3h: 60000, anuncio: 60000 }, { videoMode: 'full', videoDurationSec: 3 });
    await page.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, videoSrc: '/video/no-existe.webm' } }));
    await page.goto('http://localhost:4179/');
    await k.show('video');
    const at = await page.evaluate(() => document.getElementById('scene').className);
    await page.waitForTimeout(5000);
    const after = await page.evaluate(() => document.getElementById('scene').className);
    if (at !== 'scene scene-video' || after !== 'scene scene-post') problems.push(`video roto: ${at} → ${after} (debía seguir solo)`);
    await page.close();
  }

  // Admin: login, announcement and remote arrows
  {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await page.goto('http://localhost:4179/admin');
    await page.waitForSelector('#admin');
    await page.waitForTimeout(400);
    await page.fill('input[type="password"]', 'incorrecta');
    await page.click('button[type="submit"]');
    await page.waitForTimeout(400);
    const err = await page.evaluate(async () => ({ msg: document.querySelector('.err')?.textContent ?? '', authed: (await (await fetch('/api/session')).json()).authed }));
    if (!/incorrecta/i.test(err.msg) || err.authed) problems.push(`admin: no rechazó la clave incorrecta (${JSON.stringify(err)})`);
    await page.screenshot({ path: `${out}/admin-login-error.png` });
    await page.fill('input[type="password"]', 'admin');
    await page.click('button[type="submit"]');
    await page.waitForSelector('textarea[name="announcement"]', { timeout: 5000 });
    const startValue = new Date((now - 86400) * 1000 - 3 * 3600_000).toISOString().slice(0, 16);
    await page.fill('input[name="startLine"]', startValue);
    await page.fill('input[name="prov-new"]', 'wallet.example');
    await page.click('form.prov-add button[type="submit"]');
    await page.waitForSelector('.prov-item[data-domain="wallet.example"]');
    await page.fill('textarea[name="announcement"]', '¡Sorteo desde e2e!');
    if (await page.$('input[name="dur-video"]')) problems.push('admin: no debe haber duración para el video');
    await page.fill('input[name="dur-post"]', '20');
    if (!(await page.$('input[name="videoEveryCycles"]'))) problems.push('admin: falta el campo videoEveryCycles');
    else await page.fill('input[name="videoEveryCycles"]', '3');
    const clipShown = () => page.evaluate(() => { const i = document.querySelector('input[name="videoClipSeconds"]'); const l = i?.closest('label'); return !!l && l.offsetParent !== null && getComputedStyle(l).display !== 'none' && !l.hidden; });
    if (await clipShown()) problems.push('admin: "Largo del clip" visible con modo full');
    if (!(await page.$('select[name="videoMode"]'))) problems.push('admin: falta el select videoMode');
    else await page.selectOption('select[name="videoMode"]', 'clip');
    if (!(await page.$('input[name="videoClipSeconds"]'))) problems.push('admin: falta el campo videoClipSeconds');
    else await page.fill('input[name="videoClipSeconds"]', '30');
    if (!(await clipShown())) problems.push('admin: "Largo del clip" oculto con modo clip');
    await page.click('button.save');
    await page.waitForFunction(() => document.querySelector('.status')?.textContent, null, { timeout: 5000 }).catch(() => {});
    const status = await page.evaluate(() => document.querySelector('.status')?.textContent ?? '');
    if (status !== 'Guardado') problems.push(`admin: Guardar respondió "${status}"`);
    const saved = await page.evaluate(async () => (await fetch('/api/settings')).json());
    if (saved.announcement !== '¡Sorteo desde e2e!' || saved.sceneDurations?.post !== 20000 || saved.videoEveryCycles !== 3 || saved.videoMode !== 'clip' || saved.videoClipSeconds !== 30) problems.push(`admin: anuncio/duración no guardados (${JSON.stringify(saved)})`);
    if (Date.parse(saved.startLine) !== Date.parse(`${startValue}:00-03:00`)) problems.push('admin: inicio no guardado con hora de Argentina');
    if (!saved.zapProviders?.includes('wallet.example')) problems.push('admin: proveedor no guardado');
    // full mode: hidden live, saving keeps videoClipSeconds, and still hidden after reload; with clip it shows again
    const saveAndReload = async () => {
      await page.evaluate(() => { document.querySelector('.status').textContent = ''; });
      await page.click('button.save');
      await page.waitForFunction(() => document.querySelector('.status')?.textContent, null, { timeout: 5000 }).catch(() => {});
      await page.reload();
      await page.waitForSelector('select[name="videoMode"]', { timeout: 5000 });
    };
    await page.selectOption('select[name="videoMode"]', 'full');
    if (await clipShown()) problems.push('admin: "Largo del clip" no se ocultó al elegir full');
    await saveAndReload();
    const keep = await page.evaluate(async () => (await fetch('/api/settings')).json());
    if (keep.videoMode !== 'full' || keep.videoClipSeconds !== 30) problems.push(`admin: guardar con full no conservó videoClipSeconds (${JSON.stringify(keep)})`);
    if (await clipShown()) problems.push('admin: "Largo del clip" visible al cargar con full');
    await page.selectOption('select[name="videoMode"]', 'clip');
    await saveAndReload();
    if (!(await clipShown())) problems.push('admin: "Largo del clip" oculto al cargar con clip');
    const epoch0 = (await page.evaluate(async () => (await fetch('/api/settings')).json())).epoch;
    await page.click('button.cmd-next');
    await page.waitForTimeout(300);
    const set = await page.evaluate(async () => (await fetch('/api/settings')).json());
    if (set.epoch === epoch0) problems.push(`admin: la flecha remota no movió la agenda (epoch ${set.epoch})`);
    // admin layout: uses the width on desktop; one column on mobile; nothing overflows
    const cardsAt = async (w, h) => {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(200);
      return page.evaluate(() => ({
        sw: document.documentElement.scrollWidth, vw: window.innerWidth,
        pw: Math.round(document.querySelector('.panel').getBoundingClientRect().width),
        cards: [...document.querySelectorAll('.panel .card')].filter((c) => c.getBoundingClientRect().width > 0).map((c) => { const r = c.getBoundingClientRect(); return { l: Math.round(r.left), t: Math.round(r.top), r: Math.round(r.right), sw: c.scrollWidth, cw: c.clientWidth }; }),
      }));
    };
    const wide = await cardsAt(1920, 1080);
    if (await page.isVisible('nav.tabs')) problems.push('admin escritorio: pestañas móviles visibles');
    if (wide.cards.length < 4) problems.push(`admin 1920: faltan tarjetas (.card: ${wide.cards.length})`);
    else {
      if (wide.pw < wide.vw * 0.5) problems.push(`admin 1920: no aprovecha el ancho (panel ${wide.pw}px de ${wide.vw}px)`);
      if (wide.sw > wide.vw || wide.cards.some((c) => c.r > wide.vw || c.sw > c.cw + 1)) problems.push(`admin 1920: algo desborda (${JSON.stringify(wide)})`);
    }
    await page.screenshot({ path: `${out}/admin-panel.png`, fullPage: true });
    const narrow = await cardsAt(390, 844);
    if (!(await page.isVisible('nav.tabs'))) problems.push('admin móvil: faltan pestañas');
    await page.evaluate(() => window.scrollTo(0, 250));
    await page.waitForFunction(() => Math.abs(document.querySelector('nav.tabs').getBoundingClientRect().top) <= 1, null, { timeout: 2000 }).catch(() => problems.push('admin móvil: pestañas no permanecen visibles al desplazar'));
    await page.click('[data-tab="mod"]');
    if (await page.isVisible('[data-pane="config"]') || !(await page.isVisible('[data-pane="mod"]'))) problems.push('admin móvil: pestaña Mensajes no cambia el contenido');
    await page.click('[data-tab="config"]');
    if (!(await page.isVisible('[data-pane="config"]')) || await page.isVisible('[data-pane="mod"]')) problems.push('admin móvil: pestaña Config no cambia el contenido');
    if (narrow.cards.length < 4 || new Set(narrow.cards.map((c) => c.l)).size !== 1) problems.push(`admin 390: no es una sola columna (${JSON.stringify(narrow.cards)})`);
    if (narrow.sw > narrow.vw || narrow.cards.some((c) => c.r > narrow.vw || c.sw > c.cw + 1)) problems.push(`admin 390: algo desborda (${JSON.stringify(narrow)})`);
    await page.screenshot({ path: `${out}/admin-panel-390.png`, fullPage: true });
    await page.setViewportSize({ width: 1280, height: 720 });

    const totem = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    await totem.route('**/config.json', (r) => r.fulfill({ json: { ...cfg, publicUrl: 'https://totem.lacrypta.ar/', settingsPollMs: 500 } }));
    await totem.addInitScript((d) => localStorage.setItem('totemcillo:v1', d), JSON.stringify({ posts: five, zaps: fiveZaps }));
    await totem.goto('http://localhost:4179/');
    await totem.waitForTimeout(2500);
    const saw = await totem.evaluate(() => document.body.innerText.includes('¡Sorteo desde e2e!'));
    // force anuncio scene via arrows if needed
    let found = saw;
    for (let i = 0; i < 7 && !found; i++) {
      await page.click('button.cmd-next');
      await totem.waitForTimeout(1500);
      found = await totem.evaluate(() => document.body.innerText.includes('¡Sorteo desde e2e!'));
    }
    if (!found) problems.push('admin: el anuncio no llegó al tótem');
    await totem.screenshot({ path: `${out}/totem-anuncio-remoto.png` });
    // Remote next re-anchors the schedule, then the totem changes scene.
    const before = await totem.evaluate(() => document.getElementById('scene')?.className);
    await page.click('button.cmd-next');
    await totem.waitForTimeout(2000);
    const after = await totem.evaluate(() => document.getElementById('scene')?.className);
    if (before === after) problems.push(`admin: flecha remota no cambió la escena (${before})`);
    await page.click('button.logout');
    await page.waitForURL('http://localhost:4179/');
    const session = await page.evaluate(async () => (await fetch('/api/session')).json());
    if (session.authed) problems.push('admin: la sesión sigue activa después de salir');
    await page.close();
    await totem.close();
  }

  const invalidAvatar = await fetch('http://localhost:4179/api/avatar?url=http%3A%2F%2Flocalhost');
  if (invalidAvatar.status !== 400) problems.push(`avatar: la ruta no rechaza URL insegura (${invalidAvatar.status})`);

} finally {
  await browser.close();
  server.httpServer.close();
}
if (problems.length) {
  console.error('LAYOUT PROBLEMS:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Layout OK at ${viewports.map((v) => v.join('x')).join(', ')}. Screenshots in ${out}`);
