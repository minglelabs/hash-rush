// Packs a trained policy for the game: half-precision weights, about a quarter of
// policy.json's size, loaded by the RL bot (src/ai/rl-bot.js).
//   node rl/export.js rl/runs/long/policy.json [rl | rl2]
// Writes src/ai/rl-policy.bin, or rl2-policy.bin for the RL2 level.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const json = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const tensors = Object.keys(json)
  .filter((k) => Array.isArray(json[k]) && !k.endsWith('.shape'))
  .map((k) => [k, json[k].length]);
const head = Buffer.from(JSON.stringify({ meta: json.meta, heads: json.heads, tensors }));
const total = tensors.reduce((n, [, len]) => n + len, 0);
const out = Buffer.alloc(4 + head.length + 2 * total);
out.writeUInt32LE(head.length, 0);
head.copy(out, 4);
let at = 4 + head.length;
for (const [k] of tensors) for (const v of json[k]) at = out.writeUInt16LE(half(v), at);

const path = fileURLToPath(new URL(`../src/ai/${process.argv[3] || 'rl'}-policy.bin`, import.meta.url));
writeFileSync(path, out);
console.log(`${path}: ${(out.length / 1e6).toFixed(1)} MB, iteration ${json.meta.iter}`);

// float32 to float16, rounding to nearest.
function half(v) {
  const f = new Float32Array([v]);
  const x = new Uint32Array(f.buffer)[0];
  const sign = (x >>> 16) & 0x8000;
  const e = ((x >>> 23) & 0xff) - 127 + 15;
  const m = x & 0x7fffff;
  if (e >= 31) return sign | 0x7c00;
  if (e <= 0) return e < -10 ? sign : sign | ((m | 0x800000) >> (14 - e));
  const h = sign | (e << 10) | (m >> 13);
  return m & 0x1000 ? h + 1 : h;
}
