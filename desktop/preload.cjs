// Tells the page it runs as the desktop app (see src/client/desktop.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('hashRushDesktop', {
  platform: process.platform,
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  quit: () => ipcRenderer.send('quit'),
});
