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
  /** Sólo se muestran posts de las últimas N horas. */
  postMaxAgeHours: number;
  /** Ventana (horas) del Top 10 reciente. */
  topRecentHours: number;
  /** Flechas ←/→ para cambiar de escena (desactivar en el evento si molesta). */
  keyboardNav: boolean;
  /** URL que codifica el QR del tótem (vacío = origin de la página). */
  publicUrl: string;
  /** Cada cuánto el tótem consulta /api/settings (ms). */
  settingsPollMs: number;
  /** Video de la escena de video (vacío = estado vacío). */
  videoSrc: string;
}

export const defaultConfig: Config = {
  relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
  hashtags: ['lacrypta', 'labitconf'],
  sceneDurations: { post: 15000, latestZaps: 12000 },
  talks: [],
  announcement: '',
  noteUriTemplate: 'nostr:{nevent}',
  postMaxChars: 210,
  postMaxAgeHours: 24,
  topRecentHours: 3,
  keyboardNav: true,
  publicUrl: '',
  settingsPollMs: 4000,
  videoSrc: '/video/totem-video.mp4',
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
