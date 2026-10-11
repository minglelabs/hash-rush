// Scenery for the maps: small drawings scattered over the walls and the open
// ground so each theme looks like its place. They are only paint. Each drawer
// draws around the origin, within about 16 pixels, the right way up.

const TAU = Math.PI * 2;

function dot(ctx, x, y, r, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

function blob(ctx, x, y, rx, ry, fill) {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, 0, 0, TAU);
  ctx.fill();
}

function poly(ctx, pts, fill, stroke) {
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.closePath();
  if (fill) {
    ctx.fillStyle = fill;
    ctx.fill();
  }
  if (stroke) {
    ctx.strokeStyle = stroke;
    ctx.stroke();
  }
}

function line(ctx, pts, stroke, width) {
  ctx.strokeStyle = stroke;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
  ctx.stroke();
}

const shadow = (ctx, w = 11) => blob(ctx, 1, 13, w, 4, 'rgba(0, 0, 0, 0.2)');

function skull(ctx) {
  dot(ctx, 0, -2, 9, '#f1ecdf');
  ctx.fillStyle = '#f1ecdf';
  ctx.fillRect(-5, 4, 10, 6);
  dot(ctx, -3.5, -2, 2.6, '#2a2430');
  dot(ctx, 3.5, -2, 2.6, '#2a2430');
  poly(ctx, [[0, 1], [-1.6, 4], [1.6, 4]], '#2a2430');
  line(ctx, [[-2.5, 6], [-2.5, 10]], '#2a2430', 1);
  line(ctx, [[0, 6], [0, 10]], '#2a2430', 1);
  line(ctx, [[2.5, 6], [2.5, 10]], '#2a2430', 1);
}

function bones(ctx) {
  for (const s of [1, -1]) {
    line(ctx, [[-9, -6 * s], [9, 6 * s]], '#efe9dc', 3.2);
    for (const e of [1, -1]) {
      dot(ctx, 9 * e - 1, 6 * s * e - 1.5, 2.2, '#efe9dc');
      dot(ctx, 9 * e + 1, 6 * s * e + 1.5, 2.2, '#efe9dc');
    }
  }
}

