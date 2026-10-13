import type { ZapStore } from '../nostr/store';

/** Dibuja ya, en cada cambio del store y en cada resize; devuelve la función de limpieza. */
export function live(store: ZapStore, draw: () => void): () => void {
  draw();
  const off = store.onChange(draw);
  window.addEventListener('resize', draw);
  return () => { off(); window.removeEventListener('resize', draw); };
}
