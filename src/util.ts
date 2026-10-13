export const sats = (msats: number) => Math.floor(msats / 1000).toLocaleString('es-AR');
export const shortKey = (pk?: string) => (pk ? `${pk.slice(0, 8)}…${pk.slice(-4)}` : 'anónimo');
export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const ago = (ts: number) => {
  const d = Math.max(0, Math.floor(Date.now() / 1000 - ts));
  if (d < 60) return `hace ${d}s`;
  if (d < 3600) return `hace ${Math.floor(d / 60)} min`;
  return `hace ${Math.floor(d / 3600)} h`;
};
