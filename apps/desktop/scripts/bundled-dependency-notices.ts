import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, parse } from 'node:path';
import type { Plugin } from 'vite';

/** Retain declarations and every supplied license text when dependencies are inlined. */
export function bundledDependencyNotices(): Plugin {
  return {
    name: 'easyhub:bundled-dependency-notices',
    generateBundle() {
      const packages = new Map<string, string>();
      for (const id of this.getModuleIds()) {
        if (id.startsWith('\0') || !id.includes('/node_modules/') || !this.getModuleInfo(id)?.isIncluded) continue;
        let directory = dirname(id.split('?')[0]!);
        while (directory !== parse(directory).root) {
          const metadataPath = join(directory, 'package.json');
          if (existsSync(metadataPath)) {
            const metadata = JSON.parse(readFileSync(metadataPath, 'utf8'));
            if (metadata.name && metadata.version) {
              const name = `${metadata.name}@${metadata.version}`;
              if (!packages.has(name)) {
                const licenses = readdirSync(directory).filter(file => /^(licen[cs]e|notice|copying)(\.|$)/i.test(file)).sort();
                const repository = typeof metadata.repository === 'string' ? metadata.repository : metadata.repository?.url;
                packages.set(name, [name, `License: ${metadata.license ?? 'See license text'}`,
                  ...(metadata.author ? [`Author: ${typeof metadata.author === 'string' ? metadata.author : metadata.author.name}`] : []),
                  ...(repository ? [`Repository: ${repository}`] : []),
                  ...licenses.map(file => `\n${file}\n${readFileSync(join(directory, file), 'utf8')}`)].join('\n'));
              }
              break;
            }
          }
          directory = dirname(directory);
        }
      }
      this.emitFile({ type: 'asset', fileName: 'bundled-dependency-notices.txt',
        source: [...packages].sort(([a], [b]) => a.localeCompare(b)).map(([, text]) => text).join('\n\n----------\n\n') + '\n' });
    },
  };
}
