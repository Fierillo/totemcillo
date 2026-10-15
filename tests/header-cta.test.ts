import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync('index.html', 'utf8');
const css = readFileSync('src/style.css', 'utf8');
const main = readFileSync('src/main.ts', 'utf8');

describe('CTA en el header (sin footer)', () => {
  it('el header lleva logo + «Publicá desde Nostr con #lacrypta o #labitconf» arriba a la derecha', () => {
    const header = html.match(/<header class="topbar">([\s\S]*?)<\/header>/)![1];
    expect(header).toMatch(/^<img class="brand"[^>]*\/><span class="cta">Publicá desde Nostr con <b>#lacrypta<\/b> o <b>#labitconf<\/b><\/span>$/);
  });
  it('ya no hay footer ni hashtags sueltos', () => {
    expect(html).not.toMatch(/<footer/);
    expect(html).not.toMatch(/id="tags"/);
    expect(main).not.toMatch(/getElementById\('tags'\)/);
    expect(css).not.toMatch(/\.footer/);
    expect(css).not.toMatch(/\.tags\b/);
  });
  it('kiosko: la escena ocupa todo el alto bajo el header', () => {
    expect(css).toMatch(/#app\s*\{[^}]*grid-template-rows:\s*auto minmax\(0, 1fr\);/);
  });
  it('el CTA no se superpone: se corta con … en una línea (kiosko) y envuelve en celular', () => {
    expect(css).toMatch(/\.cta\s*\{[^}]*min-width:\s*0[^}]*overflow:\s*hidden[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.is-mobile \.cta\s*\{[^}]*white-space:\s*normal/);
  });
});
