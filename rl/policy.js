// Runs a trained policy from its exported JSON, with nothing but arrays, so the
// same file works in Node and in the browser. It mirrors Policy in train.py:
// normalise, one linear layer, residual blocks with LayerNorm, then the heads.

function linear(w, b, rows, cols, x) {
  const out = new Float32Array(rows);
  for (let r = 0; r < rows; r++) {
    let s = b[r];
    const at = r * cols;
    for (let c = 0; c < cols; c++) s += w[at + c] * x[c];
    out[r] = s;
  }
  return out;
}

function layerNorm(g, b, x) {
  let mean = 0;
  for (const v of x) mean += v;
  mean /= x.length;
  let varc = 0;
  for (const v of x) varc += (v - mean) * (v - mean);
  const std = Math.sqrt(varc / x.length + 1e-5);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) out[i] = ((x[i] - mean) / std) * g[i] + b[i];
  return out;
}

export function loadPolicy(json) {
  const p = Object.fromEntries(Object.entries(json).filter(([k]) => !k.endsWith('.shape')).map(([k, v]) => [k, Array.isArray(v) ? Float32Array.from(v) : v]));
  const { obs, width, blocks } = json.meta;
  const heads = json.heads;
  const outputs = heads.reduce((a, b) => a + b, 0);

  function logits(input) {
    const x0 = new Float32Array(obs);
    for (let i = 0; i < obs; i++) x0[i] = Math.max(-5, Math.min(5, (input[i] - p.mean[i]) / Math.sqrt(p.var[i] + 1e-6)));
    let x = linear(p['inp.weight'], p['inp.bias'], width, obs, x0);
    for (let b = 0; b < blocks; b++) {
      const h = layerNorm(p[`blocks.${b}.norm.weight`], p[`blocks.${b}.norm.bias`], x);
      const up = linear(p[`blocks.${b}.up.weight`], p[`blocks.${b}.up.bias`], width * 2, width, h);
      for (let i = 0; i < up.length; i++) if (up[i] < 0) up[i] = 0;
      const down = linear(p[`blocks.${b}.down.weight`], p[`blocks.${b}.down.bias`], width, width * 2, up);
      for (let i = 0; i < width; i++) x[i] += down[i];
    }
    x = layerNorm(p['norm.weight'], p['norm.bias'], x);
    return linear(p['pi.weight'], p['pi.bias'], outputs, width, x);
  }

  // One choice per head: [move 0-8, bonk 0/1, throw 0/1]. `temperature` 0 always
  // takes the likeliest; 1 plays as it was trained.
  function act(input, temperature = 1, random = Math.random) {
    const l = logits(input);
    const out = [];
    let at = 0;
    for (const size of heads) {
      let best = 0;
      for (let i = 1; i < size; i++) if (l[at + i] > l[at + best]) best = i;
      if (temperature > 0) {
        let total = 0;
        const w = [];
        for (let i = 0; i < size; i++) {
          w.push(Math.exp((l[at + i] - l[at + best]) / temperature));
          total += w[i];
        }
        let roll = random() * total;
        best = size - 1;
        for (let i = 0; i < size; i++) {
          roll -= w[i];
          if (roll <= 0) {
            best = i;
            break;
          }
        }
      }
      out.push(best);
      at += size;
    }
    return out;
  }

  return { act, logits, meta: json.meta };
}
