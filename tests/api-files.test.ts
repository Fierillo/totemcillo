import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { handle } from '../server/api';
import { memoryStorage } from '../server/storage';

// Cada ruta que usa el cliente necesita su Function en api/ (en Vercel no hay router común).
const ROUTES = ['time', 'kiosk', 'version', 'settings', 'login', 'logout', 'session', 'moderation'];

describe('Functions de Vercel en api/', () => {
  it.each(ROUTES)('/api/%s tiene su archivo en api/ que delega en el handler común', (r) => {
    const f = `api/${r}.ts`;
    expect(existsSync(f), f).toBe(true);
    expect(readFileSync(f, 'utf8')).toContain("export { default } from '../server/node.js'");
  });
  it('/api/time nunca se cachea', async () => {
    const r = await handle({ method: 'GET', path: '/api/time', headers: {}, body: undefined, ip: '1.1.1.1' },
      { storage: memoryStorage(), env: {}, now: () => 123 });
    expect(r.status).toBe(200);
    expect(r.headers['cache-control']).toBe('no-store');
  });
});
