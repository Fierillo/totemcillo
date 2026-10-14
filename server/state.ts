import { SCENES } from './settings.js';

/** Lo que el tótem está mostrando ahora (para la miniatura del admin). */
export interface LiveState { scene: string | null; index: number | null; videoTime: number | null; at: number | null }
export const EMPTY_STATE: LiveState = { scene: null, index: null, videoTime: null, at: null };
const NAMES: readonly string[] = [...SCENES, 'video'];

export function validateState(body: unknown, now: number): { ok: true; state: LiveState } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'cuerpo inválido' };
  const b = body as Record<string, unknown>;
  if (typeof b.scene !== 'string' || !NAMES.includes(b.scene)) return { ok: false, error: 'escena inválida' };
  if (typeof b.index !== 'number' || !Number.isInteger(b.index) || b.index < 0 || b.index > 50) return { ok: false, error: 'índice inválido' };
  const t = b.videoTime ?? null;
  if (t !== null && (typeof t !== 'number' || !Number.isFinite(t) || t < 0)) return { ok: false, error: 'videoTime inválido' };
  return { ok: true, state: { scene: b.scene, index: b.index, videoTime: t, at: now } };
}