export const DECO = {
  // ---------- meadow ----------
  mushroom(ctx) {
    shadow(ctx, 8);
    ctx.fillStyle = '#fff4e2';
    ctx.fillRect(-3, 0, 6, 11);
    ctx.fillStyle = '#e5484d';
    ctx.beginPath();
    ctx.arc(0, 1, 11, Math.PI, 0);
    ctx.fill();
    dot(ctx, -5, -3, 2, '#fff');
    dot(ctx, 3, -6, 2.2, '#fff');
    dot(ctx, 6, -1.5, 1.5, '#fff');
  },
  rock(ctx) {
    shadow(ctx, 12);
    blob(ctx, 0, 4, 12, 9, '#8f958c');
    blob(ctx, -3, 1, 6, 4, '#b4bab0');
  },
  stump(ctx) {
    shadow(ctx, 11);
    ctx.fillStyle = '#8a5a2b';
    ctx.fillRect(-9, -2, 18, 13);
    blob(ctx, 0, -2, 9, 5, '#d9a86a');
    ctx.strokeStyle = '#a8773e';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.ellipse(0, -2, 5, 2.6, 0, 0, TAU);
    ctx.stroke();
  },
  clover(ctx) {
    for (let i = 0; i < 3; i++) dot(ctx, Math.cos((i / 3) * TAU - 1.57) * 4, Math.sin((i / 3) * TAU - 1.57) * 4, 4, 'rgba(60, 150, 70, 0.55)');
  },
  daisy(ctx) {
    for (let i = 0; i < 6; i++) dot(ctx, Math.cos((i / 6) * TAU) * 4, Math.sin((i / 6) * TAU) * 4, 2.6, 'rgba(255, 255, 255, 0.85)');
    dot(ctx, 0, 0, 2.2, '#f7b500');
  },

  // ---------- desert ----------
  cactus(ctx) {
    shadow(ctx, 9);
    ctx.fillStyle = '#4f9a4a';
    ctx.beginPath();
    ctx.roundRect(-4.5, -14, 9, 26, 4.5);
    ctx.fill();
    line(ctx, [[-4, 2], [-10, 2], [-10, -5]], '#4f9a4a', 5);
    line(ctx, [[4, -1], [10, -1], [10, -9]], '#4f9a4a', 5);
    line(ctx, [[0, -11], [0, 9]], '#3b7a39', 1);
    dot(ctx, 0, -15, 3, '#ff7fa6');
  },
  cowSkull(ctx) {
    line(ctx, [[-6, -6], [-13, -11]], '#e9e2cf', 3);
    line(ctx, [[6, -6], [13, -11]], '#e9e2cf', 3);
    skull(ctx);
  },
  tumbleweed(ctx) {
    ctx.strokeStyle = '#9a6b33';
    ctx.lineWidth = 1.3;
    for (let i = 0; i < 5; i++) {
      ctx.beginPath();
      ctx.ellipse(0, 2, 10 - i, 6 + i, i * 0.7, 0, TAU);
      ctx.stroke();
    }
  },
  pebbles(ctx) {
    blob(ctx, -5, 2, 5, 3.5, 'rgba(150, 110, 60, 0.6)');
    blob(ctx, 4, -2, 3.5, 2.6, 'rgba(170, 130, 80, 0.6)');
    blob(ctx, 5, 5, 2.5, 2, 'rgba(140, 100, 55, 0.6)');
  },
  crack(ctx) {
    line(ctx, [[-10, -3], [-3, 1], [1, -4], [6, 2], [11, 0]], 'rgba(130, 90, 45, 0.5)', 1.6);
    line(ctx, [[1, -4], [3, -9]], 'rgba(130, 90, 45, 0.5)', 1.3);
  },
  bones,

  // ---------- factory ----------
  gear(ctx) {
    ctx.fillStyle = '#aab3c0';
    for (let i = 0; i < 8; i++) {
      ctx.save();
      ctx.rotate((i / 8) * TAU);
      ctx.fillRect(-2.6, -14, 5.2, 7);
      ctx.restore();
    }
    dot(ctx, 0, 0, 10, '#aab3c0');
    dot(ctx, 0, 0, 6, '#7d8796');
    dot(ctx, 0, 0, 2.6, '#272d38');
  },
  crate(ctx) {
    shadow(ctx, 12);
    ctx.fillStyle = '#b98545';
    ctx.fillRect(-11, -11, 22, 22);
    ctx.strokeStyle = '#7a5226';
    ctx.lineWidth = 2;
    ctx.strokeRect(-11, -11, 22, 22);
    line(ctx, [[-11, -11], [11, 11]], '#7a5226', 2);
    line(ctx, [[11, -11], [-11, 11]], '#7a5226', 2);
  },
  pipe(ctx) {
    ctx.fillStyle = '#8b95a3';
    ctx.fillRect(-15, -5, 30, 10);
    ctx.fillStyle = '#c2cad4';
    ctx.fillRect(-15, -5, 30, 3);
    ctx.fillStyle = '#5c6573';
    ctx.fillRect(-12, -7, 4, 14);
    ctx.fillRect(8, -7, 4, 14);
  },
  stripes(ctx) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(-13, -8, 26, 16);
    ctx.clip();
    ctx.fillStyle = '#f2b705';
    ctx.fillRect(-13, -8, 26, 16);
    for (let x = -30; x < 30; x += 9) poly(ctx, [[x, 8], [x + 5, 8], [x + 21, -8], [x + 16, -8]], '#1f2430');
    ctx.restore();
  },
  barrel(ctx) {
    shadow(ctx, 10);
    dot(ctx, 0, 0, 11, '#2f7fb8');
    dot(ctx, 0, 0, 8, '#4b9ad2');
    dot(ctx, 3, -3, 2, '#1f2430');
  },
  bolt(ctx) {
    dot(ctx, 0, 0, 4, 'rgba(40, 46, 58, 0.5)');
    line(ctx, [[-2.5, 0], [2.5, 0]], 'rgba(255, 255, 255, 0.5)', 1.2);
  },
  chevron(ctx) {
    for (const x of [-7, 2]) line(ctx, [[x, -7], [x + 7, 0], [x, 7]], 'rgba(242, 183, 5, 0.6)', 3);
  },
  oil(ctx) {
    blob(ctx, 0, 0, 12, 7, 'rgba(30, 34, 44, 0.3)');
    blob(ctx, 7, 5, 5, 3, 'rgba(30, 34, 44, 0.3)');
  },

  // ---------- ice ----------
  snowman(ctx) {
    shadow(ctx, 10);
    dot(ctx, 0, 5, 9, '#fff');
    dot(ctx, 0, -7, 6.5, '#fff');
    dot(ctx, -2.2, -8.5, 1.1, '#222');
    dot(ctx, 2.2, -8.5, 1.1, '#222');
    poly(ctx, [[0, -7], [7, -5.5], [0, -5]], '#ff8a1f');
    ctx.fillStyle = '#2a2a33';
    ctx.fillRect(-6, -14.5, 12, 2);
    ctx.fillRect(-4, -19, 8, 5);
    dot(ctx, 0, 2, 1.1, '#222');
    dot(ctx, 0, 6, 1.1, '#222');
  },
  pine(ctx) {
    shadow(ctx, 9);
    ctx.fillStyle = '#7a5226';
    ctx.fillRect(-2, 8, 4, 5);
    for (const [y, w] of [[9, 12], [2, 10], [-5, 7.5]]) {
      poly(ctx, [[0, y - 12], [w, y], [-w, y]], '#2f7d5b');
      poly(ctx, [[0, y - 12], [w * 0.45, y - 6.5], [-w * 0.45, y - 6.5]], '#fff');
    }
  },
  crystal(ctx) {
    for (const [x, h, c] of [[-6, 12, '#bfe6ff'], [0, 18, '#e2f4ff'], [6, 10, '#9fd4f5']]) {
      poly(ctx, [[x, 8], [x - 3.5, 8 - h * 0.6], [x, 8 - h], [x + 3.5, 8 - h * 0.6]], c, '#ffffff');
    }
  },
  snowflake(ctx) {
    for (let i = 0; i < 3; i++) {
      const a = (i / 3) * Math.PI;
      line(ctx, [[Math.cos(a) * -7, Math.sin(a) * -7], [Math.cos(a) * 7, Math.sin(a) * 7]], 'rgba(255, 255, 255, 0.9)', 1.6);
    }
  },
  snowpile(ctx) {
    blob(ctx, 0, 3, 13, 6, 'rgba(255, 255, 255, 0.8)');
    blob(ctx, -4, -1, 7, 5, 'rgba(255, 255, 255, 0.8)');
  },

  // ---------- beach ----------
  boat(ctx) {
    blob(ctx, 0, 9, 15, 3.5, 'rgba(255, 255, 255, 0.55)');
    poly(ctx, [[-14, 1], [14, 1], [9, 9], [-9, 9]], '#a0622d');
    ctx.fillStyle = '#e8c08a';
    ctx.fillRect(-13, 1, 26, 2.4);
    line(ctx, [[0, 1], [0, -16]], '#6b4423', 2);
    poly(ctx, [[1.5, -15], [1.5, -2], [12, -2]], '#fffdf5');
    poly(ctx, [[-1.5, -12], [-1.5, -2], [-8, -2]], '#ff6b6b');
  },
  buoy(ctx) {
    dot(ctx, 0, 0, 9, '#ff5a4d');
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 4;
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 7, (i / 4) * TAU, (i / 4) * TAU + 0.6);
      ctx.stroke();
    }
    dot(ctx, 0, 0, 4, '#3aa0d0');
  },
  crest(ctx) {
    for (const [x, y] of [[-8, -4], [3, 3]]) {
      ctx.strokeStyle = 'rgba(255, 255, 255, 0.85)';
      ctx.lineWidth = 2.2;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.arc(x, y, 5, Math.PI, TAU);
      ctx.arc(x + 9, y, 4, Math.PI, TAU * 0.9);
      ctx.stroke();
    }
  },
  fin(ctx) {
    blob(ctx, 0, 6, 12, 3, 'rgba(255, 255, 255, 0.5)');
    poly(ctx, [[-7, 6], [3, -10], [7, 6]], '#5f6f7d');
  },
  shell(ctx) {
    ctx.fillStyle = '#ffc2cf';
    ctx.beginPath();
    ctx.moveTo(0, 7);
    ctx.arc(0, 0, 8, Math.PI * 0.85, Math.PI * 0.15, false);
    ctx.closePath();
    ctx.fill();
    for (const a of [-0.9, -0.3, 0.3, 0.9]) line(ctx, [[0, 6], [Math.sin(a) * 8, -Math.cos(a) * 7]], '#e88aa0', 1);
  },
  starfish(ctx) {
    const pts = [];
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 4 : 10;
      const a = (i / 10) * TAU - Math.PI / 2;
      pts.push([Math.cos(a) * r, Math.sin(a) * r]);
    }
    poly(ctx, pts, '#ff9a3d');
    dot(ctx, 0, 0, 1.6, '#ffd08a');
  },
  crab(ctx) {
    for (const s of [1, -1]) {
      line(ctx, [[5 * s, 2], [11 * s, 6]], '#c93a2f', 1.6);
      line(ctx, [[5 * s, 0], [12 * s, 1]], '#c93a2f', 1.6);
      line(ctx, [[5 * s, -3], [9 * s, -8]], '#c93a2f', 2);
      dot(ctx, 10 * s, -9, 3.2, '#e5484d');
      line(ctx, [[2.5 * s, -4], [3 * s, -8]], '#c93a2f', 1.2);
      dot(ctx, 3 * s, -8.5, 1.5, '#fff');
      dot(ctx, 3 * s, -8.5, 0.7, '#222');
    }
    blob(ctx, 0, 0, 8, 5.5, '#e5484d');
  },
  sandcastle(ctx) {
    shadow(ctx, 12);
    ctx.fillStyle = '#e2bd72';
    ctx.fillRect(-11, 0, 22, 11);
    ctx.fillRect(-11, -7, 6, 8);
    ctx.fillRect(5, -7, 6, 8);
    ctx.fillRect(-3, -11, 6, 12);
    ctx.fillStyle = '#b98f48';
    ctx.fillRect(-2, 4, 4, 7);
    line(ctx, [[0, -11], [0, -18]], '#6b4423', 1.2);
    poly(ctx, [[0, -18], [7, -15.5], [0, -13]], '#e5484d');
  },
  parasol(ctx) {
    // A towel, and the parasol seen from a little above.
    ctx.save();
    ctx.rotate(0.25);
    ctx.fillStyle = '#5ec8e0';
    ctx.fillRect(-4, 4, 20, 10);
    ctx.fillStyle = '#fff';
    ctx.fillRect(-4, 7, 20, 2);
    ctx.restore();
    blob(ctx, 2, 3, 15, 6, 'rgba(0, 0, 0, 0.16)');
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#fff' : '#ff5a4d';
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.arc(0, -4, 15, (i / 8) * TAU, ((i + 1) / 8) * TAU);
      ctx.closePath();
      ctx.fill();
    }
    dot(ctx, 0, -4, 2, '#7a5226');
  },

  // ---------- graveyard ----------
  tombstone(ctx) {
    shadow(ctx, 10);
    ctx.fillStyle = '#9a98a8';
    ctx.beginPath();
    ctx.roundRect(-8, -13, 16, 25, [8, 8, 1, 1]);
    ctx.fill();
    ctx.fillStyle = '#c3c1cf';
    ctx.beginPath();
    ctx.roundRect(-8, -13, 5, 25, [8, 0, 0, 1]);
    ctx.fill();
    line(ctx, [[0, -8], [0, 1]], '#55526a', 1.8);
    line(ctx, [[-3.5, -5], [3.5, -5]], '#55526a', 1.8);
    line(ctx, [[-4, 6], [4, 6]], '#55526a', 1.2);
  },
  grave(ctx) {
    blob(ctx, 0, 6, 14, 7, '#5a4634');
    blob(ctx, -2, 4, 9, 4, '#6f5842');
    line(ctx, [[0, 3], [0, -15]], '#8a6a45', 3);
    line(ctx, [[-6, -9], [6, -9]], '#8a6a45', 3);
  },
  crow(ctx) {
    ctx.fillStyle = '#6b5236';
    ctx.fillRect(-3, 4, 6, 9);
    blob(ctx, 0, -1, 8, 6, '#15131d');
    dot(ctx, 6, -6, 4.5, '#15131d');
    poly(ctx, [[9.5, -7], [15, -5.5], [9.5, -4.5]], '#f2b705');
    dot(ctx, 7, -7, 1, '#fff');
    poly(ctx, [[-6, -1], [-15, -5], [-13, 2]], '#15131d');
  },
  scarecrow(ctx) {
    line(ctx, [[0, 14], [0, -8]], '#7a5a34', 2.5);
    line(ctx, [[-12, -2], [12, -2]], '#7a5a34', 2.5);
    poly(ctx, [[-7, -3], [7, -3], [5, 9], [-5, 9]], '#8a4b2b');
    for (const s of [1, -1]) line(ctx, [[12 * s, -2], [15 * s, 2]], '#d9b35a', 1.4);
    dot(ctx, 0, -9, 5.5, '#e6cf96');
    dot(ctx, -2, -10, 0.9, '#222');
    dot(ctx, 2, -10, 0.9, '#222');
    line(ctx, [[-2, -7], [2, -7]], '#222', 0.9);
    poly(ctx, [[-8, -13], [8, -13], [4, -14.5], [0, -21], [-4, -14.5]], '#4a3a2a');
  },
  skull,
  pumpkin(ctx) {
    shadow(ctx, 10);
    blob(ctx, -4, 3, 6, 8, '#f08a1c');
    blob(ctx, 4, 3, 6, 8, '#f08a1c');
    blob(ctx, 0, 3, 5.5, 8.5, '#ff9f2e');
    ctx.fillStyle = '#4f7a2a';
    ctx.fillRect(-1.2, -9, 2.4, 4);
    poly(ctx, [[-5, 0], [-2, 0], [-3.5, -3]], '#2a1a08');
    poly(ctx, [[5, 0], [2, 0], [3.5, -3]], '#2a1a08');
    line(ctx, [[-4, 5], [-1.5, 7], [1.5, 5], [4, 7]], '#2a1a08', 1.5);
  },
  deadTree(ctx) {
    line(ctx, [[0, 13], [0, -6]], '#3a2c22', 3.5);
    line(ctx, [[0, -1], [-8, -9], [-11, -15]], '#3a2c22', 2);
    line(ctx, [[0, -5], [7, -11], [12, -11]], '#3a2c22', 2);
    line(ctx, [[-8, -9], [-13, -8]], '#3a2c22', 1.4);
    line(ctx, [[7, -11], [8, -17]], '#3a2c22', 1.4);
  },
  cobweb(ctx) {
    ctx.strokeStyle = 'rgba(230, 225, 245, 0.45)';
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI;
      ctx.beginPath();
      ctx.moveTo(Math.cos(a) * -11, Math.sin(a) * -11);
      ctx.lineTo(Math.cos(a) * 11, Math.sin(a) * 11);
      ctx.stroke();
    }
    for (const r of [4, 8]) {
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.stroke();
    }
  },
};

