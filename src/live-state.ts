/** Estado en vivo: el tótem lo reporta y la miniatura del admin (?preview=1) lo sigue. */
export interface Reported { scene: string | null; index: number; videoTime: number | null }

export function createStateReporter(o: { fetchFn?: typeof fetch; current: () => Reported }) {
  const fetchFn = o.fetchFn ?? fetch;
  let last = '';
  async function report(): Promise<void> {
    const s = o.current();
    const body = JSON.stringify(s);
    if (body === last && s.videoTime === null) return; // sin cambios: no gastar requests
    try {
      const r = await fetchFn('/api/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body });
      if (r.ok) last = body;
    } catch { /* sin API o sin red */ }
  }
  return { report, start(ms: number) { void report(); const t = setInterval(() => void report(), ms); return () => clearInterval(t); } };
}

export interface PreviewView { showIndex(i: number): void; current(): { index: number; videoTime: number | null }; seekVideo(t: number): void }

export function createPreviewFollower(o: { fetchFn?: typeof fetch; view: PreviewView }) {
  const fetchFn = o.fetchFn ?? fetch;
  async function poll(): Promise<void> {
    try {
      const r = await fetchFn('/api/state', { cache: 'no-store' });
      if (!r.ok) return;
      const s = await r.json();
      if (!s || typeof s.index !== 'number' || !Number.isInteger(s.index)) return;
      if (o.view.current().index !== s.index) { o.view.showIndex(s.index); return; }
      const mine = o.view.current().videoTime;
      if (typeof s.videoTime === 'number' && mine !== null && Math.abs(mine - s.videoTime) > 2) o.view.seekVideo(s.videoTime);
    } catch { /* sin API o sin red */ }
  }
  return { poll, start(ms: number) { void poll(); const t = setInterval(() => void poll(), ms); return () => clearInterval(t); } };
}
