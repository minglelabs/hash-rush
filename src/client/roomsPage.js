// The room list page: the open rooms, a chat for everyone looking at them, and
// how the game is played. A player who leaves a room lands here.

import { t } from './i18n.js';
import { watchRooms, openBroker } from './net.js';
import { createRoomList } from './roomList.js';
import { myName } from './page.js';

const $ = (id) => document.getElementById(id);
// Lines said here are not kept anywhere: only those on the page hear them.
const TOPIC = 'minglelabs/hash-rush/v1/plaza';
const MAX = 80;
const KEEP = 60;

const clean = (raw) => String(raw || '').replace(/\s+/g, ' ').trim().slice(0, MAX);

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

function openPlaza() {
  const log = $('plazaLog');
  const field = $('plazaForm').querySelector('input');
  field.placeholder = t('chatPlaceholder');
  field.maxLength = MAX;
  log.dataset.empty = t('plazaEmpty');
  const add = ({ name, text, at }) => {
    const line = document.createElement('div');
    const who = document.createElement('b');
    who.textContent = name;
    const time = document.createElement('time');
    const d = new Date(at);
    time.textContent = `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
    line.append(who, ` ${text} `, time);
    const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
    log.append(line);
    while (log.children.length > KEEP) log.firstChild.remove();
    if (atEnd) log.scrollTop = log.scrollHeight;
  };
  let client = null;
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
        const text = clean(msg.text);
        if (!text) return;
        add({ name: String(msg.name || '?').slice(0, 8), text, at: Math.min(Number(msg.at) || Date.now(), Date.now()) });
      });
      c.subscribe(TOPIC);
    })
    .catch(() => (log.dataset.empty = t('roomsFail')));
  let sentAt = 0;
  $('plazaForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = clean(field.value);
    // A line a second at most, so nobody can flood the page.
    if (!text || !client || Date.now() - sentAt < 1000) return;
    sentAt = Date.now();
    field.value = '';
    client.publish(TOPIC, JSON.stringify({ name: myName(), text, at: Date.now() }));
  });
}
