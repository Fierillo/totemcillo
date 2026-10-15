export interface Talk { time: string; title: string; speaker: string }
export interface Config {
  relays: string[];
  hashtags: string[];
  sceneDurations: Record<string, number>;
  talks: Talk[];
  announcement: string;
  /** URI del QR de cada post; {nevent} se reemplaza. Ej: 'https://njump.me/{nevent}'. */
  noteUriTemplate: string;
  /** Máximo de caracteres percibidos por post (se trunca con '…'). */
  postMaxChars: number;
  /** Línea de largada fija (ISO con offset): sólo posts desde este instante. Vacío = sin límite. */
  startLine: string;
  /** Ventana (horas) del Top 10 reciente. */
  topRecentHours: number;
  /** Flechas ←/→ para cambiar de escena (desactivar en el evento si molesta). */
  keyboardNav: boolean;
  /** URL que codifica el QR del tótem (vacío = origin de la página). */
  publicUrl: string;
  /** Cada cuánto el tótem consulta /api/settings (ms). */
  settingsPollMs: number;
  /** Video de la escena de video; se pasa a la siguiente escena cuando termina (vacío = estado vacío). */
  videoSrc: string;
  /** El video aparece en la rotación automática una de cada N vueltas. */
  videoEveryCycles: number;
  /** full: el video entero; clip: `videoClipSeconds` s desde un punto al azar. */
  videoMode: 'full' | 'clip';
  videoClipSeconds: number;
}

export const defaultConfig: Config = {
  relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
  hashtags: ['lacrypta', 'labitconf'],
  sceneDurations: { post: 21000, latestZaps: 21000, top10Historico: 21000, top10Ultimas3h: 21000, anuncio: 21000 },
  talks: [],
  announcement: '',
  noteUriTemplate: 'nostr:{nevent}',
  postMaxChars: 210,
  startLine: '2026-10-13T00:00:00-03:00',
  topRecentHours: 3,
  keyboardNav: true,
  publicUrl: '',
  settingsPollMs: 4000,
  videoSrc: '/video/totem-video.webm',
  videoEveryCycles: 2,
  videoMode: 'full',
  videoClipSeconds: 21,
};

export async function loadConfig(fetchFn: typeof fetch = fetch): Promise<Config> {
  try {
    const res = await fetchFn('/config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { ...defaultConfig, ...(await res.json()) };
  } catch (e) {
    console.warn('No se pudo cargar config.json, uso defaults', e);
    return defaultConfig;
  }
}

/** URL pública de la app para el QR. */
export const publicUrlOf = (cfg: Config, origin: string) => cfg.publicUrl || `${origin.replace(/\/+$/, '')}/`;

/** Corte fijo de posts (unix s) a partir de `startLine`; undefined si vacío o inválido. No se mueve con el tiempo. */
export const postCutoff = (cfg: Pick<Config, 'startLine'>): number | undefined => {
  const ms = cfg.startLine ? Date.parse(cfg.startLine) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
};
