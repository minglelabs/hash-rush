// Hash Rush as a desktop app: one window showing the web game.
//
// The game is plain ES modules, which Chromium will not load from file://, so the
// files are served under app://hash-rush/ instead: from the repository root while
// developing (`npm start` here), from resources/game in a packaged build.
const { app, BrowserWindow, protocol, net, shell, ipcMain, dialog, Menu } = require('electron');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const steam = require('./steam.cjs');

const SCHEME = 'app';
const HOST = 'hash-rush';
const ROOT = app.isPackaged ? path.join(process.resourcesPath, 'game') : path.join(__dirname, '..');

if (steam.start({ packaged: app.isPackaged }).quit) app.exit(0);

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
]);

// The file under ROOT that an app:// URL names, or null for anything outside it.
function fileFor(url) {
  const { host, pathname } = new URL(url);
  if (host !== HOST) return null;
  const rel = decodeURIComponent(pathname === '/' ? '/index.html' : pathname);
  const file = path.normalize(path.join(ROOT, rel));
  return file.startsWith(ROOT + path.sep) ? file : null;
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#24572f',
    title: 'Hash Rush',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true },
  });
  win.removeMenu();

  // Pages of the game open inside the app; anything on the web opens in the browser.
  const inside = (url) => url.startsWith(`${SCHEME}://${HOST}/`);
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (inside(url)) return { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true } };
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (inside(url)) return;
    e.preventDefault();
    if (/^https?:/i.test(url)) shell.openExternal(url);
  });

  // A host with friends in the room asks before leaving (beforeunload in main.js).
  // Electron shows no dialog for that by itself, so the window would just stay open.
  win.webContents.on('will-prevent-unload', (e) => {
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Leave', 'Stay'],
      defaultId: 1,
      cancelId: 1,
      message: 'Leave the room? The round in progress will end for everyone.',
    });
    if (choice === 0) e.preventDefault();
  });

  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const fullscreenKey = input.key === 'F11' || (input.key === 'Enter' && input.alt);
    if (fullscreenKey) {
      win.setFullScreen(!win.isFullScreen());
      e.preventDefault();
    } else if (!app.isPackaged && input.key === 'F12') {
      win.webContents.toggleDevTools();
    }
  });

  win.loadURL(`${SCHEME}://${HOST}/index.html`);
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  protocol.handle(SCHEME, (req) => {
    const file = fileFor(req.url);
    if (!file) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  ipcMain.on('toggle-fullscreen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.setFullScreen(!win.isFullScreen());
  });
  ipcMain.on('quit', () => app.quit());
  ipcMain.on('steam-info', (e) => (e.returnValue = steam.info()));
  ipcMain.on('steam-achieve', (_, ids) => steam.achieve(ids));
  ipcMain.on('steam-presence', (_, text) => steam.presence(text));
  createWindow();
  app.on('activate', () => BrowserWindow.getAllWindows().length === 0 && createWindow());
});

app.on('window-all-closed', () => app.quit());
