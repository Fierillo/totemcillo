// In-page geometry checks (run with page.evaluate): each returns a list of problems, empty when the layout is right.
export function check(scene) {
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

  // Glyphs cut by a clipping box: each rendered text line that starts inside the visible area must end inside it
  // (checks the text's own line boxes against every overflow-clipping ancestor, not just heights).
  const clippedGlyphs = (name, el) => {
    if (!el) return;
    const clips = [];
    for (let a = el; a && a !== document.body; a = a.parentElement) { const cs = getComputedStyle(a); if (cs.overflowY !== 'visible') clips.push([a.getBoundingClientRect(), parseFloat(cs.paddingBottom) || 0]); }
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const r = document.createRange(); r.selectNodeContents(n);
      for (const line of r.getClientRects()) for (const [c, pad] of clips) {
        if (line.top >= c.bottom - pad - 1 || line.height < 1) continue; // fully hidden line (clamped): fine
        if (line.bottom > c.bottom + .5 || line.top < c.top - .5) { P.push(`${name}: glifos recortados (línea ${line.top.toFixed(1)}–${line.bottom.toFixed(1)} vs caja ${c.top.toFixed(1)}–${c.bottom.toFixed(1)})`); return; }
      }
    }
  };
  const top = need('.topbar'), main = need('#scene');

  disjoint([['topbar', top], ['escena', main]]);
  [['topbar', top], ['escena', main]].forEach(([n, el]) => inside(n, el, VP));
  if (scene === 'post') {
    const list = need('ul.post-list'), qr = need('figure.qr');
    inside('lista', list, main); inside('QR', qr, main);
    if (qr && qr.getBoundingClientRect().width < Math.min(120, innerHeight * .25)) P.push(`QR demasiado chico (${qr.getBoundingClientRect().width}px)`);
    if (qr && !/Escaneá.*celular|Abrí.*celular|Escaneá y abrí/i.test(qr.textContent)) P.push('QR sin leyenda para el celular');
    const rows = [...document.querySelectorAll('.post-row')];
    if (!rows.length) P.push('no hay filas de posts');
    // The boxes fill the list: masonry boxes keep their content's height, so the free space below them stays under one more box
    // (as tall as the tallest shown, plus a gap), unless they already have the largest font.
    const fill = () => { // its own function: check stays simple
      const top = Math.min(...rows.map((r) => r.offsetTop)), bottom = Math.max(...rows.map((r) => r.offsetTop + r.offsetHeight)); // layout boxes, without the float
      const css = getComputedStyle(list), room = list.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom);
      const cap = Math.floor(Math.min(Number(list.dataset.max) * innerHeight, Number(list.dataset.maxw ?? Infinity) * innerWidth) / 100);
      const gap = parseFloat(css.rowGap) || 0, tallest = Math.max(...rows.map((r) => r.offsetHeight));
      if (room - (bottom - top) > tallest + gap && parseFloat(list.style.fontSize) < cap) P.push(`las cajas dejan ${Math.round(room - (bottom - top))}px libres abajo (entra otra caja de ${tallest}px)`);
    };
    // No hole a left-out message fits in: fitBoxes reports the shortest box it left out (data-left-out px, 0 if none);
    // a column still open for the reading order (its bottom at or below the last box's top) can't have that much room.
    const holes = () => {
      if (list.dataset.leftOut === undefined) return P.push('la lista no informa las cajas que dejó afuera (data-left-out)');
      const out = Number(list.dataset.leftOut), css = getComputedStyle(list), gap = parseFloat(css.rowGap) || 0, pad = parseFloat(css.paddingLeft);
      if (!out) return;
      const w = parseFloat(list.style.getPropertyValue('--col-w')), n = Math.round((list.clientWidth - pad - parseFloat(css.paddingRight) + gap) / (w + gap));
      const L = list.getBoundingClientRect(), qr = q('figure.qr').getBoundingClientRect(), y0 = L.top + parseFloat(css.paddingTop);
      const room = list.clientHeight - parseFloat(css.paddingTop) - parseFloat(css.paddingBottom), last = rows.at(-1).offsetTop;
      for (let c = 0; c < n; c++) {
        const x = pad + c * (w + gap), mine = rows.filter((r) => Math.abs(r.offsetLeft - x) < 2);
        const bottom = Math.max(0, ...mine.map((r) => r.offsetTop - parseFloat(css.paddingTop) + r.offsetHeight + gap));
        const left = L.left + x, under = left + w > qr.left - gap && left < qr.right + gap && qr.top - gap < y0 + room;
        const limit = under ? Math.min(room, qr.top - gap - y0) : room;
        if (bottom + parseFloat(css.paddingTop) >= last && limit - bottom >= out) P.push(`columna ${c}: quedan ${Math.round(limit - bottom)}px libres y una caja de ${out}px quedó afuera`);
      }
    };
    if (rows.length && list) { fill(); holes(); }
    rows.forEach((row, i) => {
      inside(`fila ${i}`, row, list);
      disjoint([[`fila ${i}`, row], ['QR', qr]]);
      for (const sel of ['.author', '.ago', '.excerpt', '.row-total']) if (!row.querySelector(sel)) P.push(`fila ${i}: falta ${sel}`);
      if (row.querySelector('.row-zaps')) P.push(`fila ${i}: muestra mensajes de zaps`);
      const excerpt = row.querySelector('.excerpt');
      const fs = (e) => e && parseFloat(getComputedStyle(e).fontSize);
      const floor = Number(list?.dataset.boxMin ?? 12); // the messages' legible floor (BOX_MIN_PX, or BOX_MIN_RATIO of the list font)
      if (fs(excerpt) < floor) P.push(`fila ${i}: letra del mensaje ${fs(excerpt)}px < ${floor}px`);
      const total = row.querySelector('.row-total');
      if (total && excerpt && fs(total) > fs(row.querySelector('.row-meta')) + .5) P.push(`fila ${i}: sats (${fs(total)}px) más grandes que el mensaje`);
      const age = row.querySelector('.ago'); // the time is never cut
      if (age && age.scrollWidth > age.clientWidth + 1) P.push(`fila ${i}: hora truncada`);
      const mid = (e) => { const r = e.getBoundingClientRect(); return (r.top + r.bottom) / 2; };
      const name = row.querySelector('.alias') ?? row.querySelector('.author');
      if (age && name && Math.abs(mid(age) - mid(name)) > 2) P.push(`fila ${i}: la hora no está alineada con el nombre`);
      const main = row.querySelector('.row-main'); // the corner time and sats can't be clipped by it
      if (main && getComputedStyle(main).overflow !== 'visible') for (const [n, el] of [['hora', row.querySelector('.ago')], ['sats', total]]) if (el) inside(`${n} fila ${i}`, el, main);
      if (total && !total.parentElement.matches('.row-foot')) P.push(`fila ${i}: los sats no están al pie`);
      if (total && excerpt && total.getBoundingClientRect().top < excerpt.getBoundingClientRect().bottom - 1) P.push(`fila ${i}: los sats no van debajo del mensaje`);
      if (excerpt?.textContent.includes('POST VIEJO')) P.push('muestra un post fuera de la ventana de 24 h');
      noOverflow(`fila ${i} extracto`, excerpt);
      clippedGlyphs(`fila ${i} extracto`, excerpt); clippedGlyphs(`fila ${i} autor`, row.querySelector('.row-meta'));
      if (excerpt) { const lh = parseFloat(getComputedStyle(excerpt).lineHeight), n = excerpt.clientHeight / lh; if (lh && (n < .9 || Math.abs(excerpt.clientHeight - Math.round(n) * lh) > 1)) P.push(`fila ${i} extracto recortado en vertical (${excerpt.clientHeight}px, línea ${lh}px)`); }
    });
    noOverflow('lista de posts', list);
  } else {
    const h1 = need('h1'), ol = need('.batalla');
    if (h1 && h1.textContent.trim() !== 'Batalla de zaps · últimas 3 horas') P.push(`título "${h1.textContent.trim()}"`);
    inside('título', h1, main); inside('batalla', ol, main); disjoint([['título', h1], ['batalla', ol]]);
    if (ol && !ol.children.length) P.push('batalla vacía');
    if (ol && /POST VIEJO|1\.000\.000\.000/.test(ol.textContent)) P.push('la batalla incluye un post vencido');
    if (ol) [...ol.children].map((li) => li.getBoundingClientRect()).sort((a, b) => a.top - b.top).forEach((r, i, all) => {
      const gap = i ? r.top - all[i - 1].bottom : Infinity;
      if (gap < 7.5) P.push(`barras ${i - 1} y ${i} sin separación mínima (${gap.toFixed(1)}px)`);
    });
    if (ol) [...ol.children].forEach((li, i) => {
      inside(`barra ${i}`, li, ol); const s = li.querySelector('.bar-sats'); inside(`sats barra ${i}`, s, ol);
      // The message must show whole lines (no clipped descenders) and the bar can't cover it.
      const msg = li.querySelector('.bar-msg'), track = li.querySelector('.bar-track');
      if (!msg) return;
      const lbl = li.querySelector('.bar-label'), fs = (e) => parseFloat(getComputedStyle(e).fontSize);
      if (fs(msg) < 14) P.push(`mensaje barra ${i}: letra ${fs(msg)}px < 14px`);
      if (lbl && getComputedStyle(lbl).display !== 'none' && fs(lbl) < 11) P.push(`autor barra ${i}: letra ${fs(lbl)}px < 11px`);
      const ms = getComputedStyle(msg), lh = parseFloat(ms.lineHeight), inner = msg.clientHeight - parseFloat(ms.paddingTop) - parseFloat(ms.paddingBottom), lines = inner / lh;
      if (lines < .9 || Math.abs(inner - Math.round(lines) * lh) > 1) P.push(`mensaje barra ${i} recortado en vertical (${msg.clientHeight}px, línea ${lh}px)`);
      // fit order: shrink the font → use the bar's whole height → truncate last. A cut message is at the 14px floor and fills its bar down to the line.
      const cut = msg.hasAttribute('data-cut') || msg.scrollHeight > msg.clientHeight + 1; // cut by the fit (the store's own length cap aside)
      if (cut && fs(msg) > 14.5) P.push(`mensaje barra ${i} truncado a ${fs(msg)}px (antes debía achicar la letra)`);
      if (cut && track && track.getBoundingClientRect().top - msg.getBoundingClientRect().bottom > lh) P.push(`mensaje barra ${i} truncado con alto libre en su barra`);
      clippedGlyphs(`mensaje barra ${i}`, msg); clippedGlyphs(`sats barra ${i}`, li.querySelector('.bar-sats'));
      inside(`mensaje barra ${i}`, msg, li); disjoint([[`mensaje barra ${i}`, msg], [`línea barra ${i}`, track]]);
      if (li.scrollHeight > li.clientHeight + 1) P.push(`barra ${i} desborda en vertical`);
    });
  }
  const qr = document.querySelector('figure.qr');
  if (qr) {
    for (const row of document.querySelectorAll('.post-row, .batalla > li')) {
      disjoint([['fila', row], ['QR', qr]]);
      const parent = row.parentElement;
      const edge = R(parent).right - parseFloat(getComputedStyle(parent).paddingRight);
      const gap = parseFloat(getComputedStyle(main).fontSize);
      if (parent.dataset.boxes === undefined && R(row).bottom < R(qr).top - gap - 1 && R(row).right < edge - 2) P.push('fila superior restringida por una columna invisible del QR');
    }
  }
  document.querySelectorAll('.rank, .total, .row-total, .bar-sats').forEach((el, i) => {
    if (el.scrollWidth > el.clientWidth + 1) P.push(`monto/rank recortado #${i}: "${el.textContent.trim()}"`);
  });
  // Neon bolt (same SVG as mobile): about one line of the total's text, legible from a distance.
  document.querySelectorAll('.row-total, .bar-sats, h1').forEach((el, i) => {
    const b = el.querySelector('svg.m-bolt'); if (!b) return;
    const ratio = b.getBoundingClientRect().height / parseFloat(getComputedStyle(el).fontSize);
    if (ratio < .8 || ratio > 1.3) P.push(`rayo #${i} desproporcionado (${ratio.toFixed(2)}× la letra)`);
  });
  return P;
}