// What goes on the walls and on the open ground of each map. A name listed more
// than once turns up more often.
export const SCENERY = {
  meadow: { walls: ['mushroom', 'rock', 'stump', 'mushroom'], share: 0.1, ground: ['clover', 'daisy', 'clover', 'daisy', 'rock'] },
  desert: { walls: ['cactus', 'cactus', 'cowSkull', 'tumbleweed', 'cactus', 'rock'], share: 0.24, ground: ['pebbles', 'crack', 'bones', 'pebbles', 'tumbleweed', 'crack'] },
  factory: { walls: ['gear', 'crate', 'pipe', 'stripes', 'barrel', 'gear', 'crate'], share: 0.3, ground: ['chevron', 'oil', 'bolt', 'chevron', 'bolt'] },
  ice: { walls: ['pine', 'snowman', 'crystal', 'pine', 'crystal'], share: 0.24, ground: ['snowflake', 'snowpile', 'snowflake', 'snowpile'] },
  beach: { walls: ['boat', 'crest', 'buoy', 'crest', 'fin', 'crest', 'boat', 'crest'], share: 0.34, ground: ['shell', 'starfish', 'crab', 'parasol', 'shell', 'sandcastle', 'crab', 'starfish', 'parasol'] },
  graveyard: { walls: ['tombstone', 'grave', 'crow', 'scarecrow', 'skull', 'tombstone', 'deadTree', 'pumpkin', 'grave'], share: 0.34, ground: ['bones', 'cobweb', 'pumpkin', 'skull', 'cobweb', 'bones'] },
};
