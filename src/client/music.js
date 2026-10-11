// Background music, synthesised note by note so the game still ships without audio
// files. A tune is written as sections of eight bars: a chord per bar and a melody
// in eighth notes ("E5" plays, "-" holds the note, "." rests). The bass, the
// arpeggio and the drums are worked out from the chords.

const SEMITONE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
const ACCIDENTAL = { '#': 1, b: -1, '': 0 };
const hz = (midi) => 440 * 2 ** ((midi - 69) / 12);

export function noteNumber(name) {
  const m = /^([A-G])([#b]?)(\d)$/.exec(name);
  if (!m) throw new Error(`bad note ${name}`);
  return 12 * (Number(m[3]) + 1) + SEMITONE[m[1]] + ACCIDENTAL[m[2]];
}

// Root, third and fifth of a major or minor chord, around the octave below middle C.
function chordTones(name) {
  const m = /^([A-G])([#b]?)(m?)$/.exec(name);
  if (!m) throw new Error(`bad chord ${name}`);
  const root = 48 + SEMITONE[m[1]] + ACCIDENTAL[m[2]];
  return [root, root + (m[3] ? 3 : 4), root + 7];
}

const section = (chords, mel) => ({ chords: chords.split(' '), mel });

// "Seed Dash": bouncy and bright, for a round.
const A1 = section('C G Am F C G F,G C', [
  'E5 . G5 . C6 . G5 E5',
  'D5 . G5 . B5 . G5 D5',
  'C5 . E5 . A5 . E5 C5',
  'A5 G5 F5 E5 F5 - A5 -',
  'G5 . E5 G5 C6 - . G5',
  'B5 . G5 B5 D6 - . B5',
  'C6 A5 F5 A5 D6 B5 G5 B5',
  'C6 - - . G5 . C6 .',
]);
const A2 = section('C G Am F C G F,G C', [
  'C6 . C6 B5 C6 . G5 .',
  'B5 . B5 A5 B5 . G5 .',
  'A5 . A5 G5 A5 . E5 .',
  'F5 G5 A5 C6 A5 - G5 -',
  'E5 G5 C6 E6 D6 C6 G5 .',
  'D5 G5 B5 D6 C6 B5 G5 .',
  'A5 C6 F6 C6 B5 D6 G6 D6',
  'E6 - C6 - C6 - . .',
]);
const B = section('F G Em Am Dm G C C', [
  'A5 - C6 A5 F5 - A5 -',
  'B5 - D6 B5 G5 - B5 -',
  'G5 - B5 G5 E5 - G5 B5',
  'A5 - - G5 E5 - C5 -',
  'F5 - A5 F5 D5 - F5 A5',
  'G5 - B5 G5 D5 - G5 B5',
  'C6 . G5 . E5 . G5 .',
  'C6 D6 E6 D6 C6 - . .',
]);
const C = section('Am F C G Am F G G', [
  'A4 . C5 . E5 - - .',
  'A4 . C5 . F5 - - .',
  'G4 . C5 . E5 - G5 -',
  'D5 - B4 - G4 - . .',
  'A4 C5 E5 A5 E5 C5 A4 .',
  'A4 C5 F5 A5 F5 C5 A4 .',
  'B4 D5 G5 B5 G5 D5 B4 D5',
  'G5 A5 B5 D6 G6 - - .',
]);
const D = section('C C F F G G C G', [
  'G5 G5 . E5 G5 . C6 .',
  'G5 G5 . E5 G5 . E5 .',
  'A5 A5 . F5 A5 . C6 .',
  'A5 A5 . F5 A5 . F5 .',
  'B5 B5 . G5 B5 . D6 .',
  'D6 C6 B5 A5 G5 A5 B5 D6',
  'E6 . C6 . G5 . E5 .',
  'D5 G5 B5 D6 G6 - . .',
]);
const E = section('C G Am F C G F,G C', [
  'E5 - - - - - G5 -',
  'D5 - - - - - G5 -',
  'C5 - - - - - E5 -',
  'F5 - - - A5 - - -',
  'E5 - - - - - C6 -',
  'D6 - - - - - B5 -',
  'A5 - - - B5 - - -',
  'C6 - - - - - - .',
]);
const TURN = section('G G', ['D5 G5 B5 D6 B5 G5 D5 G5', 'G5 A5 B5 D6 G6 - - .']);

// "Burrow Lullaby": a slow music box, for the waiting room.
const L1 = section('F Am Bb C F Dm Bb,C F', [
  'A5 - C6 - A5 - F5 -',
  'G5 - A5 - E5 - - .',
  'F5 - G5 - Bb5 - D6 -',
  'C6 - - - G5 - - .',
  'A5 - C6 - F6 - C6 -',
  'D6 - A5 - F5 - - .',
  'D6 - Bb5 - C6 - E6 -',
  'F6 - - - C6 - - .',
]);
const L2 = section('Dm Bb F C Dm Bb C C', [
  'F5 - A5 - D6 - A5 -',
  'F5 - Bb5 - D6 - Bb5 -',
  'F5 - A5 - C6 - A5 -',
  'G5 - - - E5 - - .',
  'A5 - D6 - F6 - D6 -',
  'Bb5 - D6 - F6 - D6 -',
  'E6 - C6 - G5 - C6 -',
  'E6 - D6 - C6 - - .',
]);
const L3 = section('F F Bb Bb Gm C F C', [
  'C6 - - - A5 - - -',
  'F5 - - - - - A5 -',
  'D6 - - - Bb5 - - -',
  'F5 - - - - - Bb5 -',
  'Bb5 - A5 - G5 - - -',
  'E5 - G5 - C6 - - -',
  'A5 - - - F5 - - -',
  'G5 - - - - - . .',
]);

// drums: 0 none, 1 light, 2 full. up: semitones the whole section is lifted by.
export const TRACKS = {
  game: {
    bpm: 138,
    style: 'game',
    form: [
      { sec: A1, bars: 4, mel: false, drums: 1 },
      { sec: A1, drums: 2 },
      { sec: A2, drums: 2 },
      { sec: B, drums: 2 },
      { sec: A2, drums: 2 },
      { sec: C, drums: 1 },
      { sec: D, drums: 2 },
      { sec: B, drums: 2 },
      { sec: A1, drums: 2 },
      { sec: E, drums: 0, soft: true },
      { sec: A2, drums: 1 },
      { sec: B, drums: 2 },
      { sec: C, drums: 1 },
      { sec: D, drums: 2, up: 2 },
      { sec: B, drums: 2, up: 2 },
      { sec: A1, drums: 2, up: 2 },
      { sec: A2, drums: 2, up: 2 },
      { sec: TURN, drums: 2 },
    ],
  },
  lobby: {
    bpm: 92,
    style: 'lobby',
    form: [
      { sec: L1, drums: 0 },
      { sec: L2, drums: 1 },
      { sec: L1, drums: 1 },
      { sec: L3, drums: 0 },
      { sec: L2, drums: 1 },
      { sec: L1, drums: 1 },
    ],
  },
};

// A track as a flat list of bars, each ready to schedule.
export function barsOf(track) {
  const bars = [];
  for (const part of track.form) {
    const count = part.bars ?? part.sec.chords.length;
    for (let i = 0; i < count; i++) {
      bars.push({
        chords: part.sec.chords[i].split(',').map(chordTones),
        mel: part.mel === false ? null : part.sec.mel[i].split(' '),
        drums: part.drums,
        soft: !!part.soft,
        up: part.up || 0,
        last: i === count - 1,
      });
    }
  }
  return bars;
}

export const trackSeconds = (track) => (barsOf(track).length * 240) / track.bpm;

// `getCtx()` returns the AudioContext once the page has been tapped, and null before.
export function createMusic(getCtx) {
  let want = null;
  let playing = null;
  let out = null;
  let bars = [];
  let index = 0;
  let nextAt = 0;
  let noiseBuf = null;
  let timer = 0;

  function note(ctx, { f, at, dur, type = 'sine', vol, pluck = false, attack = 0.008 }) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(vol, at + attack);
    if (pluck) {
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    } else {
      gain.gain.setValueAtTime(vol, at + Math.max(attack, dur - 0.05));
      gain.gain.linearRampToValueAtTime(0.0001, at + dur);
    }
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + dur + 0.03);
  }

  function hiss(ctx, { at, dur, vol, cutoff }) {
    if (!noiseBuf) {
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate / 2, ctx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    }
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = cutoff;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
    src.connect(filter).connect(gain).connect(out);
    src.start(at, Math.random() * 0.3, dur + 0.02);
  }

  function kick(ctx, at, vol) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.frequency.setValueAtTime(150, at);
    osc.frequency.exponentialRampToValueAtTime(45, at + 0.12);
    gain.gain.setValueAtTime(vol, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.16);
    osc.connect(gain).connect(out);
    osc.start(at);
    osc.stop(at + 0.18);
  }

  function melody(ctx, bar, at, step, play) {
    for (let i = 0; i < bar.mel.length; i++) {
      const token = bar.mel[i];
      if (token === '.' || token === '-') continue;
      let held = 1;
      while (bar.mel[i + held] === '-') held++;
      play(hz(noteNumber(token) + bar.up), at + i * step, held * step);
    }
  }

  function gameBar(ctx, bar, at, len) {
    const step = len / 8;
    if (bar.mel) {
      melody(ctx, bar, at, step, (f, t, dur) => {
        if (bar.soft) {
          note(ctx, { f, at: t, dur: dur * 0.98, type: 'triangle', vol: 0.05, attack: 0.03 });
        } else {
          note(ctx, { f, at: t, dur: dur * 0.9, type: 'square', vol: 0.022 });
          note(ctx, { f, at: t, dur: dur * 0.9, type: 'triangle', vol: 0.04 });
        }
      });
    }
    for (let i = 0; i < 8; i++) {
      const [root, third, fifth] = bar.chords[Math.floor((i * bar.chords.length) / 8)].map((n) => n + bar.up);
      const t = at + i * step;
      // Arpeggio: root, fifth, third, fifth, then the same from the octave above.
      const arp = [root + 12, fifth + 12, third + 12, fifth + 12, root + 24, fifth + 12, third + 12, fifth + 12][i];
      note(ctx, { f: hz(arp), at: t, dur: step * 0.9, type: 'triangle', vol: 0.03, pluck: true });
      // Bass bounces between the root and the fifth.
      const low = root > 55 ? root - 12 : root;
      if (i === 0 || i === 3 || i === 6) note(ctx, { f: hz(low), at: t, dur: step * 1.3, type: 'triangle', vol: 0.085 });
      if (i === 4) note(ctx, { f: hz(low + 7), at: t, dur: step * 1.3, type: 'triangle', vol: 0.07 });
      if (bar.drums) hiss(ctx, { at: t, dur: 0.03, vol: i % 2 ? 0.02 : 0.011, cutoff: 7000 });
      if (bar.drums === 2) {
        if (i === 0 || i === 4) kick(ctx, t, 0.16);
        if (i === 2 || i === 6) hiss(ctx, { at: t, dur: 0.1, vol: 0.05, cutoff: 1800 });
      } else if (bar.drums === 1 && i === 0) {
        kick(ctx, t, 0.11);
      }
    }
    // A short roll into the next section.
    if (bar.last && bar.drums === 2) for (const i of [6.5, 7, 7.5]) hiss(ctx, { at: at + i * step, dur: 0.07, vol: 0.04, cutoff: 1800 });
  }

  function lobbyBar(ctx, bar, at, len) {
    const step = len / 8;
    if (bar.mel) {
      // Music box: a sine that rings out, with a quiet octave on top.
      melody(ctx, bar, at, step, (f, t, dur) => {
        note(ctx, { f, at: t, dur: Math.max(0.7, dur * 1.4), vol: 0.075, pluck: true, attack: 0.004 });
        note(ctx, { f: f * 2, at: t, dur: 0.35, vol: 0.018, pluck: true, attack: 0.004 });
      });
    }
    bar.chords.forEach(([root, third, fifth], k) => {
      const t = at + (k * len) / bar.chords.length;
      const dur = len / bar.chords.length;
      // A soft pad under everything.
      for (const n of [root + 12, third + 12, fifth + 12]) note(ctx, { f: hz(n), at: t, dur, vol: 0.014, attack: 0.25 });
      note(ctx, { f: hz(root > 55 ? root - 12 : root), at: t, dur: dur * 0.9, type: 'triangle', vol: 0.07, attack: 0.02 });
    });
    for (let beat = 0; beat < 4; beat++) {
      const [root, third, fifth] = bar.chords[Math.floor((beat * bar.chords.length) / 4)];
      const t = at + beat * 2 * step;
      note(ctx, { f: hz([root, fifth, third + 12, fifth][beat] + 12), at: t + step, dur: step * 1.6, type: 'triangle', vol: 0.028, pluck: true });
      if (bar.drums && beat % 2) hiss(ctx, { at: t, dur: 0.05, vol: 0.012, cutoff: 6000 });
    }
  }

  function tick() {
    const ctx = getCtx();
    if (!ctx || ctx.state !== 'running' || document.hidden) return;
    if (want !== playing) {
      // Fade the old tune out; whatever was already scheduled plays into silence.
      if (out) {
        const old = out;
        old.gain.setTargetAtTime(0, ctx.currentTime, 0.12);
        setTimeout(() => old.disconnect(), 1500);
        out = null;
      }
      playing = want;
      if (!playing) return;
      out = ctx.createGain();
      out.gain.setValueAtTime(0.0001, ctx.currentTime);
      out.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.4);
      out.connect(ctx.destination);
      bars = barsOf(TRACKS[playing]);
      index = 0;
      nextAt = ctx.currentTime + 0.15;
    }
    if (!playing) return;
    const track = TRACKS[playing];
    const len = 240 / track.bpm;
    // Coming back from a hidden tab: pick up from now rather than catching up.
    if (nextAt < ctx.currentTime) nextAt = ctx.currentTime + 0.1;
    while (nextAt < ctx.currentTime + 1.2) {
      (track.style === 'game' ? gameBar : lobbyBar)(ctx, bars[index], nextAt, len);
      nextAt += len;
      index = (index + 1) % bars.length;
    }
  }

  return {
    // 'game', 'lobby' or null for silence. Asking for the tune already playing keeps it going.
    set(name) {
      want = name;
      if (!timer) timer = setInterval(tick, 200);
      tick();
    },
  };
}
