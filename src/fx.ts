import { LEADER_MS } from './strike';

/** Live-effect timings: the single source for JS (redraw continuation) and CSS (via --fx-* variables). */
export const FX = { glowMs: 3500, leaderMs: LEADER_MS, dropMs: 2200 } as const; // dropMs: phone off-screen indicator

/** Publishes FX as CSS variables (--fx-glow, --fx-leader, --fx-drop) on `root`; call once at startup. */
export function installFx(root: HTMLElement): void {
  root.style.setProperty('--fx-glow', `${FX.glowMs}ms`);
  root.style.setProperty('--fx-leader', `${FX.leaderMs}ms`);
  root.style.setProperty('--fx-drop', `${FX.dropMs}ms`);
}
