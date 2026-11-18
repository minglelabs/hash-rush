// Run as the desktop app (desktop/, for Steam), the page is served from app://
// and its preload script leaves window.hashRushDesktop behind. Links meant for
// other people then point at the web game, which anyone can open.

export const WEB_HOME = 'https://minglelabs.github.io/hash-rush/';

export const isDesktop = (w = globalThis) => Boolean(w.hashRushDesktop);

// Where an invite link starts: this page itself on the web, the web game from the app.
export function linkBase(loc, desktop) {
  return desktop ? WEB_HOME : `${loc.origin}${loc.pathname}`;
}

// ---------- Steam achievements ----------
// The ids must match the achievements set up on the Steamworks site (see
// desktop/STEAM.md, which lists them with their names).
export const ACHIEVEMENTS = {
  first: 'WIN_FIRST',
  ten: 'WIN_10',
  fifty: 'WIN_50',
  team: 'WIN_TEAM',
  people: 'WIN_VS_PEOPLE',
  allMaps: 'WIN_ALL_MAPS',
};
export const mapAchievement = (map) => `WIN_MAP_${String(map).toUpperCase()}`;

// What a finished round earns, from the record so far ({ wins, maps }) and the
// round: { won, map, team, people } (people: others in it who are not computers).
// Returns the new record and the achievements it reached (Steam ignores repeats).
export function roundAchievements(record, round, mapIds) {
  const wins = (record?.wins || 0) + (round.won ? 1 : 0);
  const maps = [...new Set([...(record?.maps || []), ...(round.won ? [round.map] : [])])].filter((m) => mapIds.includes(m));
  const got = [];
  if (round.won) {
    got.push(ACHIEVEMENTS.first, mapAchievement(round.map));
    if (round.team) got.push(ACHIEVEMENTS.team);
    if (round.people > 0) got.push(ACHIEVEMENTS.people);
  }
  if (wins >= 10) got.push(ACHIEVEMENTS.ten);
  if (wins >= 50) got.push(ACHIEVEMENTS.fifty);
  if (mapIds.every((m) => maps.includes(m))) got.push(ACHIEVEMENTS.allMaps);
  return { record: { wins, maps }, got };
}

// The Steam name as a hamster's: the game keeps names to 8 characters.
export const steamName = (name) => String(name || '').trim().slice(0, 8);
