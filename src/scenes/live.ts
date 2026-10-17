import type { LiveEvent, ZapStore } from '../nostr/store';
import { feedFor } from '../livefeed';
import { profiles } from '../nostr/profiles';
import { strike } from '../strike';

/** Draws now; coalesces store/profile/resize bursts to at most ten updates per second. */
export function live(store: ZapStore, draw: () => void): () => void {
  draw();
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const redraw = () => { timer = undefined; last = Date.now(); draw(); };
  const schedule = () => {
    if (timer !== undefined) return;
    const wait = 100 - (Date.now() - last);
    if (wait <= 0) redraw();
    else timer = setTimeout(redraw, wait);
  };
  const off = store.onChange(schedule);
  const offP = profiles.onChange(schedule);
  window.addEventListener('resize', schedule);
  return () => { off(); offP(); window.removeEventListener('resize', schedule); clearTimeout(timer); };
}

/**
 * One-shot animation marks for a scene: live events whose target is on screen
 * (or pending when entering the scene) mark the row (is-new / is-zapped) for the next draw; zapped rows also get a lightning strike.
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
      return { cls: m ? ` ${[...m].join(' ')}` : '' };
    },
    /** Call after drawing: strikes the zapped rows now on screen in `root`, then forgets the marks. */
    consume(root: ParentNode) {
      root.querySelectorAll('.is-zapped').forEach((el) => strike(el));
      marks.clear();
    },
    off,
  };
}
