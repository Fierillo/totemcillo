export const SCENES = ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio'] as const;
export type Action = 'next' | 'prev';
export interface Settings {
  announcement: string;
  sceneDurations: Record<string, number>;
  command: { seq: number; action: Action | null };
}
export const DEFAULT_SETTINGS: Settings = { announcement: '', sceneDurations: {}, command: { seq: 0, action: null } };
/** Duraciones por defecto de cada escena (ms). */
export const DEFAULT_SCENE_MS: Record<string, number> = { post: 15000, latestZaps: 12000, top10Historico: 12000, top10Ultimas3h: 12000, anuncio: 10000 };
export const LIMITS = { maxAnnouncement: 280, minMs: 3000, maxMs: 120000 };

export interface Patch { announcement?: string; sceneDurations?: Record<string, number>; command?: Action }

/** Valida el cuerpo del PUT; cualquier campo inválido rechaza todo. */
export function validatePatch(body: unknown): { ok: true; patch: Patch } | { ok: false; error: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { ok: false, error: 'cuerpo inválido' };
  const b = body as Record<string, unknown>;
  const patch: Patch = {};
  if ('announcement' in b) {
    if (typeof b.announcement !== 'string') return { ok: false, error: 'anuncio inválido' };
    const a = b.announcement.trim();
    if ([...a].length > LIMITS.maxAnnouncement) return { ok: false, error: `anuncio de más de ${LIMITS.maxAnnouncement} caracteres` };
    patch.announcement = a;
  }
  if ('sceneDurations' in b) {
    const d = b.sceneDurations;
    if (!d || typeof d !== 'object' || Array.isArray(d)) return { ok: false, error: 'duraciones inválidas' };
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(d)) {
      if (!(SCENES as readonly string[]).includes(k)) return { ok: false, error: `escena desconocida: ${k}` };
      if (typeof v !== 'number' || !Number.isInteger(v) || v < LIMITS.minMs || v > LIMITS.maxMs) return { ok: false, error: `duración fuera de rango: ${k}` };
      out[k] = v;
    }
    patch.sceneDurations = out;
  }
  if ('command' in b) {
    if (b.command !== 'next' && b.command !== 'prev') return { ok: false, error: 'comando inválido' };
    patch.command = b.command;
  }
  return { ok: true, patch };
}

export function applyPatch(s: Settings, p: Patch): Settings {
  return {
    announcement: p.announcement ?? s.announcement,
    sceneDurations: p.sceneDurations ? { ...s.sceneDurations, ...p.sceneDurations } : s.sceneDurations,
    command: p.command ? { seq: s.command.seq + 1, action: p.command } : s.command,
  };
}
