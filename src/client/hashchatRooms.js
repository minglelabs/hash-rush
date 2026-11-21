// The HashChat app's public game rooms: hosted rooms on its game server whose
// host listed them. They show in the room list next to the browser-hosted
// rooms; joining goes through the HashChat server, which hands out the ticket.
// ?hcRooms= and ?hcJoin= point at a test setup instead.

const query = new URLSearchParams(location.search);
export const HASHCHAT_ROOMS_URL = query.get('hcRooms') || 'https://hashrush-win.minglelabs.app/rooms';
export const HASHCHAT_JOIN_URL = query.get('hcJoin') || 'https://mingle-2-0-0-production.up.railway.app/api/hash-rush/public/';
// Making a room: a new room on the game server, through HashChat (which hands
// out the ticket), so HashChat app players can find and join it as well.
export const HASHCHAT_NEW_URL = query.get('hcNew') || 'https://mingle-2-0-0-production.up.railway.app/api/hash-rush/new';

// Where "make a room" goes, in the page's language; the test overrides ride along.
export function newServerRoomUrl(lang) {
  const url = new URL(HASHCHAT_NEW_URL);
  if (lang) url.searchParams.set('lang', lang);
  return url.toString();
}
const EVERY_MS = 5000;

// A listed room as the room list draws a row (see roomList.js).
export function serverRoomRow(r) {
  return {
    room: String(r.id),
    name: String(r.host || ''),
    humans: Number(r.people) || 0,
    bots: Number(r.bots) || 0,
    open: Number(r.open) || 0,
    playing: !!r.playing,
    locked: false,
    server: true,
    join: `${HASHCHAT_JOIN_URL}${encodeURIComponent(String(r.id))}`,
  };
}

// Calls onChange(rows) now and every few seconds; returns stop().
export function watchServerRooms(onChange) {
  let stopped = false;
  let timer = 0;
  async function poll() {
    try {
      const r = await fetch(HASHCHAT_ROOMS_URL, { cache: 'no-store' });
      const body = r.ok ? await r.json() : null;
      if (!stopped) onChange(Array.isArray(body?.rooms) ? body.rooms.map(serverRoomRow) : []);
    } catch {
      if (!stopped) onChange([]);
    }
    if (!stopped) timer = setTimeout(poll, EVERY_MS);
  }
  poll();
  return () => {
    stopped = true;
    clearTimeout(timer);
  };
}

// Browser-hosted rooms (watchRooms) and the HashChat ones in one list.
export function mergeRoomLists(render) {
  let p2p = [];
  let server = [];
  const draw = () => render([...server, ...p2p]);
  return {
    p2p: (rows) => {
      p2p = rows;
      draw();
    },
    server: (rows) => {
      server = rows;
      draw();
    },
  };
}
