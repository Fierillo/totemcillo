import type { LiveEvent, ZapStore } from '../nostr/store';
import { feedFor } from '../livefeed';

/** Dibuja ya, en cada cambio del store y en cada resize; devuelve la función de limpieza. */
export function live(store: ZapStore, draw: () => void): () => void {
  draw();
  const off = store.onChange(draw);
  window.addEventListener('resize', draw);
  return () => { off(); window.removeEventListener('resize', draw); };
}

export const BOLT = '<svg class="bolt" viewBox="0 0 24 48" aria-hidden="true"><path d="M15 0 3 27h9L8 48l14-30h-9l5-18z"/></svg>';

/**
 * Marcas de animación de un solo uso para una escena: eventos en vivo cuyo objetivo está en pantalla
 * (o pendientes al entrar a la escena) marcan la fila (is-new / is-zapped) para el próximo dibujo.
 */
export function liveMarks(store: ZapStore, name: string, kinds: LiveEvent['type'][], visible: (postId: string) => boolean) {
  const feed = feedFor(store);
  const marks = new Map<string, Set<string>>();
  let first = true;
  const add = (e: LiveEvent) => {
    const m = marks.get(e.postId) ?? new Set<string>();
    m.add(e.type === 'post' ? 'is-new' : 'is-zapped');
    marks.set(e.postId, m);
  };
  const off = feed.attach({ name, kinds, visible, mark: add });
  return {
    /** Llamar al dibujar con los ids visibles: en el primer dibujo toma los pendientes de esa escena. */
    begin(ids: string[]) {
      if (!first) return;
      first = false;
      feed.take(name, kinds, new Set(ids)).forEach(add);
    },
    attrs(id: string) {
      const m = marks.get(id);
      return { cls: m ? ` ${[...m].join(' ')}` : '', bolt: m?.has('is-zapped') ? BOLT : '' };
    },
    consume() { marks.clear(); },
    off,
  };
}
