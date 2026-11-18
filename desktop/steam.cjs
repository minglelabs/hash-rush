// Steam, through steamworks.js. Everything here is optional: without Steam running
// (or outside a Steam build) the game plays the same, with no name, achievements
// or presence from Steam.

// The game's App ID from the Steamworks site. 480 is Valve's test app (Spacewar),
// fine for trying things out; set STEAM_APP_ID or change this once Hash Rush has its own.
const APP_ID = Number(process.env.STEAM_APP_ID) || 480;

let client = null;
let api = null;

// Call before the app is ready (the overlay needs command line switches).
function start({ packaged }) {
  try {
    api = require('steamworks.js');
  } catch (e) {
    console.warn('steamworks.js unavailable:', e.message);
    return { quit: false };
  }
  // A packaged build started outside Steam asks Steam to start it instead.
  if (packaged && APP_ID !== 480) {
    try {
      if (api.restartAppIfNecessary(APP_ID)) return { quit: true };
    } catch {
      // no Steam on this machine: run on
    }
  }
  try {
    client = api.init(APP_ID);
    api.electronEnableSteamOverlay();
  } catch (e) {
    client = null;
    console.warn('Steam not running:', e.message);
  }
  return { quit: false };
}

const info = () => ({
  on: Boolean(client),
  name: client ? safe(() => client.localplayer.getName(), '') : '',
  language: client ? safe(() => client.apps.currentGameLanguage(), '') : '',
});

function achieve(ids) {
  if (!client || !Array.isArray(ids)) return;
  for (const id of ids) if (typeof id === 'string' && /^[A-Z0-9_]{1,64}$/.test(id)) safe(() => client.achievement.activate(id));
}

function presence(text) {
  if (!client) return;
  safe(() => client.localplayer.setRichPresence('status', text ? String(text).slice(0, 255) : undefined));
}

function safe(fn, fallback) {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

module.exports = { start, info, achieve, presence, APP_ID };
