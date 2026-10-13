import { defineConfig } from 'vite';

export default defineConfig({
  build: { outDir: 'dist' },
  test: { environment: 'node' },
} as any);
