import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: ['@easyhub/github', 'unified', 'remark-parse', 'remark-stringify', 'remark-gfm'] })],
    build: { outDir: 'out/main' },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload' },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    build: { outDir: resolve(__dirname, 'out/renderer') },
  },
});
