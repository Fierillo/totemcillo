// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyEvent } from 'nostr-tools/pure';
import { ANON_KEY, anonSigner, openCompose } from '../src/compose';

afterEach(() => { localStorage.clear(); document.querySelectorAll('dialog').forEach((d) => d.remove()); });

describe('firmante anónimo', () => {
  it('crea una clave anónima, la persiste y la reutiliza', async () => {
    const ev1 = await anonSigner(localStorage)({ kind: 1, created_at: 1, content: 'a', tags: [] });
    const ev2 = await anonSigner(localStorage)({ kind: 1, created_at: 2, content: 'b', tags: [] });
    expect(verifyEvent(ev1 as any)).toBe(true);
    expect(ev2.pubkey).toBe(ev1.pubkey);
    expect(localStorage.getItem(ANON_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('clave anónima inválida', () => {
  it('si la guardada no es hex de 64, genera una nueva en vez de explotar', async () => {
    localStorage.setItem(ANON_KEY, 'zz-corrupta');
    const ev = await anonSigner(localStorage)({ kind: 1, created_at: 1, content: 'a', tags: [] });
    expect(verifyEvent(ev as any)).toBe(true);
    expect(localStorage.getItem(ANON_KEY)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('editor de mensaje anónimo', () => {
  const open = (publish = vi.fn().mockResolvedValue(undefined)) => {
    openCompose(['lacrypta'], publish, localStorage);
    const dialog = document.querySelector<HTMLDialogElement>('dialog.m-compose')!;
    return { publish, dialog };
  };
  it('va directo al texto: sin selector ni opción de cliente de Nostr', () => {
    const { dialog } = open();
    expect(dialog.querySelector('form')!.hidden).toBe(false);
    expect(dialog.querySelector('[data-anon], [data-nostr-client], .zap-choices')).toBeNull();
    expect(dialog.textContent).not.toContain('cliente de Nostr');
  });
  it('avisa claramente que los mensajes anónimos no podrán ser zapeados', () => {
    const { dialog } = open();
    const warn = dialog.querySelector('.m-compose-warn')!;
    expect(warn.textContent!.trim()).toBe('Los mensajes anónimos no pueden ser zapeados');
    expect(warn.querySelector('svg .m-bolt-x')).not.toBeNull(); // the red struck-through bolt, not a warning sign
    expect(dialog.textContent).not.toContain('⚠️');
  });
  it('Publicar y Cancelar usan la base común de botones', () => {
    const { dialog } = open();
    expect(dialog.querySelector('[type="submit"]')!.classList.contains('btn')).toBe(true);
    expect(dialog.querySelector('[data-close]')!.classList.contains('btn')).toBe(true);
  });
  it('sin el texto explicativo gris', () => {
    const { dialog } = open();
    expect(dialog.querySelector('.zap-note')).toBeNull();
    expect(dialog.textContent).not.toContain('identidad anónima');
  });
  it('no deja publicar sin el hashtag #lacrypta (entero, sin importar mayúsculas)', async () => {
    const { publish, dialog } = open();
    const text = dialog.querySelector('textarea')!, send = dialog.querySelector<HTMLButtonElement>('[type="submit"]')!;
    const type = (v: string) => { text.value = v; text.dispatchEvent(new Event('input', { bubbles: true })); };
    expect(send.disabled).toBe(false);
    for (const v of ['hola', '#lacryptaX hola', 'lacrypta hola', '#crypta']) {
      type(v);
      expect(send.disabled, v).toBe(true);
      expect(dialog.querySelector('.m-compose-hint')!.textContent).toContain('#lacrypta');
    }
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await Promise.resolve();
    expect(publish).not.toHaveBeenCalled();
    type('hola #LaCrypta!');
    expect(send.disabled).toBe(false);
    expect(dialog.querySelector('.m-compose-hint')!.textContent).toBe('');
  });
  it('firma siempre con la clave anónima aunque haya extensión NIP-07', async () => {
    const signEvent = vi.fn();
    (window as any).nostr = { signEvent };
    try {
      const { publish, dialog } = open();
      dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
      expect(signEvent).not.toHaveBeenCalled();
      expect(publish.mock.calls[0][0].pubkey).toBe((await anonSigner(localStorage)({ kind: 1, created_at: 1, content: '', tags: [] })).pubkey);
    } finally { delete (window as any).nostr; }
  });
  it('arranca con #lacrypta, avisa que es anónimo y publica un kind 1 firmado con la etiqueta t', async () => {
    const { publish, dialog } = open();
    const text = dialog.querySelector('textarea')!;
    expect(text.value).toBe('#lacrypta ');
    text.value = '#lacrypta hola tótem';
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(publish).toHaveBeenCalledTimes(1));
    const ev = publish.mock.calls[0][0];
    expect(ev).toMatchObject({ kind: 1, content: '#lacrypta hola tótem' });
    expect(ev.tags).toContainEqual(['t', 'lacrypta']);
    expect(verifyEvent(ev as any)).toBe(true);
    await vi.waitFor(() => expect(document.querySelector('dialog.m-compose')).toBeNull());
  });
  it('si falla la publicación muestra el error y deja reintentar; Cancelar cierra sin publicar', async () => {
    const { publish, dialog } = open(vi.fn().mockRejectedValue(new Error('Ningún relay aceptó el post')));
    dialog.querySelector('textarea')!.value = '#lacrypta hola';
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')!.textContent).toBe('No se pudo publicar, probá de nuevo'));
    expect(dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
    dialog.querySelector<HTMLButtonElement>('[data-close]')!.click();
    expect(document.querySelector('dialog.m-compose')).toBeNull();
    expect(publish).toHaveBeenCalledTimes(1);
  });
  it('si falla, muestra un mensaje en castellano y re-habilita el botón', async () => {
    const { dialog } = open(vi.fn().mockRejectedValue(new AggregateError([], 'All promises were rejected')));
    dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await vi.waitFor(() => expect(dialog.querySelector('[role="alert"]')!.textContent).toBe('No se pudo publicar, probá de nuevo'));
    expect(dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
  });
  it('si ningún relay responde en 10 s, corta y re-habilita el botón', async () => {
    vi.useFakeTimers();
    try {
      const { dialog } = open(vi.fn(() => new Promise(() => {})));
      dialog.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await vi.advanceTimersByTimeAsync(10_000);
      expect(dialog.querySelector('[role="alert"]')!.textContent).toBe('No se pudo publicar, probá de nuevo');
      expect(dialog.querySelector<HTMLButtonElement>('[type="submit"]')!.disabled).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('cerrar con Esc (evento close) saca el diálogo del DOM', () => {
    const { dialog } = open();
    dialog.dispatchEvent(new Event('close'));
    expect(document.querySelector('dialog.m-compose')).toBeNull();
  });
  it('el límite del texto es el mismo que muestra mobile completo', async () => {
    const { MOBILE_POST_MAX_CHARS } = await import('../src/mobile');
    expect(open().dialog.querySelector('textarea')!.maxLength).toBe(MOBILE_POST_MAX_CHARS);
  });
});
