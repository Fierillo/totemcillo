export const SCENES = ['post', 'latestZaps', 'top10Historico', 'top10Ultimas3h', 'anuncio'] as const;
export type Action = 'next' | 'prev';
export interface Settings {
  announcement: string;
  sceneDurations: Record<string, number>;
  command: { seq: number; action: Action | null };
  /** The video appears once every N cycles (if missing, config.json applies). */
  videoEveryCycles?: number;
  videoMode?: 'full' | 'clip';
  videoClipSeconds?: number;
  /** Actual video duration (s), for the server schedule. */
  videoDurationSec?: number;
  /** Schedule start (ms); managed only by the server. */
  epoch?: number;
  /** Incremented on every admin change (arrows included); the totem checks it cheaply. */
  version?: number;
  /** Moderation: hidden post ids and banned pubkeys (hex, lowercase). */
  hiddenPosts?: string[];
  bannedPubkeys?: string[];
  /** Only zaps whose LNURL (the one signing the receipt) belongs to one of these domains or subdomains count. */
  zapProviders?: string[];
  /** Start line (ISO with zone): only posts and zaps from here on count. */
  startLine?: string;
}
export const DEFAULT_ZAP_PROVIDERS = ['getalby.com', 'primal.net', 'walletofsatoshi.com', 'lawallet.ar', 'lawallet.io', 'blink.sv', 'coinos.io', 'strike.me'];
export const DEFAULT_START_LINE = '2026-10-13T00:00:00-03:00';
export const DEFAULT_SETTINGS: Settings = { announcement: '', sceneDurations: {}, command: { seq: 0, action: null }, zapProviders: DEFAULT_ZAP_PROVIDERS, startLine: DEFAULT_START_LINE };
/** Default duration of each scene (ms). */
export const DEFAULT_SCENE_MS: Record<string, number> = { post: 21000, latestZaps: 21000, top10Historico: 21000, top10Ultimas3h: 21000, anuncio: 21000 };
export const LIMITS = { maxAnnouncement: 280, minMs: 3000, maxMs: 120000, minEveryCycles: 1, maxEveryCycles: 10, minClipSeconds: 3, maxClipSeconds: 120, maxVideoSec: 3600, maxModeration: 1000, maxZapProviders: 100, maxStartLineAheadDays: 365 };

export interface Patch { announcement?: string; sceneDurations?: Record<string, number>; command?: Action; videoEveryCycles?: number; videoMode?: 'full' | 'clip'; videoClipSeconds?: number; videoDurationSec?: number ; zapProviders?: string[]; startLine?: string }

/** Validates the PUT body; any invalid field rejects the whole request. */
export function validatePatch(body: unknown, now = Date.now()): { ok: true; patch: Patch } | { ok: false; error: string } {
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
  if ('videoDurationSec' in b) {
    const n = b.videoDurationSec;
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > LIMITS.maxVideoSec)
      return { ok: false, error: `videoDurationSec debe ser un número de 1 a ${LIMITS.maxVideoSec}` };
    patch.videoDurationSec = n;
  }
  if ('zapProviders' in b) {
    const l = b.zapProviders;
    if (!Array.isArray(l) || l.length > LIMITS.maxZapProviders) return { ok: false, error: `zapProviders: lista de hasta ${LIMITS.maxZapProviders} dominios` };
    const out: string[] = [];
    for (const x of l) {
      const h = typeof x === 'string' ? x.trim().toLowerCase() : '';
      if (!isHostname(h)) return { ok: false, error: `dominio inválido: ${String(x).slice(0, 80)}` };
      if (!out.includes(h)) out.push(h);
    }
    patch.zapProviders = out;
  }
  if ('startLine' in b) {
    const v = typeof b.startLine === 'string' ? b.startLine.trim() : '';
    const ms = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v) ? Date.parse(v) : NaN;
    if (!Number.isFinite(ms) || ms < Date.parse('2020-01-01T00:00:00Z') || ms > now + LIMITS.maxStartLineAheadDays * 86_400_000)
      return { ok: false, error: 'startLine: fecha y hora ISO con zona, entre 2020 y un año desde hoy' };
    patch.startLine = v;
  }
  return { ok: true, patch };
}

/** Hostname with at least two labels (no scheme, port, path or user). */
export const isHostname = (h: string) =>
  h.length <= 253 && /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(h);

export function applyPatch(s: Settings, p: Patch): Settings {
  return {
    announcement: p.announcement ?? s.announcement,
    sceneDurations: p.sceneDurations ? { ...s.sceneDurations, ...p.sceneDurations } : s.sceneDurations,
    command: p.command ? { seq: s.command.seq + 1, action: p.command } : s.command,
    ...((p.videoEveryCycles ?? s.videoEveryCycles) !== undefined ? { videoEveryCycles: p.videoEveryCycles ?? s.videoEveryCycles } : {}),
    ...((p.videoMode ?? s.videoMode) !== undefined ? { videoMode: p.videoMode ?? s.videoMode } : {}),
    ...((p.videoClipSeconds ?? s.videoClipSeconds) !== undefined ? { videoClipSeconds: p.videoClipSeconds ?? s.videoClipSeconds } : {}),
    ...((p.videoDurationSec ?? s.videoDurationSec) !== undefined ? { videoDurationSec: p.videoDurationSec ?? s.videoDurationSec } : {}),
    ...(s.epoch !== undefined ? { epoch: s.epoch } : {}),
    ...(s.version !== undefined ? { version: s.version } : {}),
    ...(s.hiddenPosts ? { hiddenPosts: s.hiddenPosts } : {}),
    ...(s.bannedPubkeys ? { bannedPubkeys: s.bannedPubkeys } : {}),
    ...((p.zapProviders ?? s.zapProviders) ? { zapProviders: p.zapProviders ?? s.zapProviders } : {}),
    ...((p.startLine ?? s.startLine) ? { startLine: p.startLine ?? s.startLine } : {}),
  };
}

export type ModAction = 'hide' | 'unhide' | 'ban' | 'unban';
const MOD_LIST = { hide: 'hiddenPosts', unhide: 'hiddenPosts', ban: 'bannedPubkeys', unban: 'bannedPubkeys' } as const;

/** Applies a moderation action (64-hex id/pubkey). Returns an error if invalid or the list is full. */
export function applyModeration(s: Settings, body: unknown): { ok: true; settings: Settings } | { ok: false; error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as { action?: unknown; id?: unknown };
  if (typeof b.action !== 'string' || !(b.action in MOD_LIST)) return { ok: false, error: 'acción inválida' };
  if (typeof b.id !== 'string' || !/^[0-9a-f]{64}$/i.test(b.id)) return { ok: false, error: 'id inválido (64 hex)' };
  const action = b.action as ModAction, id = b.id.toLowerCase(), key = MOD_LIST[action];
  const cur = s[key] ?? [];
  let next = cur;
  if (action === 'hide' || action === 'ban') {
    if (!cur.includes(id)) {
      if (cur.length >= LIMITS.maxModeration) return { ok: false, error: `lista llena (máx. ${LIMITS.maxModeration})` };
      next = [...cur, id];
    }
  } else next = cur.filter((x) => x !== id);
  return { ok: true, settings: { ...s, [key]: next } };
}
