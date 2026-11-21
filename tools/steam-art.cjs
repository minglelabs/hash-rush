// Renders the Steam store images into desktop/store/, with the desktop app's Electron:
//   desktop/node_modules/.bin/electron tools/steam-art.cjs [art|shots|trailer|all]
// art: capsules, library art, icons and achievement icons (from tools/steam-art.html)
// shots: 1920x1080 screenshots of real rounds against computers, one per map
// trailer: a silent ~40 s gameplay video (needs ffmpeg)
// Nothing is shown on screen: the windows render off screen.
const { app, BrowserWindow, protocol, net, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'desktop', 'store');
const what = process.argv.find((a) => ['art', 'shots', 'trailer', 'all'].includes(a)) || 'all';

app.commandLine.appendSwitch('force-device-scale-factor', '1');
app.dock?.hide();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);

// Steam's sizes: https://partner.steamgames.com/doc/store/assets
const ART = [
  ['capsule/header_capsule.png', 'kind=scene&w=920&h=430'],
  ['capsule/small_capsule.png', 'kind=scene&w=462&h=174&tag=0'],
  ['capsule/main_capsule.png', 'kind=scene&w=1232&h=706'],
  ['capsule/vertical_capsule.png', 'kind=scene&w=748&h=896'],
  ['capsule/page_background.jpg', 'kind=scene&w=1438&h=810&logo=0'],
  ['library/library_capsule.png', 'kind=scene&w=600&h=900'],
  ['library/library_header.png', 'kind=scene&w=920&h=430'],
  ['library/library_hero.jpg', 'kind=scene&w=3840&h=1240&logo=0'],
  ['library/library_logo.png', 'kind=logo&w=1280&h=720'],
  ['icon/community_icon.jpg', 'kind=icon&w=184'],
  ['icon/app_icon_256.png', 'kind=icon&w=256'],
];
const MAPS = ['meadow', 'desert', 'factory', 'ice', 'beach', 'graveyard', 'sky'];
const ACHIEVEMENTS = ['WIN_FIRST', 'WIN_10', 'WIN_50', 'WIN_TEAM', 'WIN_VS_PEOPLE', 'WIN_ALL_MAPS', ...MAPS.map((m) => `WIN_MAP_${m.toUpperCase()}`)];

function save(rel, image) {
  const file = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rel.endsWith('.jpg') ? image.toJPEG(90) : image.toPNG());
  console.log('wrote', path.relative(ROOT, file), image.getSize());
}

async function waitFor(win, expr, ms = 20000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await win.webContents.executeJavaScript(expr).catch(() => false)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`timed out waiting for ${expr}`);
}

async function art() {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  const draw = async (query) => {
    await win.loadURL(`app://hash-rush/tools/steam-art.html?${query}`);
    await waitFor(win, 'document.body.dataset.ready === "1"');
    return nativeImage.createFromDataURL(await win.webContents.executeJavaScript('window.art'));
  };
  for (const [rel, query] of ART) save(rel, await draw(query));
  // Steam takes 64x64 JPGs; drawn bigger and scaled down for clean edges.
  for (const id of ACHIEVEMENTS) {
    for (const locked of [0, 1]) {
      const img = (await draw(`kind=ach&id=${id}&locked=${locked}&w=256`)).resize({ width: 64, height: 64, quality: 'best' });
      save(`achievements/${id}${locked ? '_locked' : ''}.jpg`, img);
    }
  }
  win.destroy();
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const gameWindow = () => {
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: false, webPreferences: { offscreen: true, preload: path.join(__dirname, 'steam-art-preload.cjs') } });
  win.webContents.setFrameRate(60);
  return win;
};

