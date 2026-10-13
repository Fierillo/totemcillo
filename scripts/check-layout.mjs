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
const cfg = { relays: [], hashtags: ['lacrypta', 'labitconf'], sceneDurations: { post: 3000, latestZaps: 3000, top10Historico: 3000, top10Ultimas3h: 60000 }, postsPerCycle: 1, talks: [], announcement: '', noteUriTemplate: 'https://njump.me/{nevent}' };

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
    const post = need('.post'), zaps = need('.zaps'), head = need('.post-head'), body = need('.post-body'), total = need('.total');
    const content = need('.post-content'), qr = need('.qr'), author = need('.author'), ul = need('.zaps ul');
    inside('post', post, main); inside('zaps', zaps, main); disjoint([['post', post], ['zaps', zaps]]);
    [['cabecera', head], ['cuerpo', body], ['total', total]].forEach(([n, el]) => inside(n, el, post));
    disjoint([['cabecera', head], ['cuerpo', body], ['total', total]]);
    inside('texto', content, body); inside('QR', qr, body); disjoint([['texto', content], ['QR', qr]]);
    const chars = content ? [...new Intl.Segmenter().segment(content.textContent)].length : 0;
    if (chars > 210) P.push(`texto del post con ${chars} caracteres (> 210)`);
    if (content?.textContent.includes('POST VIEJO')) P.push('muestra un post fuera de la ventana de 24 h');
    noOverflow('texto del post', content); noOverflow('autor', author); noOverflow('lista de zaps', ul); noOverflow('total', total);
    inside('lista de zaps', ul, zaps); itemsInside('zap', ul);
  } else if (scene.startsWith('top')) {
    const h1 = need('h1.top-title'), ol = need('.top-list');
    const expected = scene === 'top10Historico' ? 'Top 10 histórico' : 'Top 10 · últimas 3 horas';
    if (h1 && h1.textContent !== expected) P.push(`título "${h1.textContent}" != "${expected}"`);
    if (h1 && (parseFloat(getComputedStyle(h1).fontSize) < 24 || R(h1).height < 20)) P.push(`título demasiado chico (${getComputedStyle(h1).fontSize}, alto ${R(h1).height}, scroll ${h1.scrollWidth}x${h1.scrollHeight} client ${h1.clientWidth}x${h1.clientHeight})`);
    inside('título', h1, main); inside('ranking', ol, main); disjoint([['título', h1], ['ranking', ol]]);
    noOverflow('título', h1); noOverflow('ranking', ol); itemsInside('fila', ol);
    if (ol && !ol.children.length) P.push('ranking vacío');
    if (scene === 'top10Historico' && !ol?.textContent.includes('post no disponible')) P.push('falta fila de post no disponible');
  } else {
    const h1 = need('h1'), ul = need('.zap-list');
    inside('título', h1, main); inside('lista', ul, main); disjoint([['título', h1], ['lista', ul]]);
    noOverflow('lista de últimos zaps', ul); itemsInside('último zap', ul);
    if (ul && !ul.children.length) P.push('lista vacía');
  }
  document.querySelectorAll('.amount, .rank, .total').forEach((el, i) => {
    if (el.scrollWidth > el.clientWidth + 1) P.push(`monto/rank recortado #${i}: "${el.textContent.trim()}"`);
  });
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
} finally {
  await browser.close();
  server.httpServer.close();
}
if (problems.length) {
  console.error('PROBLEMAS DE LAYOUT:\n' + problems.join('\n'));
  process.exit(1);
}
console.log(`Layout OK en ${viewports.map((v) => v.join('x')).join(', ')}. Capturas en ${out}`);
