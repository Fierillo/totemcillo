import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { createPool, RELAY_CONNECT_TIMEOUT_MS } from '../src/nostr/pool';

// Real posts lived only on slow relays (nostrelites.org, bitcoiner.social…) that take ~5 s to
// connect when the browser opens ~28 sockets at once; nostr-tools' default 3 s connection
// timeout dropped them, so a fresh store (the /admin panel) never received them.
describe('pool de relays', () => {
  it('espera lo suficiente a que conecten los relays lentos', () => {
    expect(RELAY_CONNECT_TIMEOUT_MS).toBeGreaterThanOrEqual(10_000);
    expect((createPool() as any).maxWaitForConnection).toBe(RELAY_CONNECT_TIMEOUT_MS);
  });
  it('el tótem y el admin usan el mismo pool (no SimplePool con defaults)', () => {
    for (const f of ['src/main.ts', 'src/admin.ts']) {
      const src = readFileSync(f, 'utf8');
      expect(src, f).toMatch(/createPool\(\)/);
      expect(src, f).not.toMatch(/new SimplePool\(/);
    }
  });
});
