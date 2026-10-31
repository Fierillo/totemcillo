// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('barra superior de la TV', () => {
  it('muestra totemcillo.vercel.app entre el logo y el CTA', () => {
    document.body.innerHTML = readFileSync('index.html', 'utf8').match(/<header class="topbar">[\s\S]*?<\/header>/)![0];
    const kids = [...document.querySelector('.topbar')!.children].map((el) => el.className);
    expect(kids).toEqual(['brand', 'app-url', 'cta']);
    expect(document.querySelector('.topbar .app-url')!.textContent).toBe('totemcillo.vercel.app');
  });
});
