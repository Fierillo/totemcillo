import type { ZapStore } from './nostr/store';
import { recentPosts } from './scenes/post';
import type { Follower } from './follow';

const rndHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Dev only: window.__totemDemo.post(text?) / .zap(postId?, sats?) to test the live animations. */
export function installDemo(w: any, store: ZapStore, nowSec: () => number = () => Math.floor(Date.now() / 1000)) {
  return w.__totemDemo = {
    post(content = `Post de prueba #lacrypta ${new Date().toLocaleTimeString('es-AR')}`) {
      const id = rndHex();
      store.addPost({ id, pubkey: rndHex(), content, created_at: nowSec() });
      return id;
    },
    zap(postId?: string, sats = 21_000) {
      const id = postId ?? recentPosts(store, 1)[0]?.postId;
      if (!id) return null;
      store.addZap({ id: rndHex(), postId: id, sender: rndHex(), msats: sats * 1000, comment: '', created_at: nowSec(), domain: 'getalby.com' });
      return id;
    },
  };
}

export type Demo = ReturnType<typeof installDemo>;

/**
 * Dev only: fixed buttons outside #scene, so they stay usable across every scene re-render.
 * With a follower (totem): ◀ / ▶ step the rotation on this screen only and ▷ reloj resumes following the clock.
 */
export function demoButtons(doc: Document, demo: Demo, dev: boolean, follower?: Pick<Follower, 'step' | 'resume' | 'paused'>): HTMLElement | null {
  if (!dev) return null;
  const bar = doc.createElement('div');
  bar.className = 'demo-buttons';
  // Inline styles keep every trace of this dev tool out of the production CSS.
  bar.style.cssText = 'position:fixed;bottom:.5rem;left:.5rem;z-index:50;display:flex;gap:.4rem;';
  let play: HTMLButtonElement | undefined;
  // ▷ reloj is enabled (and lit) only while the arrows have the clock paused.
  const sync = () => {
    if (!play || !follower) return;
    play.disabled = !follower.paused;
    play.style.background = follower.paused ? 'var(--accent)' : '#000c';
    play.style.color = follower.paused ? '#000' : 'var(--fg)';
  };
  const add = (label: string, run: () => unknown) => {
    const b = doc.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.style.cssText = 'font:inherit;font-size:.9rem;padding:.25rem .6rem;border-radius:.4rem;border:1px solid var(--accent);background:#000c;color:var(--fg);cursor:pointer;';
    b.addEventListener('click', () => { run(); sync(); });
    bar.append(b);
    return b;
  };
  add('+ post', () => demo.post());
  add('+ zap', () => demo.zap() ?? demo.zap(demo.post())); // empty feed: post first, then zap it
  if (follower) {
    add('◀', () => follower.step('prev'));
    add('▶', () => follower.step('next'));
    play = add('▷ reloj', () => follower.resume());
    play.title = 'Volver a seguir el reloj de la rotación';
    sync();
  }
  doc.body.append(bar);
  return bar;
}
