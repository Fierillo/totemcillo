export const sats = (msats: number) => Math.floor(msats / 1000).toLocaleString('es-AR');
/** Cumulative total that can still grow while the backfill runs: the number blinks until relays finish loading. */
export const pending = (total: string, ready: boolean) => (ready ? total : `<span class="pending" aria-label="Total parcial, cargando zaps">${total}</span>`);
const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENT[c]);
/** Returns safe HTML (already escaped). */
export const shortKey = (pk?: string) => (pk ? esc(`${pk.slice(0, 8)}…${pk.slice(-4)}`) : 'anónimo');
/** Time since `ts` without a prefix: '50s', '20 min', '152 h' (the totem's boxes). */
export const elapsed = (ts: number) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (d < 60) return `${d}s`;
  if (d < 3600) return `${Math.floor(d / 60)} min`;
  return `${Math.floor(d / 3600)} h`;
};
/** The boxes' short age: '50 s', '44 m', '12 h', '3 d'. */
export const age = (ts: number) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  const [n, u] = d < 60 ? [d, 's'] : d < 3600 ? [d / 60, 'm'] : d < 86400 ? [d / 3600, 'h'] : [d / 86400, 'd'];
  return `${Math.floor(n)} ${u}`;
};
export const ago = (ts: number) => `hace ${elapsed(ts)}`;
