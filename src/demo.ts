import type { ZapStore } from './nostr/store';
import { recentPosts } from './scenes/post';
import type { Follower } from './follow';
import { bootSplash } from './mobile-splash';

const rndHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

const LOREM = 'Bitcoin Lightning Nostr zaps en vivo desde La Crypta, comunidad de Buenos Aires construyendo soberanía con código abierto y descentralización para todos. ';
const sized = (n: number) => `#lacrypta ${LOREM.repeat(Math.ceil(n / LOREM.length)).slice(0, n - '#lacrypta '.length).trimEnd()}`; // the tag first: the store may clip the end
/** Demo texts from very short to very long (chars), to see how the boxes change shape. */
export const DEMO_TEXTS = ['gm #lacrypta', sized(40), sized(100), sized(200), sized(280)];
/** Stable public image for "+ post 🖼" (shown through the avatar proxy like any content image). */
export const DEMO_IMAGE = 'https://picsum.photos/id/1015/800/600.jpg';
/** How many posts "+ mix" adds at once: every length, some repeated. */
const MIX_POSTS = 8;

/** Dev only: window.__totemDemo.post(text?) / .zap(postId?, sats?) to test the live animations. */
export function installDemo(w: any, store: ZapStore, nowSec: () => number = () => Math.floor(Date.now() / 1000), zappable: Set<string> = new Set()) {
  let next = 0;
  const text = () => DEMO_TEXTS[next++ % DEMO_TEXTS.length];
  return w.__totemDemo = {
    post(content = text(), pubkey = rndHex()) {
      const id = rndHex();
      store.addPost({ id, pubkey, content, created_at: nowSec() });
      return id;
    },
    /** Post by an author the dev canZap treats as zappable (green bolt), since random authors get the red one. */
    zappablePost(content?: string) {
      const pubkey = rndHex();
      zappable.add(pubkey);
      return this.post(content, pubkey);
    },
    zap(postId?: string, sats = 21_000) {
      const id = postId ?? recentPosts(store, 1)[0]?.postId;
      if (!id) return null;
      store.addZap({ id: rndHex(), postId: id, sender: rndHex(), msats: sats * 1000, comment: '', created_at: nowSec(), domain: 'getalby.com' });
      return id;
    },
    /** A post of every length at once (every other one zappable, every third one already zapped). */
    mix() {
      for (let i = 0; i < MIX_POSTS; i++) {
        const id = i % 2 ? this.zappablePost() : this.post();
        if (i % 3 === 0) this.zap(id, 21 * (i + 1) * 1_000);
      }
    },
  };
}

export type Demo = ReturnType<typeof installDemo>;

/** Neon crosshair cursor for the "+ zap" aim mode (hotspot at the center). */
const CROSSHAIR = `url("data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32" fill="none" stroke="#c7ff5b" stroke-width="2"><circle cx="16" cy="16" r="9"/><path d="M16 1v8M16 23v8M1 16h8M23 16h8"/><circle cx="16" cy="16" r="1.5" fill="#c7ff5b"/></svg>')}") 16 16`;

/**
 * Dev only: fixed buttons outside #scene, so they stay usable across every scene re-render.
 * With a follower (totem): ◀ / ▶ step the rotation on this screen only and ▷ reloj resumes following the clock.
 */
export function demoButtons(doc: Document, demo: Demo, dev: boolean, follower?: Pick<Follower, 'step' | 'resume' | 'paused'>): HTMLElement | null {
  if (!dev) return null;
  const bar = doc.createElement('div');
  bar.className = 'demo-buttons';
  // Inline styles keep every trace of this dev tool out of the production CSS.
  bar.style.cssText = 'position:fixed;bottom:.5rem;left:.5rem;z-index:101;display:flex;gap:.4rem;';
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
  add('+ post ⚡', () => demo.zappablePost());
  add('+ post 🖼', () => demo.post(`Así se ve un post con imagen en el tótem #lacrypta ${DEMO_IMAGE}`));
  add('+ mix', () => demo.mix());
  // "+ zap": with posts on screen it arms a crosshair and the next click zaps THAT post (Esc / click elsewhere cancels).
  const root = doc.documentElement;
  if (!doc.querySelector('style[data-demo-aim]')) {
    const st = doc.createElement('style');
    st.dataset.demoAim = '';
    st.textContent = `html.demo-aiming, html.demo-aiming * { cursor: ${CROSSHAIR}, crosshair !important; }`; // crosshair only while aiming
    doc.head.append(st);
  }
  const disarm = () => {
    root.classList.remove('demo-aiming');
    zapBtn.setAttribute('aria-pressed', 'false');
    zapBtn.style.background = '#000c';
    zapBtn.style.color = 'var(--fg)';
    doc.removeEventListener('click', aim, true);
    doc.removeEventListener('keydown', esc);
  };
  const aim = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    const id = (e.target as Element).closest?.<HTMLElement>('#scene [data-id]')?.dataset.id;
    disarm();
    if (id) demo.zap(id);
  };
  const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') disarm(); };
  const zapBtn: HTMLButtonElement = add('+ zap', () => {
    if (!doc.querySelector('#scene [data-id]')) return demo.zap() ?? demo.zap(demo.post()); // nothing on screen: newest post (or a new one)
    root.classList.add('demo-aiming');
    zapBtn.setAttribute('aria-pressed', 'true');
    zapBtn.style.background = 'var(--accent)';
    zapBtn.style.color = '#000';
    doc.addEventListener('click', aim, true);
    doc.addEventListener('keydown', esc);
  });
  zapBtn.setAttribute('aria-pressed', 'false');
  // "splash": the mobile loading screen, held until this button or the screen itself is tapped again.
  let splash: ReturnType<typeof bootSplash> | undefined;
  const hide = () => { splash?.close(); splash = undefined; };
  add('splash', () => {
    if (splash) return hide();
    splash = bootSplash(doc, { min: 0, max: Infinity }, () => false, () => {});
    doc.querySelector('.m-splash:last-of-type')?.addEventListener('click', hide);
  });
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
