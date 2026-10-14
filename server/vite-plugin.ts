import type { Plugin } from 'vite';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { devDeps, nodeHandler } from './node.js';

/** Monta /api con los mismos handlers (memoria) y /admin → admin.html, en `pnpm dev` y `pnpm preview`. */
export function totemApi(): Plugin {
  let deps: ReturnType<typeof devDeps> | undefined;
  const mw = (req: IncomingMessage, res: ServerResponse, next: () => void) => {
    const path = (req.url ?? '').split('?')[0];
    if (path === '/admin' || path === '/admin/') { req.url = '/admin.html'; return next(); }
    if (!path.startsWith('/api/')) return next();
    nodeHandler(req, res, (deps ??= devDeps())).catch((e) => { res.statusCode = 500; res.end(String(e)); });
  };
  return {
    name: 'totemcillo-api',
    configureServer(s) { s.middlewares.use(mw); },
    configurePreviewServer(s) { s.middlewares.use(mw); },
  };
}
