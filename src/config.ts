export interface Config {
  relays: string[];
  hashtags: string[];
  /** Max perceived characters per post (truncated with '…'). */
  postMaxChars: number;
  /** Window (hours) of the recent Top 10. */
  topRecentHours: number;
  /** URL encoded in the totem QR (empty = page origin). */
  publicUrl: string;
  /** Settings/version polling interval (ms). */
  settingsPollMs: number;
  /** Video asset; transitions and playback positions come from the server schedule. */
  videoSrc: string;
}

export const defaultConfig: Config = {
  relays: ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net'],
  hashtags: ['lacrypta', 'labitconf'],
  postMaxChars: 210,
  topRecentHours: 3,
  publicUrl: '',
  settingsPollMs: 21000,
  videoSrc: '/video/totem-video.webm',
};

export async function loadConfig(fetchFn: typeof fetch = fetch): Promise<Config> {
  try {
    const res = await fetchFn('/config.json', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = await res.json();
    return { ...defaultConfig, ...Object.fromEntries(Object.entries(raw).filter(([key]) => Object.hasOwn(defaultConfig, key))) };
  } catch (e) {
    console.warn('Could not load config.json, using defaults', e);
    return defaultConfig;
  }
}

/** Public app URL for the QR. */
export const publicUrlOf = (cfg: Config, origin: string) => cfg.publicUrl || `${origin.replace(/\/+$/, '')}/`;

/** Fixed post cutoff (unix s) from `startLine`; undefined if empty or invalid. Does not move over time. */
export const postCutoff = (cfg: { startLine: string }): number | undefined => {
  const ms = cfg.startLine ? Date.parse(cfg.startLine) : NaN;
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : undefined;
};
