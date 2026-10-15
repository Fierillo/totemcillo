import { defineConfig } from 'vite';
import { totemApi } from './server/vite-plugin.ts';

export default defineConfig({
  plugins: [totemApi()],
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: 'localhost' },
  build: { outDir: 'dist', rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
  test: { environment: 'node' },
} as any);
