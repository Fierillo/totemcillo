import type { ZapStore } from './nostr/store';
import { recentPosts } from './scenes/post';

const rndHex = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), (b) => b.toString(16).padStart(2, '0')).join('');

/** Dev only: window.__totemDemo.post(text?) / .zap(postId?, sats?) to test the live animations. */
export function installDemo(w: any, store: ZapStore, nowSec: () => number = () => Math.floor(Date.now() / 1000)) {
  w.__totemDemo = {
    post(content = `Post de prueba #lacrypta ${new Date().toLocaleTimeString('es-AR')}`) {
      const id = rndHex();
      store.addPost({ id, pubkey: rndHex(), content, created_at: nowSec() });
      return id;
    },
    zap(postId?: string, sats = 21_000) {
      const id = postId ?? recentPosts(store, 1)[0]?.postId;
      if (!id) return null;
      store.addZap({ id: rndHex(), postId: id, sender: rndHex(), msats: sats * 1000, comment: '', created_at: nowSec() });
      return id;
    },
  };
}
