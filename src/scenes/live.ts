import type { LiveEvent, ZapStore } from '../nostr/store';
import { feedFor } from '../livefeed';
import { profiles } from '../nostr/profiles';

/** Draws now, on every store change and on every resize; returns the cleanup function. */
export function live(store: ZapStore, draw: () => void): () => void {
  draw();
  const off = store.onChange(draw);
  const offP = profiles.onChange(draw); // alias/avatar when profiles arrive
  window.addEventListener('resize', draw);
  return () => { off(); offP(); window.removeEventListener('resize', draw); };
}

export const BOLT = '<svg class="bolt" viewBox="0 0 24 48" aria-hidden="true"><path d="M15 0 3 27h9L8 48l14-30h-9l5-18z"/></svg>';

/**
 * One-shot animation marks for a scene: live events whose target is on screen
 * (or pending when entering the scene) mark the row (is-new / is-zapped) for the next draw.
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
    /** Call when drawing with the visible ids: on the first draw it takes that scene's pending events. */
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
