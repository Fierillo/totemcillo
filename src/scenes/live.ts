import type { ZapStore } from '../nostr/store';

/** Dibuja ya y en cada cambio del store; devuelve la función de limpieza. */
export function live(store: ZapStore, draw: () => void): () => void {
  draw();
  return store.onChange(draw);
}
