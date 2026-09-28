const bridge = window.easyHubInstaller;
const $ = (id) => document.getElementById(id);
let installing = false;

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function showState(name) {
  for (const state of ['form', 'progress', 'done']) $(`${state}-state`).hidden = state !== name;
}

bridge.state().then((state) => {
  $('path').value = state.path;
  $('path-hint').textContent = state.previous
    ? '已找到之前的安装位置，将继续安装到同一位置。'
    : '首次安装优先选择其他固定磁盘，安装时会自动创建 EasyHub 文件夹。';
}).catch(() => showError('无法读取安装位置，请手动选择文件夹。'));

$('browse').addEventListener('click', async () => {
  try {
    const path = await bridge.chooseFolder($('path').value);
    if (path) { $('path').value = path; showError(''); }
  } catch { showError('无法打开文件夹选择窗口。'); }
});

$('install').addEventListener('click', async () => {
  if (installing) return;
  installing = true;
  showError('');
  showState('progress');
  try {
    const result = await bridge.install($('path').value, $('shortcut').checked);
    $('installed-path').textContent = result.path;
    showState('done');
  } catch (error) {
    showState('form');
    showError(error?.message?.replace(/^Error invoking remote method '[^']+': Error: /u, '') || '安装未完成，请重试。');
  } finally { installing = false; }
});

bridge.onProgress((message) => { $('progress-message').textContent = message; });
$('open-app').addEventListener('click', () => { void bridge.openApp().catch((error) => {
  $('done-error').textContent = error?.message?.replace(/^Error invoking remote method '[^']+': Error: /u, '') || '无法打开 EasyHub。';
  $('done-error').hidden = false;
}); });
$('done-close').addEventListener('click', () => { void bridge.close(); });
$('minimize').addEventListener('click', () => { void bridge.minimize(); });
$('close').addEventListener('click', () => { if (!installing) void bridge.close(); });
