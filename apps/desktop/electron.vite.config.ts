import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import { bundledDependencyNotices } from './scripts/bundled-dependency-notices';

// Release builds inline JavaScript dependencies and retain the native keyring.
// Each release flag is restricted to its platform; ordinary development stays unchanged.
const compactRelease = (process.platform === 'darwin' && process.env.EASYHUB_MAC_BUNDLE === '1')
  || (process.platform === 'win32' && process.env.EASYHUB_WIN_BUNDLE === '1')
  || (process.platform === 'linux' && process.env.EASYHUB_LINUX_BUNDLE === '1');
const releaseDirectory = process.platform === 'darwin' ? 'macos' : process.platform === 'linux' ? 'linux' : 'windows';
const output = compactRelease ? `out/${releaseDirectory}` : 'out';
const dependencies = Object.keys(JSON.parse(readFileSync(resolve(__dirname, 'package.json'), 'utf8')).dependencies);
const bundledDependencies = compactRelease
  ? dependencies.filter(name => name !== '@napi-rs/keyring')
  : ['@easyhub/github', 'unified', 'remark-parse', 'remark-stringify', 'remark-gfm'];

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({ exclude: bundledDependencies }), ...(compactRelease ? [bundledDependencyNotices()] : [])],
    build: { outDir: `${output}/main`, ...(compactRelease ? { minify: 'esbuild' as const } : {}) },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: { outDir: `${output}/preload`, ...(compactRelease ? { minify: 'esbuild' as const } : {}) },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react(), ...(compactRelease ? [bundledDependencyNotices()] : [])],
    resolve: { alias: { '@': resolve(__dirname, 'src/renderer/src') } },
    build: { outDir: resolve(__dirname, output, 'renderer') },
  },
});
