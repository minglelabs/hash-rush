// Tiny synthesised sound effects, so the game ships without audio files.

import { createMusic } from './music.js';

const KEY = 'seed-rush-muted';

export function createAudio() {
  let ctx = null;
  let muted = false;
  let track = null;
  try {
    muted = localStorage.getItem(KEY) === '1';
  } catch {
    // storage unavailable: start unmuted
  }
  const music = createMusic(() => ctx);

  // Browsers only allow audio after a user gesture, so call this from a click.
  // Safe to call on every tap until the context is running.
  function unlock() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    // iPhones mute web audio with the silent switch unless the page asks for playback.
    try {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
    } catch {
      // not supported
    }
    if (!ctx) ctx = new AC();
    if (ctx.state !== 'running') {
      ctx.resume().catch(() => {});
      // Older WebKit only wakes up once something actually plays inside the gesture.
      const src = ctx.createBufferSource();
      src.buffer = ctx.createBuffer(1, 1, 22050);
      src.connect(ctx.destination);
      src.start(0);
    }
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
    // A toy hammer: a squeaky chirp up and back, a soft thump under it for weight
    // and a tiny click on top for the contact.
    bonk: () => {
      tone({ f: 520, to: 1500, dur: 0.07, type: 'triangle', vol: 0.11 });
      tone({ f: 1500, to: 900, dur: 0.09, vol: 0.07, at: 0.06 });
      tone({ f: 190, to: 70, dur: 0.09, vol: 0.12 });
      noise({ dur: 0.025, vol: 0.06, cutoff: 2500 });
    },
    // The map got somebody: a low thud and a rattle.
    zap: () => {
      tone({ f: 260, to: 60, dur: 0.22, type: 'square', vol: 0.07 });
      noise({ dur: 0.12, vol: 0.07, cutoff: 900 });
    },
    // Something is about to happen on the map: two soft pips.
    omen: () => [990, 1320].forEach((f, i) => tone({ f, dur: 0.06, type: 'triangle', vol: 0.035, at: i * 0.08 })),
    // A wave breaking.
    splash: () => noise({ dur: 0.45, vol: 0.05, cutoff: 1200 }),
    // A seed thrown: a quick whistle through the air.
    toss: () => {
      tone({ f: 1400, to: 500, dur: 0.16, type: 'triangle', vol: 0.07 });
      noise({ dur: 0.12, vol: 0.05, cutoff: 3000 });
    },
    // Two down with one swing: a bright pair of notes after the hit.
    double: () => [1319, 1760].forEach((f, i) => tone({ f, dur: 0.2, type: 'triangle', vol: 0.08, at: 0.09 + i * 0.09 })),
    // Three or more: a rising fanfare with a sparkle on top.
    triple: () => {
      [1047, 1319, 1568, 2093].forEach((f, i) => {
        tone({ f, dur: 0.2, type: 'triangle', vol: 0.08, at: 0.09 + i * 0.075 });
        tone({ f: f / 2, dur: 0.2, type: 'square', vol: 0.025, at: 0.09 + i * 0.075 });
      });
      tone({ f: 3136, dur: 0.55, vol: 0.04, at: 0.39 });
      tone({ f: 2637, dur: 0.55, vol: 0.035, at: 0.39 });
    },
    // A seed stopped at the door: a quick run up into a held chord.
    superplay: () => {
      [784, 988, 1175, 1568, 1976, 2349].forEach((f, i) => tone({ f, dur: 0.1, type: 'triangle', vol: 0.07, at: 0.08 + i * 0.045 }));
      for (const f of [1568, 1976, 2349]) tone({ f, dur: 0.6, vol: 0.045, at: 0.36 });
      tone({ f: 3136, dur: 0.6, vol: 0.03, at: 0.36 });
    },
    spawn: () => tone({ f: 300, to: 640, dur: 0.1, vol: 0.05 }),
    // A bright run up the scale: somebody got a seed.
    seed: () => {
      [784, 1047, 1319, 1568].forEach((f, i) => tone({ f, dur: 0.14, type: 'triangle', vol: 0.09, at: i * 0.065 }));
      tone({ f: 2093, dur: 0.4, vol: 0.06, at: 0.26 });
    },
    // A two-note siren, kept quiet: a seed is almost home.
    siren: () => {
      for (let i = 0; i < 3; i++) {
        tone({ f: 740, to: 760, dur: 0.17, type: 'square', vol: 0.035, at: i * 0.36 });
        tone({ f: 560, to: 550, dur: 0.17, type: 'square', vol: 0.035, at: i * 0.36 + 0.18 });
      }
    },
    // A clock's tick and tock, through overtime.
    tick: (tock) => tone({ f: tock ? 1500 : 2100, dur: 0.035, type: 'square', vol: 0.03 }),
    // The start lights of a kart race: three flat beeps, then a long high ding.
    count: () => tone({ f: 440, dur: 0.22, type: 'square', vol: 0.06 }),
    go: () => {
      tone({ f: 880, dur: 0.9, type: 'square', vol: 0.05 });
      tone({ f: 880, dur: 1.1, vol: 0.1 });
      tone({ f: 1760, dur: 0.6, vol: 0.04 });
    },
    // The ringside bell, three strikes: overtime.
    overtime: () => {
      for (let i = 0; i < 3; i++) {
        const at = i * 0.3;
        tone({ f: 1250, dur: 0.9, vol: 0.1, at });
        tone({ f: 1250 * 2.76, dur: 0.5, vol: 0.04, at });
        tone({ f: 1250 * 5.4, dur: 0.25, vol: 0.02, at });
        tone({ f: 1262, dur: 0.9, vol: 0.05, at });
      }
    },
    // Ta-da-da-da-daaa: the champion's fanfare, brassy, with a chord under the last note.
    fanfare: () => {
      const brass = (f, at, dur, vol = 0.09) => {
        tone({ f, dur, type: 'sawtooth', vol: vol * 0.55, at });
        tone({ f, dur, type: 'square', vol: vol * 0.35, at });
        tone({ f: f * 2, dur: dur * 0.7, type: 'triangle', vol: vol * 0.3, at });
      };
      [392, 392, 392, 523].forEach((f, i) => brass(f, i * 0.17, 0.16));
      brass(659, 0.68, 0.3);
      brass(784, 1.0, 1.9, 0.11);
      [523, 659].forEach((f) => brass(f, 1.0, 1.9, 0.05));
      [1047, 1319, 1568, 2093].forEach((f, i) => tone({ f, dur: 0.5, vol: 0.05, at: 1.5 + i * 0.12 }));
    },
    // A crowd going "waaah": a swell of voice-band noise with clapping scattered through it.
    cheer: () => {
      if (muted || !ctx) return;
      const dur = 4.5;
      const len = Math.ceil(ctx.sampleRate * dur);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
      const t0 = ctx.currentTime + 0.3;
      for (const [freq, q, vol] of [[750, 0.9, 0.16], [1250, 1.2, 0.11], [2600, 1.5, 0.05]]) {
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const band = ctx.createBiquadFilter();
        band.type = 'bandpass';
        band.Q.value = q;
        // The vowel opens up as the cheer rises.
        band.frequency.setValueAtTime(freq * 0.8, t0);
        band.frequency.linearRampToValueAtTime(freq * 1.15, t0 + 0.9);
        band.frequency.linearRampToValueAtTime(freq, t0 + dur);
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(vol, t0 + 0.7);
        gain.gain.setValueAtTime(vol, t0 + 2.2);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(band).connect(gain).connect(ctx.destination);
        src.start(t0);
        src.stop(t0 + dur);
      }
      for (let i = 0; i < 26; i++) setTimeout(() => noise({ dur: 0.03, vol: 0.05, cutoff: 1500 }), 500 + Math.random() * 3200);
    },
    win: () => [523, 659, 784, 1047].forEach((f, i) => tone({ f, dur: 0.2, type: 'triangle', at: i * 0.12 })),
    lose: () => [440, 370, 311, 262].forEach((f, i) => tone({ f, dur: 0.22, type: 'triangle', vol: 0.09, at: i * 0.15 })),
  };

  function toggle() {
    muted = !muted;
    music.set(muted ? null : track);
    try {
      localStorage.setItem(KEY, muted ? '1' : '0');
    } catch {
      // not persisted
    }
  }

  // Which tune suits the screen: 'lobby', 'game' or null. It starts once sound is unlocked.
  function setMusic(name) {
    track = name;
    music.set(muted ? null : track);
  }

  return { unlock, play, toggle, setMusic, icon: () => (muted ? '🔇' : '🔊'), ready: () => ctx?.state === 'running' };
}
