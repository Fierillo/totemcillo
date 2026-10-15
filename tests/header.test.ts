import { describe, expect, it } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';

const html = readFileSync(`${process.cwd()}/index.html`, 'utf8');
const css = readFileSync(`${process.cwd()}/src/style.css`, 'utf8');

describe('header: logo oficial de La Crypta en blanco', () => {
  it('usa <img> con alt "La Crypta" y no el texto ⚡ La Crypta', () => {
    const header = html.match(/<header[\s\S]*?<\/header>/)![0];
    expect(header).toMatch(/<img[^>]+class="brand"[^>]+src="\/lacrypta-logo-white\.svg"[^>]+alt="La Crypta"/);
    expect(header).not.toContain('⚡');
    expect(header).not.toMatch(/>\s*La Crypta\s*</);
  });
  it('el SVG existe en public/ y es blanco', () => {
    const p = `${process.cwd()}/public/lacrypta-logo-white.svg`;
    expect(existsSync(p)).toBe(true);
    const svg = readFileSync(p, 'utf8');
    expect(svg).toContain('<svg');
    expect(svg).not.toContain('currentColor');
    expect(svg).toContain('#ffffff');
  });
  it('el logo se ajusta a la altura del header sin deformarse ni encogerse', () => {
    expect(css).toMatch(/\.brand\s*\{[^}]*height:[^}]*\}/);
    expect(css).toMatch(/\.brand\s*\{[^}]*width:\s*auto[^}]*\}/);
    expect(css).toMatch(/\.brand\s*\{[^}]*flex:\s*0 0 auto[^}]*\}/);
  });
});
