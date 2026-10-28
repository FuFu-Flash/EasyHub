import { zh } from '../../../renderer/src/locales/zh';
import { en } from '../../../renderer/src/locales/en';
import type { MenuItemConstructorOptions } from 'electron';
import { canRunMenuCommand, type MenuCommand, type MenuState } from '../../../shared/applicationMenu';

export const PROJECT_URL = 'https://github.com/FuFu-Flash/EasyHub';
export const FEEDBACK_URL = 'https://github.com/FuFu-Flash/EasyHub/issues/new/choose';

type MenuLabel = Extract<keyof typeof zh, `nativeMenu.${string}`>;
export const nativeMenuText = (language: MenuState['language'], key: MenuLabel): string => language === 'zh' ? zh[key] : en[key];

interface ApplicationMenuActions {
  command: (command: MenuCommand) => void;
  showWindow: () => void;
  openExternal: (url: string) => void;
}

export function createApplicationMenuTemplate(state: MenuState, rendererReady: boolean, actions: ApplicationMenuActions): MenuItemConstructorOptions[] {
  const label = (key: MenuLabel): string => nativeMenuText(state.language, key);
  const command = (id: MenuCommand, key: MenuLabel, accelerator?: string): MenuItemConstructorOptions => ({
    id: `easyhub-${id}`, label: label(key), ...(accelerator ? { accelerator } : {}),
    enabled: canRunMenuCommand(id, state) && (rendererReady || id === 'settings' || id === 'proxy-settings'),
    click: () => actions.command(id),
  });
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  return [
    { id: 'easyhub-app-menu', label: 'EasyHub', submenu: [
      { id: 'easyhub-about', label: label("nativeMenu.aboutEasyHub"), role: 'about' },
      separator,
      command('settings', "nativeMenu.settings", 'Command+,'),
      separator,
      { label: label("nativeMenu.services"), role: 'services', submenu: [] },
      separator,
      { label: label("nativeMenu.hideEasyHub"), role: 'hide', accelerator: 'Command+H' },
      { label: label("nativeMenu.hideOthers"), role: 'hideOthers', accelerator: 'Command+Alt+H' },
      { label: label("nativeMenu.showAll"), role: 'unhide' },
      separator,
      { label: label("nativeMenu.quitEasyHub"), role: 'quit', accelerator: 'Command+Q' },
    ] },
    { id: 'easyhub-file-menu', label: label("nativeMenu.file"), submenu: [
      command('new-project', "nativeMenu.newProject", 'Command+N'),
      command('add-folder', "nativeMenu.addFolder", 'Command+O'),
      command('download-project', "nativeMenu.downloadProjectfromGitHub", 'Command+Shift+O'),
      separator,
      { label: label("nativeMenu.closeWindow"), role: 'close', accelerator: 'Command+W' },
    ] },
    { id: 'easyhub-edit-menu', label: label("nativeMenu.edit"), submenu: [
      { label: label("nativeMenu.undo"), role: 'undo', accelerator: 'Command+Z' },
      { label: label("nativeMenu.redo"), role: 'redo', accelerator: 'Command+Shift+Z' },
      separator,
      { label: label("nativeMenu.cut"), role: 'cut', accelerator: 'Command+X' },
      { label: label("nativeMenu.copy"), role: 'copy', accelerator: 'Command+C' },
      { label: label("nativeMenu.paste"), role: 'paste', accelerator: 'Command+V' },
      { label: label("nativeMenu.pasteandMatchStyle"), role: 'pasteAndMatchStyle', accelerator: 'Command+Alt+Shift+V' },
      { label: label("nativeMenu.delete"), role: 'delete' },
      { label: label("nativeMenu.selectAll"), role: 'selectAll', accelerator: 'Command+A' },
      separator,
      { label: label("nativeMenu.speech"), submenu: [
        { label: label("nativeMenu.startSpeaking"), role: 'startSpeaking' },
        { label: label("nativeMenu.stopSpeaking"), role: 'stopSpeaking' },
      ] },
    ] },
    { id: 'easyhub-view-menu', label: label("nativeMenu.view"), submenu: [
      command('home', "nativeMenu.home", 'Command+1'),
      command('projects', "nativeMenu.projects", 'Command+2'),
      command('discover', "nativeMenu.discover", 'Command+3'),
      command('issues', "nativeMenu.issues", 'Command+4'),
      command('reviews', "nativeMenu.pullRequestReviews", 'Command+5'),
      command('starred', "nativeMenu.myStars", 'Command+6'),
      command('profile', "nativeMenu.myProfile", 'Command+7'),
      separator,
      command('search', "nativeMenu.search", 'Command+F'),
      command('refresh', "nativeMenu.refresh", 'Command+R'),
      separator,
      { label: label("nativeMenu.toggleFullScreen"), role: 'togglefullscreen', accelerator: 'Control+Command+F' },
    ] },
    { id: 'easyhub-window-menu', label: label("nativeMenu.window"), role: 'window', submenu: [
      { label: label("nativeMenu.minimize"), role: 'minimize', accelerator: 'Command+M' },
      { label: label("nativeMenu.zoom"), role: 'zoom' },
      separator,
      { label: label("nativeMenu.bringAlltoFront"), role: 'front' },
      { id: 'easyhub-show-window', label: label("nativeMenu.showEasyHub"), click: () => actions.showWindow() },
    ] },
    { id: 'easyhub-help-menu', label: label("nativeMenu.help"), role: 'help', submenu: [
      { id: 'easyhub-project-home', label: label("nativeMenu.gitHubProject"), click: () => actions.openExternal(PROJECT_URL) },
      { id: 'easyhub-feedback', label: label("nativeMenu.reportanIssue"), click: () => actions.openExternal(FEEDBACK_URL) },
      separator,
      command('proxy-settings', "nativeMenu.gitHubProxySettings"),
    ] },
  ];
}
