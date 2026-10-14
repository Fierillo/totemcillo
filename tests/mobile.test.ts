// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { renderMobile, isMobileViewport } from '../src/mobile';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';

const hex = (n: number) => n.toString(16).padStart(64, '0');
const store = () => {
  const s = new ZapStore();
  for (let i = 1; i <= 3; i++) s.addPost({ id: hex(i), pubkey: 'a'.repeat(64), content: `post <i>${i}</i>`, created_at: Math.floor(Date.now() / 1000) - i * 60 });
  s.addZap({ id: 'z', postId: hex(1), sender: 'b'.repeat(64), msats: 21000, comment: 'genial', created_at: Math.floor(Date.now() / 1000) });
  return s;
};

describe('vista móvil (misma ruta, layout scrolleable)', () => {
  it('detecta viewport angosto', () => {
    expect(isMobileViewport({ matchMedia: (q: string) => ({ matches: q.includes('max-width: 700px') }) } as any)).toBe(true);
    expect(isMobileViewport({ matchMedia: () => ({ matches: false }) } as any)).toBe(false);
  });
  it('apila todas las secciones, sin QR y sin ajuste de fuente de kiosko', () => {
    const root = document.createElement('div');
    renderMobile(root, store(), defaultConfig, new Announcement('Sorteo a las 18'));
    expect([...root.querySelectorAll('h2')].map((h) => h.textContent)).toEqual(['📣 Anuncio', 'Posts', '⚡ Últimos zaps', 'Top 10 histórico', `Top 10 · últimas ${defaultConfig.topRecentHours} horas`]);
    expect(root.querySelector('.qr')).toBeNull();
    expect(root.querySelector('[data-fit]')).toBeNull();
    expect(root.textContent).toContain('Sorteo a las 18');
  });
  it('cada post tiene botón Zapear (nostr:) y alternativa njump', () => {
    const root = document.createElement('div');
    renderMobile(root, store(), defaultConfig, new Announcement(''));
    const posts = root.querySelectorAll('.m-post');
    expect(posts).toHaveLength(3);
    expect(posts[0].querySelector('.m-excerpt')!.textContent).toBe('post <i>1</i>');
    const btn = posts[0].querySelector<HTMLAnchorElement>('a.zap-btn')!;
    expect(btn.textContent).toContain('Zapear');
    expect(btn.getAttribute('href')).toMatch(/^nostr:nevent1/);
    const alt = posts[0].querySelector<HTMLAnchorElement>('a.zap-alt')!;
    expect(alt.getAttribute('href')).toMatch(/^https:\/\/njump\.me\/nevent1/);
    expect(alt.getAttribute('target')).toBe('_blank');
    expect(alt.getAttribute('rel')).toContain('noopener');
  });
  it('se actualiza en vivo y deja de hacerlo al limpiar', () => {
    const root = document.createElement('div');
    const s = store();
    const ann = new Announcement('');
    const cleanup = renderMobile(root, s, defaultConfig, ann);
    expect(root.textContent).toContain('Sin anuncios por ahora');
    ann.set('Nuevo anuncio');
    expect(root.textContent).toContain('Nuevo anuncio');
    s.addPost({ id: hex(9), pubkey: 'a'.repeat(64), content: 'recién', created_at: Math.floor(Date.now() / 1000) });
    expect(root.querySelector('.m-post .m-excerpt')!.textContent).toBe('recién');
    cleanup();
    ann.set('otro');
    expect(root.textContent).not.toContain('otro');
  });
  it('estados vacíos', () => {
    const root = document.createElement('div');
    renderMobile(root, new ZapStore(), defaultConfig, new Announcement(''));
    expect(root.textContent).toContain('Todavía no hay posts con #lacrypta / #labitconf');
    expect(root.textContent).toContain('Todavía no hay zaps');
  });
});
