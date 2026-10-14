// @vitest-environment happy-dom
import { describe, expect, it, vi } from 'vitest';
import { Announcement, MAX_ANNOUNCEMENT } from '../src/announcement';
import { anuncioScene, EMPTY_ANUNCIO } from '../src/scenes/anuncio';

describe('Announcement', () => {
  it('avisa cambios sólo si cambia el texto y lo limita a 280 caracteres', () => {
    const a = new Announcement('hola');
    const fn = vi.fn();
    const off = a.onChange(fn);
    a.set('hola');
    expect(fn).not.toHaveBeenCalled();
    a.set('chau');
    expect(fn).toHaveBeenCalledOnce();
    expect(MAX_ANNOUNCEMENT).toBe(280);
    a.set('🧡'.repeat(300));
    expect([...a.text]).toHaveLength(280);
    off();
    a.set('otro');
    expect(fn).toHaveBeenCalledTimes(2);
  });
});

describe('anuncioScene', () => {
  it('título + mensaje escapado y ajustado', () => {
    const root = document.createElement('div');
    const s = anuncioScene(new Announcement('Charla a las <b>18</b> en el stand'), 5000);
    expect([s.name, s.duration]).toEqual(['anuncio', 5000]);
    s.render(root);
    expect(root.querySelector('h1')!.textContent).toBe('📣 Anuncio');
    const p = root.querySelector<HTMLElement>('.anuncio-msg')!;
    expect(p.textContent).toBe('Charla a las <b>18</b> en el stand');
    expect(p.querySelector('b')).toBeNull();
    expect(p.dataset.fit).toBe('text');
  });
  it('sin anuncio muestra estado vacío y se actualiza en vivo hasta limpiar', () => {
    const root = document.createElement('div');
    const a = new Announcement('');
    const cleanup = anuncioScene(a, 1).render(root) as () => void;
    expect(root.querySelector('.empty-msg')!.textContent).toBe(EMPTY_ANUNCIO);
    expect(EMPTY_ANUNCIO).toBe('Sin anuncios por ahora');
    a.set('¡Sorteo!');
    expect(root.querySelector('.anuncio-msg')!.textContent).toBe('¡Sorteo!');
    cleanup();
    a.set('otro');
    expect(root.querySelector('.anuncio-msg')!.textContent).toBe('¡Sorteo!');
  });
});
