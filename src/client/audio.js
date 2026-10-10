// Tiny synthesised sound effects, so the game ships without audio files.

const KEY = 'seed-rush-muted';

export function createAudio() {
  let ctx = null;
  let muted = false;
  try {
    muted = localStorage.getItem(KEY) === '1';
  } catch {
    // storage unavailable: start unmuted
  }

  // Browsers only allow audio after a user gesture, so call this from a click.
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!ctx) ctx = new AC();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function tone({ f, to = f, dur = 0.12, type = 'sine', vol = 0.12, at = 0 }) {
    if (muted || !ctx) return;
    const t0 = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(f, t0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t0 + dur);
    gain.gain.setValueAtTime(vol, t0);
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(gain).connect(ctx.destination);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  function noise({ dur = 0.08, vol = 0.1, cutoff = 800 }) {
    if (muted || !ctx) return;
    const len = Math.ceil(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(ctx.destination);
    src.start();
  }

  const play = {
    swing: () => noise({ dur: 0.07, vol: 0.05, cutoff: 1800 }),
    bonk: () => {
      tone({ f: 330, to: 80, dur: 0.15, type: 'square', vol: 0.1 });
      noise({ dur: 0.06, vol: 0.14, cutoff: 400 });
    },
    spawn: () => tone({ f: 300, to: 640, dur: 0.1, vol: 0.05 }),
    seed: () => {
      tone({ f: 880, dur: 0.09 });
      tone({ f: 1320, dur: 0.16, at: 0.09 });
    },
    count: () => tone({ f: 520, dur: 0.1, type: 'triangle' }),
    go: () => tone({ f: 1040, dur: 0.3, type: 'triangle' }),
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.2, type: 'triangle', at: i * 0.12 })),
    lose: () => [440, 370, 311, 262].forEach((f, i) => tone({ f, dur: 0.22, type: 'triangle', vol: 0.09, at: i * 0.15 })),
  };

  function toggle() {
    muted = !muted;
    try {
      localStorage.setItem(KEY, muted ? '1' : '0');
    } catch {
      // not persisted
    }
    return muted;
  }

  return { unlock, play, toggle, isMuted: () => muted };
}
