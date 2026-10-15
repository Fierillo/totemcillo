export interface Talk { time: string; title: string; speaker: string }
export interface Config {
  relays: string[];
  hashtags: string[];
  sceneDurations: Record<string, number>;
  talks: Talk[];
  announcement: string;
  /** QR URI for each post; {nevent} is replaced. E.g. 'https://njump.me/{nevent}'. */
  noteUriTemplate: string;
  /** Max perceived characters per post (truncated with '…'). */
  postMaxChars: number;
  /** Fixed start line (ISO with offset): only posts from this instant. Empty = no limit. */
  startLine: string;
  /** Window (hours) of the recent Top 10. */
  topRecentHours: number;
  /** ←/→ arrows to change scene (disable at the event if it gets in the way). */
  keyboardNav: boolean;
  /** URL encoded in the totem QR (empty = page origin). */
  publicUrl: string;
  /** How often the totem polls /api/settings (ms). */
  settingsPollMs: number;
  /** Video for the video scene; moves to the next scene when it ends (empty = empty state). */
  videoSrc: string;
  /** The video appears in the automatic rotation once every N cycles. */
  videoEveryCycles: number;
  /** full: the whole video; clip: `videoClipSeconds` s from a random point. */
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
  settingsPollMs: 21000,
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
    console.warn('Could not load config.json, using defaults', e);
    return defaultConfig;
  }
}

/** Public app URL for the QR. */
export const publicUrlOf = (cfg: Config, origin: string) => cfg.publicUrl || `${origin.replace(/\/+$/, '')}/`;

/** Fixed post cutoff (unix s) from `startLine`; undefined if empty or invalid. Does not move over time. */
export const postCutoff = (cfg: Pick<Config, 'startLine'>): number | undefined => {
  const ms = cfg.startLine ? Date.parse(cfg.startLine) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
};
