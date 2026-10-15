// The list of open rooms, ten a page like the ranking. Used by the room list page
// and by the list a player can unfold inside a room.

import { t } from './i18n.js';
import { pager } from './rankPage.js';

const ROOM_PAGE = 10;

// `here` is the room this player is in, if any: it comes first, marked as theirs
// and without buttons. `base` is the page a room's link opens.
export function createRoomList({ items, status, pages, here = null, base = './' }) {
  let rooms = [];
  let page = 0;
  function show() {
    const shown = [...rooms.filter((r) => r.room === here), ...rooms.filter((r) => r.room !== here)];
    const count = Math.ceil(shown.length / ROOM_PAGE);
    page = Math.max(0, Math.min(page, count - 1));
    pager(pages, page, count, (to) => {
      page = to;
      show();
    });
    status.textContent = shown.length ? '' : t('roomsEmpty');
    items.replaceChildren(...shown.slice(page * ROOM_PAGE, (page + 1) * ROOM_PAGE).map(row));
  }
  function row(r) {
    const li = document.createElement('li');
    const title = document.createElement('b');
    title.textContent = `${r.locked ? '🔒 ' : ''}${t('roomOf', r.name || '?')}`;
    const state = document.createElement('span');
    state.className = `badge${r.playing ? ' playing' : ''}`;
    state.textContent = t(r.playing ? 'roomPlaying' : 'roomWaiting');
    const who = document.createElement('small');
    who.textContent = t('roomPeople', r.humans, r.bots, r.open);
    const info = document.createElement('div');
    info.append(title, state, who);
    if (r.room === here) {
      const mine = document.createElement('span');
      mine.className = 'badge mine';
      mine.textContent = t('roomMine');
      title.after(mine);
      li.append(info);
      return li;
    }
    const link = `${base}?room=${r.room}`;
    const join = document.createElement('button');
    join.className = 'primary';
    join.textContent = t('joinRoom');
    join.disabled = r.open === 0;
    join.addEventListener('click', () => (location.href = link));
    const watch = document.createElement('button');
    watch.textContent = t('watchRoom');
    watch.addEventListener('click', () => (location.href = `${link}&watch`));
    li.append(info, join, watch);
    return li;
  }
  return (next) => {
    rooms = next;
    show();
  };
}
