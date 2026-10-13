export interface Talk { time: string; title: string; speaker: string }
export interface Config {
  relays: string[];
  hashtags: string[];
  sceneDurations: Record<string, number>;
  postsPerCycle: number;
  talks: Talk[];
  announcement: string;
}

export const defaultConfig: Config = {
  relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
  hashtags: ['lacrypta', 'labitconf'],
  sceneDurations: { post: 15000, latestZaps: 12000 },
  postsPerCycle: 3,
  talks: [],
  announcement: '',
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
