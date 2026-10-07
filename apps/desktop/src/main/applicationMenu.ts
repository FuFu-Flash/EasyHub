import type { MenuItemConstructorOptions } from 'electron';
import { canRunMenuCommand, type MenuCommand, type MenuState } from '../shared/applicationMenu';

export const PROJECT_URL = 'https://github.com/FuFu-Flash/EasyHub';
export const FEEDBACK_URL = 'https://github.com/FuFu-Flash/EasyHub/issues/new/choose';

interface ApplicationMenuActions {
  command: (command: MenuCommand) => void;
  showWindow: () => void;
  openExternal: (url: string) => void;
}

export function createApplicationMenuTemplate(state: MenuState, rendererReady: boolean, actions: ApplicationMenuActions): MenuItemConstructorOptions[] {
  const label = (zh: string, en: string): string => state.language === 'zh' ? zh : en;
  const command = (id: MenuCommand, zh: string, en: string, accelerator?: string): MenuItemConstructorOptions => ({
    id: `easyhub-${id}`, label: label(zh, en), ...(accelerator ? { accelerator } : {}),
    enabled: canRunMenuCommand(id, state) && (rendererReady || id === 'settings' || id === 'proxy-settings'),
    click: () => actions.command(id),
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  return [
    { id: 'easyhub-app-menu', label: 'EasyHub', submenu: [
      { id: 'easyhub-about', label: label('关于 EasyHub', 'About EasyHub'), role: 'about' },
      separator,
      command('settings', '设置…', 'Settings…', 'Command+,'),
      separator,
      { label: label('服务', 'Services'), role: 'services', submenu: [] },
      separator,
      { label: label('隐藏 EasyHub', 'Hide EasyHub'), role: 'hide', accelerator: 'Command+H' },
      { label: label('隐藏其他', 'Hide Others'), role: 'hideOthers', accelerator: 'Command+Alt+H' },
      { label: label('显示全部', 'Show All'), role: 'unhide' },
      separator,
      { label: label('退出 EasyHub', 'Quit EasyHub'), role: 'quit', accelerator: 'Command+Q' },
    ] },
    { id: 'easyhub-file-menu', label: label('文件', 'File'), submenu: [
      command('new-project', '新建项目…', 'New Project…', 'Command+N'),
      command('add-folder', '添加文件夹…', 'Add Folder…', 'Command+O'),
      command('download-project', '从 GitHub 下载项目…', 'Download Project from GitHub…', 'Command+Shift+O'),
      separator,
      { label: label('关闭窗口', 'Close Window'), role: 'close', accelerator: 'Command+W' },
    ] },
    { id: 'easyhub-edit-menu', label: label('编辑', 'Edit'), submenu: [
      { label: label('撤销', 'Undo'), role: 'undo', accelerator: 'Command+Z' },
      { label: label('重做', 'Redo'), role: 'redo', accelerator: 'Command+Shift+Z' },
      separator,
      { label: label('剪切', 'Cut'), role: 'cut', accelerator: 'Command+X' },
      { label: label('复制', 'Copy'), role: 'copy', accelerator: 'Command+C' },
      { label: label('粘贴', 'Paste'), role: 'paste', accelerator: 'Command+V' },
      { label: label('粘贴并匹配样式', 'Paste and Match Style'), role: 'pasteAndMatchStyle', accelerator: 'Command+Alt+Shift+V' },
      { label: label('删除', 'Delete'), role: 'delete' },
      { label: label('全选', 'Select All'), role: 'selectAll', accelerator: 'Command+A' },
      separator,
      { label: label('语音', 'Speech'), submenu: [
        { label: label('开始朗读', 'Start Speaking'), role: 'startSpeaking' },
        { label: label('停止朗读', 'Stop Speaking'), role: 'stopSpeaking' },
      ] },
    ] },
    { id: 'easyhub-view-menu', label: label('显示', 'View'), submenu: [
      command('home', '首页', 'Home', 'Command+1'),
      command('projects', '项目', 'Projects', 'Command+2'),
      command('discover', '发现', 'Discover', 'Command+3'),
      command('issues', '问题', 'Issues', 'Command+4'),
      command('reviews', '合并请求审查', 'Pull Request Reviews', 'Command+5'),
      command('starred', '我的收藏', 'My Stars', 'Command+6'),
      command('profile', '我的资料', 'My Profile', 'Command+7'),
      separator,
      command('search', '搜索…', 'Search…', 'Command+F'),
      command('refresh', '刷新', 'Refresh', 'Command+R'),
      separator,
      { label: label('切换全屏', 'Toggle Full Screen'), role: 'togglefullscreen', accelerator: 'Control+Command+F' },
    ] },
    { id: 'easyhub-window-menu', label: label('窗口', 'Window'), role: 'window', submenu: [
      { label: label('最小化', 'Minimize'), role: 'minimize', accelerator: 'Command+M' },
      { label: label('缩放', 'Zoom'), role: 'zoom' },
      separator,
      { label: label('前置全部窗口', 'Bring All to Front'), role: 'front' },
      { id: 'easyhub-show-window', label: label('显示 EasyHub', 'Show EasyHub'), click: () => actions.showWindow() },
    ] },
    { id: 'easyhub-help-menu', label: label('帮助', 'Help'), role: 'help', submenu: [
      { id: 'easyhub-project-home', label: label('GitHub 项目', 'GitHub Project'), click: () => actions.openExternal(PROJECT_URL) },
      { id: 'easyhub-feedback', label: label('反馈问题…', 'Report an Issue…'), click: () => actions.openExternal(FEEDBACK_URL) },
      separator,
      command('proxy-settings', 'GitHub 代理设置…', 'GitHub Proxy Settings…'),
    ] },
  ];
}
