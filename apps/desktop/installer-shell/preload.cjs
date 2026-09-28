const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyHubInstaller', {
  state: () => ipcRenderer.invoke('installer:state'),
  chooseFolder: (current) => ipcRenderer.invoke('installer:choose-folder', current),
  install: (path, desktopShortcut) => ipcRenderer.invoke('installer:install', path, desktopShortcut),
  openApp: () => ipcRenderer.invoke('installer:open-app'),
  minimize: () => ipcRenderer.invoke('installer:minimize'),
  close: () => ipcRenderer.invoke('installer:close'),
  onProgress: (callback) => {
    const listener = (_event, message) => callback(message);
    ipcRenderer.on('installer:progress', listener);
    return () => ipcRenderer.removeListener('installer:progress', listener);
  },
});
