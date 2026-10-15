export const sats = (msats: number) => Math.floor(msats / 1000).toLocaleString('es-AR');
const ENT: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ENT[c]);
/** Returns safe HTML (already escaped). */
export const shortKey = (pk?: string) => (pk ? esc(`${pk.slice(0, 8)}…${pk.slice(-4)}`) : 'anónimo');
export const ago = (ts: number) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (d < 60) return `hace ${d}s`;
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`;
  return `hace ${Math.floor(d / 3600)} h`;
};
