// The room list page: the open rooms, a chat for everyone looking at them, and
// how the game is played. A player who leaves a room lands here.

import { t } from './i18n.js';
import { watchRooms, openBroker } from './net.js';
import { createRoomList } from './roomList.js';
import { myName } from './page.js';
import { createChat, floatLine, cleanChat } from './chatbar.js';

const $ = (id) => document.getElementById(id);
// Lines said here are not kept anywhere: only those on the page hear them.
const TOPIC = 'minglelabs/hash-rush/v1/plaza';
const KEEP = 60;

export function openRooms() {
  $('how').replaceChildren(
    ...t('how').map((html) => {
      const li = document.createElement('li');
      li.innerHTML = html;
      return li;
    }),
  );
  $('roomsStatus').textContent = t('roomsLoading');
  watchRooms(createRoomList({ items: $('roomItems'), status: $('roomsStatus'), pages: $('roomsPager') })).catch(
    () => ($('roomsStatus').textContent = t('roomsFail')),
  );
  openPlaza();
}

// The chat for everyone looking for a room, laid out as a room's is (chatbar.js):
// lines float up over the page and fade, and the button in the corner opens the
// bar to type in, with everything said since the page opened above it.
function openPlaza() {
  const said = [];
  let client = null;
  let sentAt = 0;
  const chat = createChat({
    send(raw) {
      const text = cleanChat(raw);
      // A line a second at most, so nobody can flood the page.
      if (!text || !client || Date.now() - sentAt < 1000) return;
      sentAt = Date.now();
      client.publish(TOPIC, JSON.stringify({ name: myName(), text, at: Date.now() }));
    },
    lines: () => said,
    quick: t('quickChat'),
    placeholder: t('chatPlaceholder'),
    empty: t('plazaEmpty'),
    title: t('plazaTitle'),
  });
  $('chatFab').hidden = false;
  $('lobbyChat').hidden = false;
  const add = (line) => {
    said.push(line);
    if (said.length > KEEP) said.shift();
    chat.heard(line);
    floatLine($('lobbyChat').querySelector('.chatLog'), line);
  };
  openBroker()
    .then((c) => {
      client = c;
      c.on('message', (_topic, payload) => {
        let msg;
        try {
          msg = JSON.parse(payload.toString());
        } catch {
          return;
        }
        const text = cleanChat(msg.text);
        if (!text) return;
        add({ name: String(msg.name || '?').slice(0, 8), text, at: Math.min(Number(msg.at) || Date.now(), Date.now()) });
      });
      c.subscribe(TOPIC);
    })
    .catch(() => add({ text: t('roomsFail'), sys: true, at: Date.now() }));
}
