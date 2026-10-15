import type { Announcement } from './announcement';
import type { Moderation } from './nostr/store';
import { moderationOf } from './moderation-lists';

export interface RemoteNav { next(): void; prev(): void; setDuration(name: string, ms: number): void; setEveryCycles(name: string, n: number): void; setVideoMode(name: string, mode: 'full' | 'clip'): void; setClipSeconds(name: string, sec: number): void }
export interface RemoteOptions { fetchFn?: typeof fetch; nav: RemoteNav; announcement: Announcement; baseDurations: Record<string, number>; baseVideoEveryCycles: number; baseVideoMode: 'full' | 'clip'; baseVideoClipSeconds: number; onModeration?: (m: Moderation) => void }

const MIN = 3000, MAX = 120000;
const validMs = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= MIN && v <= MAX;

/** Consulta /api/settings: aplica anuncio y duraciones, y ejecuta comandos ← → nuevos (por secuencia). */
export function createRemote(o: RemoteOptions) {
  const fetchFn = o.fetchFn ?? fetch;
  let lastSeq: number | null = null;
  const applied: Record<string, number> = {};
  let appliedEvery: number | null = null;
  let appliedMode: string | null = null;
  let appliedClip: number | null = null;

  async function poll(): Promise<void> {
    try {
      const res = await fetchFn('/api/settings', { cache: 'no-store' });
      if (!res.ok) return;
      const s = await res.json();
      if (!s || typeof s !== 'object') return;
      if (typeof s.announcement === 'string') o.announcement.set(s.announcement);
      o.onModeration?.(moderationOf(s));
      const remote = s.sceneDurations && typeof s.sceneDurations === 'object' ? s.sceneDurations : {};
      for (const name of new Set([...Object.keys(o.baseDurations), ...Object.keys(remote)])) {
        const v = validMs(remote[name]) ? remote[name] : o.baseDurations[name];
        if (v !== undefined && applied[name] !== v) { applied[name] = v; o.nav.setDuration(name, v); }
      }
      const ev = s.videoEveryCycles;
      const every = typeof ev === 'number' && Number.isInteger(ev) && ev >= 1 && ev <= 10 ? ev : o.baseVideoEveryCycles;
      if (every !== appliedEvery) { appliedEvery = every; o.nav.setEveryCycles('video', every); }
      const mode = s.videoMode === 'full' || s.videoMode === 'clip' ? s.videoMode : o.baseVideoMode;
      if (mode !== appliedMode) { appliedMode = mode; o.nav.setVideoMode('video', mode); }
      const cs = s.videoClipSeconds;
      const clip = typeof cs === 'number' && Number.isInteger(cs) && cs >= 3 && cs <= 120 ? cs : o.baseVideoClipSeconds;
      if (clip !== appliedClip) { appliedClip = clip; o.nav.setClipSeconds('video', clip); }
      const c = s.command;
      if (c && Number.isInteger(c.seq)) {
        if (lastSeq === null || c.seq < lastSeq) lastSeq = c.seq;
        else if (c.seq > lastSeq) {
          lastSeq = c.seq;
          if (c.action === 'next') o.nav.next();
          else if (c.action === 'prev') o.nav.prev();
        }
      }
    } catch {
      /* sin API (sitio estático) o sin red: se ignora */
    }
  }

  return {
    poll,
    start(intervalMs: number): () => void {
      void poll();
      const t = setInterval(() => void poll(), intervalMs);
      return () => clearInterval(t);
    },
  };
}
