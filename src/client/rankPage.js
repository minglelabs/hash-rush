// The ranking page: the top players off the broker, ten a page, and this
// browser's own record of rounds.

import { lang, t } from './i18n.js';
import { TEAMS } from './looks.js';
import { history, lastRating, loadRanking } from './rank.js';

const $ = (id) => document.getElementById(id);

export const winRate = (r) => (r.games ? Math.round((r.wins / r.games) * 100) : 0);

// Fills the ranking page: this player's own rating and record at once, and the
// ranking itself once the broker answers.
export function openRanking() {
  const mine = lastRating();
  $('rankMe').textContent = t('rankMe', mine.elo, mine.games, mine.wins);
  renderHistory();
  $('rankTable').textContent = '';
  $('rankStatus').textContent = t('rankLoading');
  loadRanking()
    .then(({ rows, mine: me }) => {
      if (me) $('rankMe').textContent = t('rankMe', me.elo, me.games, me.wins);
      $('rankStatus').textContent = rows.length ? '' : t('rankEmpty');
      renderRanking(rows);
    })
    .catch(() => ($('rankStatus').textContent = t('rankFail')));
}

// Page buttons under a list: ‹ 2 / 5 ›. Nothing when it all fits on one page.
function pager(box, page, pages, go) {
  box.textContent = '';
  if (pages <= 1) return;
  const button = (label, to) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = label;
    b.disabled = to < 0 || to >= pages;
    b.addEventListener('click', () => go(to));
    return b;
  };
  const where = document.createElement('span');
  where.textContent = `${page + 1} / ${pages}`;
  box.append(button('‹', page - 1), where, button('›', page + 1));
}

const RANK_PAGE = 10;
const HISTORY_PAGE = 5;

// Ten places a page, this player's own row under them if it is on another page.
function renderRanking(rows, page = 0) {
  $('rankTable').textContent = '';
  const pages = Math.ceil(rows.length / RANK_PAGE);
  const shown = rows.slice(page * RANK_PAGE, (page + 1) * RANK_PAGE);
  const me = rows.find((r) => r.me);
  if (me && !shown.includes(me)) shown.push(me);
  pager($('rankPager'), page, pages, (to) => renderRanking(rows, to));
  if (!shown.length) return;
  const table = $('rankTable');
  const head = table.insertRow();
  for (const label of t('rankCols')) {
    const th = document.createElement('th');
    th.textContent = label;
    head.append(th);
  }
  for (const r of shown) {
    const row = table.insertRow();
    row.classList.toggle('me', r.me);
    const name = r.level ? `🤖 ${t('botLevels')[r.level] || r.level}` : r.name;
    for (const v of [r.rank, name, r.elo, r.wins, r.games - r.wins, `${winRate(r)}%`]) row.insertCell().textContent = v;
  }
}

// This browser's own record, newest first, rated or not, five rounds a page.
function renderHistory(page = 0) {
  const all = history();
  const list = all.slice(page * HISTORY_PAGE, (page + 1) * HISTORY_PAGE);
  pager($('historyPager'), page, Math.ceil(all.length / HISTORY_PAGE), renderHistory);
  if (!list.length) {
    const li = document.createElement('li');
    li.textContent = t('rankNoHistory');
    $('rankHistory').replaceChildren(li);
    return;
  }
  $('rankHistory').replaceChildren(
    ...list.map((h) => {
      const li = document.createElement('li');
      const result = document.createElement('b');
      result.className = h.won ? 'won' : 'lost';
      result.textContent = t(h.won ? 'rankWin' : 'rankLoss');
      const when = new Date(h.at).toLocaleString(lang, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      // Free-for-all or teams, and in a team game which side this player was on.
      const mode = document.createElement('span');
      mode.className = 'mode';
      const side = h.team && TEAMS[h.myTeam] ? h.myTeam : -1;
      mode.textContent = h.team ? `${t('modeTeam')}${side >= 0 ? ` ${t('teamNames')[side]}` : ''}` : t('modeSolo');
      if (side >= 0) mode.style.setProperty('--c', TEAMS[side].color);
      const what = document.createElement('span');
      what.append(`${t('mapNames')[h.map] || h.map} · `);
      // Everyone else, in their team's colour in a team game; a computer with its
      // level, as 콩이(초보). Older records kept less: names only, no sides.
      (h.with || []).forEach((o, k) => {
        if (k) what.append(', ');
        const who = document.createElement('span');
        who.textContent = typeof o === 'string' ? o : o.level ? `${o.name}(${t('botLevels')[o.level] || o.level})` : o.name;
        if (h.team && typeof o === 'object' && TEAMS[o.team]) {
          who.className = 'side';
          who.style.color = TEAMS[o.team].color;
        }
        what.append(who);
      });
      const tag = document.createElement('small');
      tag.textContent = `${when} · ${h.stopped ? `${t('rankStopped')} · ` : ''}${t(h.rated ? 'rankRated' : 'rankUnrated')}`;
      li.append(result, mode, what, tag);
      return li;
    }),
  );
}
