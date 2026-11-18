// Tells the page it runs as the desktop app (see src/client/desktop.js).
const { contextBridge, ipcRenderer } = require('electron');

const steam = ipcRenderer.sendSync('steam-info');

contextBridge.exposeInMainWorld('hashRushDesktop', {
  platform: process.platform,
  steam: steam.on,
  steamName: steam.name,
  achieve: (ids) => ipcRenderer.send('steam-achieve', ids),
  presence: (text) => ipcRenderer.send('steam-presence', text),
  toggleFullscreen: () => ipcRenderer.send('toggle-fullscreen'),
  quit: () => ipcRenderer.send('quit'),
});
