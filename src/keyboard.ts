export interface Navigable { next(): void; prev(): void }

/** → siguiente escena, ← anterior. Devuelve la función para desenganchar. */
export function bindKeyboard(r: Navigable, target: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window): () => void {
  const onKey = (e: Event) => {
    const k = (e as KeyboardEvent).key;
    if (k === 'ArrowRight') r.next();
    else if (k === 'ArrowLeft') r.prev();
  };
  target.addEventListener('keydown', onKey);
  return () => target.removeEventListener('keydown', onKey);
}
