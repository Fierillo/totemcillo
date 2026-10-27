/** Data needed to render a scene at the position fixed by the shared schedule. */
interface RenderContext {
  elapsedMs?: number;
  expectedSec?: () => number;
}

export interface Scene {
  name: string;
  render: (root: HTMLElement, ctx?: RenderContext) => void | (() => void);
}
