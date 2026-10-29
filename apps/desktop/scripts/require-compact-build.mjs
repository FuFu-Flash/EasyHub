import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// The file copier omits inlined JavaScript dependencies. Validate the compiled
// output even when electron-builder is invoked without package:win.
export default async context => {
  const root = context.packager.info.appDir;
  try {
    for (const [target, packages] of [
      ['main', ['openai', 'isomorphic-git', 'https-proxy-agent', 'tar', 'yauzl']],
      ['renderer', ['react', 'react-markdown']],
    ]) {
      const notices = await readFile(join(root, 'out', 'windows', target, 'bundled-dependency-notices.txt'), 'utf8');
      if (!notices.includes('Permission is hereby granted') || packages.some(name => !notices.includes(`${name}@`))) {
        throw new Error('Incomplete bundled dependency notices');
      }
    }
  } catch {
    throw new Error('The compact Windows build is missing. Run pnpm package:win before packaging.');
  }
};
