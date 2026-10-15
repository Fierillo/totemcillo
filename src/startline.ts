/** Argentina (America/Buenos_Aires) está fija en UTC-3, sin horario de verano. */
const AR_OFFSET_MS = -3 * 3600_000;

/** ISO con zona → valor de <input type="datetime-local"> en hora de Argentina ('' si es inválido). */
export function toArInput(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + AR_OFFSET_MS).toISOString().slice(0, 16) : '';
}

/** Valor de datetime-local (hora de Argentina) → ISO con offset -03:00; null si está vacío o mal formado. */
export function fromArInput(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00-03:00` : null;
}
