// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FX, installFx } from '../src/fx';
import { LEADER_MS } from '../src/strike';

describe('duraciones de efectos: una sola fuente para JS y CSS', () => {
  it('installFx publica las duraciones como variables CSS', () => {
    installFx(document.documentElement);
    const st = document.documentElement.style;
    expect(st.getPropertyValue('--fx-glow')).toBe(`${FX.glowMs}ms`);
    expect(st.getPropertyValue('--fx-leader')).toBe(`${LEADER_MS}ms`);
    expect(st.getPropertyValue('--fx-drop')).toBe(`${FX.dropMs}ms`);
  });

  it('style.css no repite las duraciones a mano', () => {
    const css = readFileSync('src/style.css', 'utf8');
    expect(css).not.toMatch(/glow 3\.5s|zap-flash 3\.5s|\.25s|ind-drop 2\.2s/);
  });
});
