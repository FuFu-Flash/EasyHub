import { chromium } from 'playwright-core';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));

// The Windows SVG stays the source of truth for the plant on both platforms.
async function main() {
  const source = path.join(currentDirectory, 'src', 'renderer', 'src', 'assets', 'easyhub-potted-plant.svg');
  const target = path.join(currentDirectory, '..', 'mobile', 'assets', 'images', 'potted-plant.png');
  const plant = await readFile(source);
  const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 512, height: 512 }, deviceScaleFactor: 1 });
    await page.setContent(`<html><body style="margin:0;background:transparent"><img width="512" height="512" src="data:image/svg+xml;base64,${plant.toString('base64')}"></body></html>`);
    await page.locator('img').evaluate((image) => image.decode());
    await page.screenshot({ path: target, omitBackground: true });
  } finally {
    await browser.close();
  }
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
