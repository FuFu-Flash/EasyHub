import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { bundledDependencyNotices } from './scripts/bundled-dependency-notices';

// Mac releases bundle JavaScript once; only the native keyring stays external.
// Keep the upstream Windows build and ordinary development workflow unchanged.
const compactMac = process.platform === 'darwin' && process.env.EASYHUB_MAC_BUNDLE === '1';
const dependencies = Object.keys(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).dependencies);
const bundledDependencies = compactMac
  ? dependencies.filter(name => name !== '@napi-rs/keyring')
  : ['@easyhub/github', 'unified', 'remark-parse', 'remark-stringify', 'remark-gfm'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledDependencies }), ...(compactMac ? [bundledDependencyNotices()] : [])],
    build: { outDir: 'out/main', ...(compactMac ? { minify: 'esbuild' as const } : {}) },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: 'out/preload', ...(compactMac ? { minify: 'esbuild' as const } : {}) },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), ...(compactMac ? [bundledDependencyNotices()] : [])],
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    build: { outDir: resolve(__dirname, 'out/renderer') },
  },
});
