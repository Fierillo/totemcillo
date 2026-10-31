// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { refitOn } from '../src/scenes/live';
import { postScene } from '../src/scenes/post';
import { ZapStore } from '../src/nostr/store';

let cb: (() => void) | undefined; const observed: Element[] = [];
class RO { constructor(f: () => void) { cb = f; } observe(e: Element) { observed.push(e); } disconnect() { cb = undefined; } }
vi.stubGlobal('ResizeObserver', RO);
afterEach(() => { observed.length = 0; });
const sized = (el: HTMLElement, w: number, h: number) => { el.getBoundingClientRect = () => ({ width: w, height: h } as DOMRect); };

describe('refit de los flotantes sin redibujar', () => {
  it('reacomoda cuando cambia el tamaño del área o termina de cargar un avatar, no si el tamaño es el mismo', () => {
    const root = document.createElement('div'), fit = vi.fn(); sized(root, 800, 600);
    const off = refitOn(root, fit);
    cb!(); expect(fit).toHaveBeenCalledTimes(0); // same size as when fitted
    sized(root, 800, 500); cb!(); expect(fit).toHaveBeenCalledTimes(1);
    const img = document.createElement('img'); root.append(img); img.dispatchEvent(new Event('load'));
    expect(fit).toHaveBeenCalledTimes(2);
    off(); img.dispatchEvent(new Event('load')); expect(fit).toHaveBeenCalledTimes(2);
  });
  it('la escena de mensajes observa su raíz', () => {
    const root = document.createElement('div');
    const stop = postScene(new ZapStore(), { publicUrl: 'https://x/' }).render(root);
    expect(observed).toContain(root);
    stop?.();
  });
});