export function checkEmpty([scene, expected]) {
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
export function checkHeader() {
  const problems = [], header = document.querySelector('.topbar');
  const logo = header?.querySelector('img'), cta = header?.querySelector('.cta');
  if (!header || !logo || !cta) return ['falta header, logo o invitación a publicar'];
  if (!logo.complete || !logo.naturalWidth || logo.alt !== 'La Crypta') problems.push('logo sin cargar o sin texto alternativo');
  if (!/Nostr/.test(cta.textContent) || !cta.textContent.includes('#lacrypta')) problems.push('faltan instrucciones de publicación');
  const h = header.getBoundingClientRect(), l = logo.getBoundingClientRect(), c = cta.getBoundingClientRect();
  for (const r of [l, c]) if (r.left < h.left - 1 || r.right > h.right + 1 || r.top < h.top - 1 || r.bottom > h.bottom + 1) problems.push('contenido fuera del header');
  if (l.right > c.left + 1 && l.bottom > c.top + 1 && l.top < c.bottom - 1) problems.push('logo e instrucciones superpuestos');
  if (logo.naturalHeight && Math.abs(l.width / l.height - logo.naturalWidth / logo.naturalHeight) > 0.1) problems.push('logo deformado');
  return problems;
}

export function checkRepoLink() {
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