// A round on map `p.map` (teams or not) with the player and seven computers.
async function startRound(win, p) {
  const kinds = ['bot:ace', 'bot:hard', 'bot:ace', 'bot:hard', 'bot:ace', 'bot:hard', 'bot:ace'];
  await win.loadURL('app://hash-rush/index.html?lang=en');
  await win.webContents.executeJavaScript(`(() => {
    localStorage.clear();
    localStorage.setItem('seed-rush-slots', JSON.stringify([{ kind: 'human', name: 'You', team: 0 }, ...${JSON.stringify(kinds)}.map((kind, i) => ({ kind, name: '', team: (i + 1) % 2 }))]));
    localStorage.setItem('seed-rush-map', ${JSON.stringify(p.map)});
    localStorage.setItem('seed-rush-teams', ${p.teams ? "'1'" : "'0'"});
  })()`);
  await win.loadURL('app://hash-rush/index.html?lang=en');
  await waitFor(win, "!!document.getElementById('start') && !document.getElementById('start').disabled");
  await win.webContents.executeJavaScript("document.getElementById('start').click()");
  await waitFor(win, "!document.getElementById('stage').hidden");
  // The controls hint has done its job for a store picture.
  await win.webContents.executeJavaScript("document.getElementById('stage').classList.add('played')");
}

// One round per map against seven computers, caught a few seconds in, when the
// hamsters are spread over the maze.
async function shots() {
  const win = gameWindow();
  const plan = [
    { map: 'meadow', teams: false, at: 11 },
    { map: 'desert', teams: true, at: 13 },
    { map: 'factory', teams: false, at: 12 },
    { map: 'beach', teams: false, at: 14 },
    { map: 'graveyard', teams: true, at: 12 },
    { map: 'ice', teams: false, at: 12 },
    { map: 'sky', teams: false, at: 30 },
  ];
  let n = 0;
  for (const p of plan) {
    await startRound(win, p);
    await sleep((3 + p.at) * 1000);
    const name = String(++n).padStart(2, '0');
    save(`screenshots/${name}_${p.map}${p.teams ? '_teams' : ''}.jpg`, await win.webContents.capturePage());
  }
  win.destroy();
}

// A silent gameplay trailer (about 40 s): the title, five maps mid-round, the title again.
// Frames come off the off-screen window at 30 fps and go straight into ffmpeg.
async function trailer() {
  const { spawn } = require('node:child_process');
  const FPS = 30;
  const file = path.join(OUT, 'trailer', 'trailer.mp4');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'bgra', '-s', '1920x1080', '-r', String(FPS), '-i', '-', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-preset', 'medium', '-movflags', '+faststart', file], { stdio: ['pipe', 'inherit', 'inherit'] });
  const win = gameWindow();
  let frame = null;
  win.webContents.on('paint', (_, __, image) => {
    const { width, height } = image.getSize();
    if (width === 1920 && height === 1080) frame = image.toBitmap();
  });
  async function record(seconds) {
    const end = Date.now() + seconds * 1000;
    let next = Date.now();
    while (Date.now() < end) {
      if (frame && !ff.stdin.write(frame)) await new Promise((r) => ff.stdin.once('drain', r));
      next += 1000 / FPS;
      await sleep(Math.max(0, next - Date.now()));
    }
  }
  const card = async (seconds) => {
    frame = null;
    await win.loadURL('app://hash-rush/tools/steam-art.html?kind=scene&w=1920&h=1080');
    await waitFor(win, 'document.body.dataset.ready === "1"');
    win.webContents.invalidate();
    await sleep(300);
    await record(seconds);
  };
  await card(3);
  for (const p of [
    { map: 'meadow', teams: false },
    { map: 'factory', teams: false },
    { map: 'beach', teams: true },
    { map: 'graveyard', teams: false },
    { map: 'sky', teams: false },
  ]) {
    frame = null;
    await startRound(win, p);
    // Past the countdown and the first dash to the flower.
    await sleep(9000);
    await record(6.5);
  }
  await card(3);
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  win.destroy();
  console.log('wrote', path.relative(ROOT, file));
}

app.whenReady().then(async () => {
  protocol.handle('app', (req) => {
    const { pathname } = new URL(req.url);
    const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname === '/' ? '/index.html' : pathname)));
    if (!file.startsWith(ROOT + path.sep)) return new Response('Not found', { status: 404 });
    return net.fetch(pathToFileURL(file).toString());
  });
  try {
    if (what === 'art' || what === 'all') await art();
    if (what === 'shots' || what === 'all') await shots();
    if (what === 'trailer' || what === 'all') await trailer();
  } catch (e) {
    console.error(e);
    process.exitCode = 1;
  }
  app.quit();
});
