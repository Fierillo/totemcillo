import { describe, expect, it } from 'vitest';
import { demoEnabled } from '../shared/demo-flag';

describe('demoEnabled: the test buttons only outside production', () => {
  it('on in local dev and on Vercel preview deployments', () => {
    expect(demoEnabled(true, undefined)).toBe(true);
    expect(demoEnabled(false, 'preview')).toBe(true);
  });
  it('never on Vercel production, even if the build is not dev', () => {
    expect(demoEnabled(false, 'production')).toBe(false);
    expect(demoEnabled(true, 'production')).toBe(false);
  });
  it('off in a plain local build (no Vercel env)', () => {
    expect(demoEnabled(false, undefined)).toBe(false);
    expect(demoEnabled(false, 'development')).toBe(false);
  });
});
