const { existsSync } = require('node:fs');
const { join, normalize, parse } = require('node:path');

function targetPath(value, previous) {
  if (typeof value !== 'string' || value.length > 240 || !/^[A-Za-z]:\\/.test(value)) throw new Error('请选择有效的安装位置。');
  const full = normalize(value.trim());
  const root = parse(full).root;
  if (full === root) throw new Error('请在磁盘中选择文件夹。');
  if (full.toLowerCase() === previous.toLowerCase()) return full;
  if (full.split('\\').at(-1)?.toLowerCase() === 'easyhub' || existsSync(join(full, 'EasyHub.exe'))) return full;
  return join(full, 'EasyHub');
}

module.exports = { targetPath };
