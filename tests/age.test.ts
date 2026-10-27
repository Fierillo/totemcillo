import { describe, expect, it } from 'vitest';
import { age } from '../src/util';

describe('age (boxes)', () => {
  it('abbreviates seconds, minutes, hours and days', () => {
    const now = Date.now() / 1000;
    expect([50, 44 * 60, 12 * 3600, 3 * 86400].map((d) => age(now - d))).toEqual(['50 s', '44 m', '12 h', '3 d']);
  });
});
