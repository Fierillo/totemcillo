/** Argentina (America/Buenos_Aires) is fixed at UTC-3, with no daylight saving time. */
const AR_OFFSET_MS = -3 * 3600_000;

/** ISO with zone → <input type="datetime-local"> value in Argentina time ('' if invalid). */
export function toArInput(iso: string): string {
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? new Date(ms + AR_OFFSET_MS).toISOString().slice(0, 16) : '';
}

/** datetime-local value (Argentina time) → ISO with -03:00 offset; null if empty or malformed. */
export function fromArInput(v: string): string | null {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(v) ? `${v}:00-03:00` : null;
}
