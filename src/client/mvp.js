// Who has been the most valuable hamster of the room so far. Works on the score
// table's rows: [bonks, bonked, seeds, goals, supers].

// What each deed is worth. A goal is the point of the game; a bonk is everyday work.
export const MVP_POINTS = [1, 0, 2, 5, 3];

export const mvpScore = (row) => MVP_POINTS.reduce((sum, w, k) => sum + w * (row[k] || 0), 0);

// The keys of the top scorers. Level on points, whoever was bonked less takes it;
// still level, they share the badge. Nobody is the MVP of nothing.
export function pickMvp(rows) {
  let best = [];
  let top = 0;
  let hits = Infinity;
  for (const [key, row] of rows) {
    const score = mvpScore(row);
    const bonked = row[1] || 0;
    if (score <= 0 || score < top || (score === top && bonked > hits)) continue;
    if (score > top || bonked < hits) best = [];
    top = score;
    hits = bonked;
    best.push(key);
  }
  return best;
}
