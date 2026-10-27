import { graphemes } from './text';

const MAX_ANNOUNCEMENT = 280;

/** Announcement text (the admin changes it live). */
export class Announcement {
  private fns = new Set<() => void>();
  text = '';
  constructor(text = '') { this.text = Announcement.clean(text); }

  private static clean(t: string) { return graphemes(String(t ?? '').trim()).slice(0, MAX_ANNOUNCEMENT).join(''); }

  set(t: string) {
    const v = Announcement.clean(t);
    if (v === this.text) return;
    this.text = v;
    this.fns.forEach((f) => f());
  }

  onChange(fn: () => void): () => void { this.fns.add(fn); return () => this.fns.delete(fn); }
}
