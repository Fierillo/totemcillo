/** Per-session view state (tab, feed post on screen, Top scroll and open rows), restored after reload and every redraw. */
export const MOBILE_VIEW_KEY = 'totemcillo:mobile-view';
export type MobileView = { tab?: string; post?: string; topScroll?: number; open?: string[] };

export const loadView = (): MobileView => { try { return JSON.parse(sessionStorage.getItem(MOBILE_VIEW_KEY) ?? '{}') ?? {}; } catch { return {}; } };
export const storeView = (v: MobileView) => { try { sessionStorage.setItem(MOBILE_VIEW_KEY, JSON.stringify(v)); } catch { /* storage unavailable */ } };
