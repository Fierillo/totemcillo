import { pending, sats } from './util';

/** Neon zap bolt shared by mobile and the desktop/totem views (no emoji). */
export const BOLT = '<svg class="m-bolt" aria-hidden="true" viewBox="0 0 24 32" width="30" height="40"><path d="M14 1 3 18h8l-2 13 12-18h-8l1-12Z"/></svg>';
export const BOLT_OFF = '<svg class="m-bolt" aria-hidden="true" viewBox="0 0 24 32" width="30" height="40"><path d="M14 1 3 18h8l-2 13 12-18h-8l1-12Z"/><path class="m-bolt-x" d="M2 4 22 28"/></svg>'; // red, struck through: the author can't receive zaps

/** The bolt with its live sats (`unit` after the amount: none on the totem, to save room); a post nobody zapped yet shows the bare bolt, never "0 sats". */
export const boltSats = (msats: number, ready: boolean, unit = '', sep = ' ') => (msats > 0 ? `${BOLT}${sep}${pending(`${sats(msats)}${unit}`, ready)}` : BOLT);
