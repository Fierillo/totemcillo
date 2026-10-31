import { defineConfig } from 'vite';
import { totemApi } from './server/vite-plugin.ts';
import { demoEnabled } from './shared/demo-flag.ts';

export default defineConfig(({ command }) => ({
  plugins: [totemApi()],
  // Test buttons: dev server and Vercel preview builds only (tree-shaken from production).
  define: { __TOTEM_DEMO__: JSON.stringify(demoEnabled(command === 'serve', process.env.VERCEL_ENV)) },
  // localhost by default; TOTEM_HOST=0.0.0.0 opts into LAN access (then ADMIN_PASSWORD is required).
  server: { host: process.env.TOTEM_HOST || 'localhost', port: 5173 },
  preview: { host: 'localhost' },
  build: { outDir: 'dist', rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
  test: { environment: 'node' },
}) as any);
