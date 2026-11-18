// Run as the desktop app (desktop/, for Steam), the page is served from app://
// and its preload script leaves window.hashRushDesktop behind. Links meant for
// other people then point at the web game, which anyone can open.

export const WEB_HOME = 'https://minglelabs.github.io/hash-rush/';

export const isDesktop = (w = globalThis) => Boolean(w.hashRushDesktop);

// Where an invite link starts: this page itself on the web, the web game from the app.
export function linkBase(loc, desktop) {
  return desktop ? WEB_HOME : `${loc.origin}${loc.pathname}`;
}
