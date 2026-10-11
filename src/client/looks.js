// One look per slot. `color` is the team colour used for outlines, labels and nests.
export const LOOKS = [
  { fur: '#f7b558', ear: '#e3963b', belly: '#fff4dc', paw: '#f3c9a0', color: '#e5484d' },
  { fur: '#f6f1ea', ear: '#dccfbd', belly: '#ffffff', paw: '#f3c9c0', color: '#2f6fed' },
  { fur: '#96613f', ear: '#744829', belly: '#edd5ba', paw: '#e0b796', color: '#1f9d55' },
  { fur: '#a3abb5', ear: '#808993', belly: '#eff2f5', paw: '#e3c4bc', color: '#9b51e0' },
  { fur: '#4a403c', ear: '#332b28', belly: '#ddd2c8', paw: '#e0b7a8', color: '#f2851d' },
  { fur: '#efcf94', ear: '#d8ac68', belly: '#fffaf0', paw: '#f1cfae', color: '#0fa3a3' },
  { fur: '#cf8562', ear: '#ad6243', belly: '#fbe6d6', paw: '#f0c2a8', color: '#e0529c' },
  { fur: '#d9d2c3', ear: '#b8ad98', belly: '#ffffff', paw: '#eccbc0', color: '#b58900' },
];

// In a team game the outline, label and nest take the team's colour; the fur stays the slot's own.
export const TEAMS = [{ color: '#e5484d' }, { color: '#2f6fed' }, { color: '#1f9d55' }, { color: '#9b51e0' }];
export const colorOf = (p) => (p.team >= 0 ? TEAMS[p.team].color : LOOKS[p.look].color);
export const lookOf = (p) => (p.team >= 0 ? { ...LOOKS[p.look], color: TEAMS[p.team].color } : LOOKS[p.look]);
