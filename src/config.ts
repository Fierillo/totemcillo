export interface Talk { time: string; title: string; speaker: string }
export interface Config {
  relays: string[];
  hashtags: string[];
  sceneDurations: Record<string, number>;
  postsPerCycle: number;
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
}

export const defaultConfig: Config = {
  relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
  hashtags: ['lacrypta', 'labitconf'],
  sceneDurations: { post: 15000, latestZaps: 12000 },
  postsPerCycle: 3,
  talks: [],
  announcement: '',
  noteUriTemplate: 'nostr:{nevent}',
  postMaxChars: 210,
  postMaxAgeHours: 24,
  topRecentHours: 3,
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
