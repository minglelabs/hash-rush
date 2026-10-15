// What the board and ranking pages share: the page's words in the player's
// language, and the way back to the game.

import { lang, t } from './i18n.js';

export function setUpPage(title) {
  document.documentElement.lang = lang;
  document.title = `${t(title)} · Hash Rush`;
  for (const el of document.querySelectorAll('[data-i18n]')) el.innerHTML = t(el.dataset.i18n) ?? '';
  // A language picked in the address carries back to the game.
  const pick = new URLSearchParams(location.search).get('lang');
  if (pick) for (const a of document.querySelectorAll('.backLink, #newRoomLink')) a.href = `./?lang=${encodeURIComponent(pick)}`;
}

// The name this browser plays under, as the game keeps it.
export function myName() {
  try {
    const name = JSON.parse(localStorage.getItem('seed-rush-slots'))?.[0]?.name?.trim();
    if (name) return name.slice(0, 8);
  } catch {
    // nothing kept
  }
  return t('names')[0];
}
