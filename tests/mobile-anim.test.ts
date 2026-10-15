// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderMobile } from '../src/mobile';
import { ZapStore } from '../src/nostr/store';
import { Announcement } from '../src/announcement';
import { defaultConfig } from '../src/config';
import { feedFor } from '../src/livefeed';

const NOW = 1_800_000_000;
const hex = (n: number) => n.toString(16).padStart(64, '0');
const post = (n: number, created_at = NOW - 3600) => ({ id: hex(n), pubkey: 'a'.repeat(64), content: `post ${n}`, created_at });
const zap = (n: number, postN: number, created_at = NOW) => ({ id: hex(1000 + n), postId: hex(postN), sender: 'b'.repeat(64), msats: 210_000, comment: '', created_at });
const setup = () => {
  const s = new ZapStore(undefined, { clock: () => NOW });
  s.addPost(post(1)); s.addPost(post(2));
  const root = document.createElement('div');
  const off = renderMobile(root, s, defaultConfig, new Announcement(''));
  return { s, root, off };
};
const card = (root: HTMLElement, n: number) => root.querySelector(`.m-post[data-id="${hex(n)}"]`)!;

describe('vista móvil: animaciones en vivo', () => {
  it('post nuevo en vivo: su tarjeta recibe is-new (slide-in + glow); el historial no', () => {
    const { s, root } = setup();
    expect(root.querySelector('.is-new')).toBeNull();
    s.addPost(post(3, NOW - 5));
    expect(card(root, 3).classList.contains('is-new')).toBe(true);
    expect(root.querySelectorAll('.is-new')).toHaveLength(1);
    s.addPost(post(4)); // redraw from history: not re-animated
    expect(root.querySelector('.is-new')).toBeNull();
  });
  it('zap en vivo: la tarjeta zapeada recibe is-zapped con rayo junto al total actualizado', () => {
    const { s, root } = setup();
    s.addZap(zap(1, 1));
    const c = card(root, 1);
    expect(c.classList.contains('is-zapped')).toBe(true);
    expect(c.querySelector('.m-total svg.bolt')).not.toBeNull();
    expect(c.querySelector('.m-total')!.textContent).toContain('210');
    expect(root.querySelectorAll('.is-zapped')).toHaveLength(1);
  });
  it('zap viejo (historial) no anima', () => {
    const { s, root } = setup();
    s.addZap(zap(1, 1, NOW - 3600));
    expect(root.querySelector('.is-zapped')).toBeNull();
  });
  it('objetivo visible en móvil: sin pendientes (no hay íconos abajo)', () => {
    const { s } = setup();
    let ind = 0;
    feedFor(s).setIndicator(() => ind++);
    s.addZap(zap(1, 1)); s.addPost(post(9, NOW - 1));
    expect(ind).toBe(0);
    expect(feedFor(s).pending).toHaveLength(0);
  });
  it('al cerrar la vista deja de escuchar eventos', () => {
    const { s, off } = setup();
    off();
    let ind = 0;
    feedFor(s).setIndicator(() => ind++);
    s.addZap(zap(1, 1));
    expect(ind).toBe(1);
  });
  it('CSS: en móvil el post nuevo entra de costado (nunca sube sobre el título de la sección)', () => {
    const css = readFileSync(`${process.cwd()}/src/style.css`, 'utf8');
    const rule = css.match(/\.is-mobile \.m-post\.is-new\s*\{([^}]*)\}/)![1];
    expect(rule).toMatch(/slide-in-x/);
    expect(rule).toMatch(/glow/);
    const kf = css.match(/@keyframes slide-in-x\s*\{[\s\S]*?\}\s*\}/)![0];
    expect(kf).toMatch(/translateX/);
    expect(kf).not.toMatch(/translateY|scale/);
  });
  it('CSS: en móvil el rayo va a la derecha del total (fuera del texto) y el total sólo cambia de color', () => {
    const css = readFileSync(`${process.cwd()}/src/style.css`, 'utf8');
    expect(css).toMatch(/\.m-total\s*\{[^}]*position:\s*relative[^}]*width:\s*fit-content/);
    expect(css).toMatch(/\.m-total \.bolt\s*\{[^}]*left:\s*calc\(100% \+[^}]*right:\s*auto/);
    expect(css).toMatch(/\.is-zapped \.m-total/);
    // the bolt stays within the total's line (neither up into the message nor down into the buttons)
    const rule = css.match(/\.m-total \.bolt\s*\{([^}]*)\}/)![1];
    expect(Number(rule.match(/height:\s*(\d+)%/)![1])).toBeLessThanOrEqual(110);
    expect(Number(rule.match(/top:\s*(-?\d+)%/)![1])).toBeGreaterThanOrEqual(-5);
  });
});
