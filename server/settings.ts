export const SCENES = ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio'] as const;
export type Action = 'next' | 'prev';
export interface Settings {
  announcement: string;
  sceneDurations: Record<string, number>;
  command: { seq: number; action: Action | null };
  /** El video aparece una de cada N vueltas (si falta, rige config.json). */
  videoEveryCycles?: number;
  videoMode?: 'full' | 'clip';
  videoClipSeconds?: number;
}
export const DEFAULT_SETTINGS: Settings = { announcement: '', sceneDurations: {}, command: { seq: 0, action: null } };
/** Duraciones por defecto de cada escena (ms). */
export const DEFAULT_SCENE_MS: Record<string, number> = { post: 21000, latestZaps: 21000, top10Historico: 21000, top10Ultimas3h: 21000, anuncio: 21000 };
export const LIMITS = { maxAnnouncement: 280, minMs: 3000, maxMs: 120000, minEveryCycles: 1, maxEveryCycles: 10, minClipSeconds: 3, maxClipSeconds: 120 };

export interface Patch { announcement?: string; sceneDurations?: Record<string, number>; command?: Action; videoEveryCycles?: number; videoMode?: 'full' | 'clip'; videoClipSeconds?: number }

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
  if ('videoEveryCycles' in b) {
    const n = b.videoEveryCycles;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < LIMITS.minEveryCycles || n > LIMITS.maxEveryCycles)
      return { ok: false, error: `videoEveryCycles debe ser un entero de ${LIMITS.minEveryCycles} a ${LIMITS.maxEveryCycles}` };
    patch.videoEveryCycles = n;
  }
  if ('videoMode' in b) {
    if (b.videoMode !== 'full' && b.videoMode !== 'clip') return { ok: false, error: 'videoMode debe ser full o clip' };
    patch.videoMode = b.videoMode;
  }
  if ('videoClipSeconds' in b) {
    const n = b.videoClipSeconds;
    if (typeof n !== 'number' || !Number.isInteger(n) || n < LIMITS.minClipSeconds || n > LIMITS.maxClipSeconds)
      return { ok: false, error: `videoClipSeconds debe ser un entero de ${LIMITS.minClipSeconds} a ${LIMITS.maxClipSeconds}` };
    patch.videoClipSeconds = n;
  }
  return { ok: true, patch };
}

export function applyPatch(s: Settings, p: Patch): Settings {
  return {
    announcement: p.announcement ?? s.announcement,
    sceneDurations: p.sceneDurations ? { ...s.sceneDurations, ...p.sceneDurations } : s.sceneDurations,
    command: p.command ? { seq: s.command.seq + 1, action: p.command } : s.command,
    ...((p.videoEveryCycles ?? s.videoEveryCycles) !== undefined ? { videoEveryCycles: p.videoEveryCycles ?? s.videoEveryCycles } : {}),
    ...((p.videoMode ?? s.videoMode) !== undefined ? { videoMode: p.videoMode ?? s.videoMode } : {}),
    ...((p.videoClipSeconds ?? s.videoClipSeconds) !== undefined ? { videoClipSeconds: p.videoClipSeconds ?? s.videoClipSeconds } : {}),
  };
}
