// For tools/steam-art.cjs: the page runs as the desktop app would, minus Steam.
const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('hashRushDesktop', {
  platform: process.platform,
  steam: false,
  steamName: '',
  achieve: () => {},
  presence: () => {},
  toggleFullscreen: () => {},
  quit: () => {},
});
