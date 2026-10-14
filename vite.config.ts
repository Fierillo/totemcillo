import { defineConfig } from 'vite';
import { totemApi } from './server/vite-plugin.ts';

export default defineConfig({
  plugins: [totemApi()],
  build: { outDir: 'dist', rollupOptions: { input: { main: 'index.html', admin: 'admin.html' } } },
  test: { environment: 'node' },
} as any);
