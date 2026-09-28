const { app, BrowserWindow, dialog, ipcMain, Menu } = require('electron');
const { execFile, spawn } = require('node:child_process');
const { existsSync } = require('node:fs');
const { readdir } = require('node:fs/promises');
const { join } = require('node:path');
const { promisify } = require('node:util');
const { targetPath } = require('./path.cjs');

const execFileAsync = promisify(execFile);
const registryKey = 'Software\\ebd6f51a-0651-5201-90c0-182908705a0a';
let window = null;
let installPath = '';
let installing = false;

async function registryPath(hive) {
  try {
    const { stdout } = await execFileAsync('reg.exe', ['query', `${hive}\\${registryKey}`, '/v', 'InstallLocation'],
      { windowsHide: true, timeout: 4000 });
    const match = stdout.match(/^\s*InstallLocation\s+REG_\w+\s+(.+?)\s*$/im);
    return match?.[1]?.trim() || '';
  } catch { return ''; }
}

async function previousPath() {
  return await registryPath('HKCU') || await registryPath('HKLM');
}

async function preferredPath() {
  const previous = await previousPath();
  if (previous) return { path: previous, previous: true };
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '(Get-CimInstance Win32_LogicalDisk -Filter "DriveType=3" | Select-Object -ExpandProperty DeviceID) -join ","'],
    { windowsHide: true, timeout: 5000 });
    const drives = stdout.trim().split(',').map((value) => value.toUpperCase());
    const drive = ['D:', 'E:', 'F:'].find((value) => drives.includes(value));
    if (drive) return { path: `${drive}\\EasyHub`, previous: false };
  } catch { /* Use a per-user folder when drive enumeration is unavailable. */ }
  return { path: join(app.getPath('appData'), '..', 'Local', 'Programs', 'EasyHub'), previous: false };
}

function trusted(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
    throw new Error('操作来源无效。');
  }
}

function progress(message) {
  if (window && !window.isDestroyed()) window.webContents.send('installer:progress', message);
}

async function installCore(path, desktopShortcut) {
  const core = join(process.resourcesPath, 'core-installer.exe');
  if (!existsSync(core)) throw new Error('安装文件不完整，请重新下载安装程序。');
  const args = ['/S'];
  if (!desktopShortcut) args.push('/NO_DESKTOP_SHORTCUT=1');
  args.push(`/D=${path}`);
  await new Promise((resolve, reject) => {
    const child = spawn(core, args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', (code) => code === 0 ? resolve() : reject(new Error('安装没有完成，请检查磁盘空间或安装位置后重试。')));
  });
  if (!existsSync(join(path, 'EasyHub.exe'))) throw new Error('没有找到已安装的 EasyHub，请重试。');
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 900, height: 620, minWidth: 900, minHeight: 620,
    resizable: false, frame: false, show: false, backgroundColor: '#f4f7fc',
    icon: join(process.resourcesPath, 'easyhub.ico'),
    webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true,
      nodeIntegration: false, sandbox: true },
  });
  window.once('ready-to-show', () => window.show());
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event) => event.preventDefault());
  void window.loadFile(join(__dirname, 'index.html'));

  ipcMain.handle('installer:state', async (event) => { trusted(event); return preferredPath(); });
  ipcMain.handle('installer:choose-folder', async (event, current) => {
    trusted(event);
    const result = await dialog.showOpenDialog(window, { title: '选择安装位置',
      defaultPath: typeof current === 'string' && current.length < 241 ? current : undefined,
      properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0] || null;
  });
  ipcMain.handle('installer:install', async (event, rawPath, desktopShortcut) => {
    trusted(event);
    if (installing || typeof desktopShortcut !== 'boolean') throw new Error('安装操作无效。');
    const previous = await previousPath();
    const path = targetPath(rawPath, previous);
    const entries = await readdir(path).catch((error) => error.code === 'ENOENT' ? [] : Promise.reject(error));
    if (entries.length && !entries.includes('EasyHub.exe') && path.toLowerCase() !== previous.toLowerCase()) {
      throw new Error('这个文件夹已有其他内容，请选择空文件夹。');
    }
    installing = true;
    try {
      progress('正在准备安装文件…');
      installPath = path;
      progress('正在安装 EasyHub…');
      await installCore(path, desktopShortcut);
      progress('安装完成');
      return { path };
    } finally { installing = false; }
  });
  ipcMain.handle('installer:open-app', async (event) => {
    trusted(event);
    if (!installPath || !existsSync(join(installPath, 'EasyHub.exe'))) throw new Error('请先完成安装。');
    await new Promise((resolve, reject) => {
      const child = spawn(join(installPath, 'EasyHub.exe'), [], { detached: true, stdio: 'ignore', cwd: installPath });
      child.once('spawn', () => { child.unref(); resolve(); });
      child.once('error', () => reject(new Error('无法打开 EasyHub，请从安装文件夹重新启动。')));
    });
    window.close();
  });
  ipcMain.handle('installer:minimize', (event) => { trusted(event); window.minimize(); });
  ipcMain.handle('installer:close', (event) => { trusted(event); if (!installing) window.close(); });
});

app.on('window-all-closed', () => app.quit());
