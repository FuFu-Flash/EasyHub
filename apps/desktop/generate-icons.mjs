import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright-core';
import electronPath from 'electron';

const desktopDir = dirname(fileURLToPath(import.meta.url));
const sourcePath = join(desktopDir, 'src/renderer/src/assets/easyhub-icon.svg');
const resourcesDir = join(desktopDir, 'resources');
const svg = await readFile(sourcePath, 'utf8');
const app = await electron.launch({ executablePath: electronPath, args: ['.'], cwd: desktopDir });

try {
  const page = await app.firstWindow();
  const rendered = await page.evaluate(async (source) => {
    const image = new Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(source)}`;
    await image.decode();
    return [16, 32, 48, 256].map((size) => {
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const context = canvas.getContext('2d');
      if (!context) throw new Error('无法创建图标画布');
      context.drawImage(image, 0, 0, size, size);
      return { size, png: canvas.toDataURL('image/png').split(',')[1] };
    });
  }, svg);

  const images = rendered.map(({ size, png }) => ({ size, data: Buffer.from(png, 'base64') }));
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, data }, index) => {
    const entry = 6 + index * 16;
    header.writeUInt8(size === 256 ? 0 : size, entry);
    header.writeUInt8(size === 256 ? 0 : size, entry + 1);
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(data.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += data.length;
  });

  await mkdir(resourcesDir, { recursive: true });
  await writeFile(join(resourcesDir, 'easyhub.png'), images.at(-1).data);
  await writeFile(join(resourcesDir, 'easyhub.ico'), Buffer.concat([header, ...images.map((image) => image.data)]));
  process.stdout.write('Generated EasyHub PNG and Windows ICO from the supplied SVG.\n');
} finally {
  await app.close();
}
