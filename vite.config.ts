import { defineConfig } from 'vite';
import { totemApi } from './server/vite-plugin.ts';

export default defineConfig({
  plugins: [totemApi()],
  server: { host: true },
  preview: { host: true },
  build: { outDir: 'dist', rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
  test: { environment: 'node' },
} as any);
