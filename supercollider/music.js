// Music generation core. Pure functions: (profile, seed, barIdx) -> events.
// An event = { time: secondsFromBarStart, def: 'kick', args: {...} }

// ---------- seeded RNG (mulberry32) ----------
export function makeRng(seed) {
  let s = seed >>> 0;
  const next = () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    float: () => next(),
    range: (a, b) => a + (b - a) * next(),
    int:   (a, b) => Math.floor(a + (b - a + 1) * next()),
    pick:  (arr) => arr[Math.floor(next() * arr.length)],
    chance:(p) => next() < p,
  };
}

// ---------- music theory ----------
const SCALES = {
  ionian:           [0,2,4,5,7,9,11],
  dorian:           [0,2,3,5,7,9,10],
  phrygian:         [0,1,3,5,7,8,10],
  lydian:           [0,2,4,6,7,9,11],
  mixolydian:       [0,2,4,5,7,9,10],
  aeolian:          [0,2,3,5,7,8,10],
  pentMinor:        [0,3,5,7,10],
  majorPentatonic:  [0,2,4,7,9],
  minorPentatonic:  [0,3,5,7,10],
  harmonicMinor:    [0,2,3,5,7,8,11],
  melodicMinor:     [0,2,3,5,7,9,11],
  doubleHarmonic:   [0,1,4,5,7,8,11],
  wholeTone:        [0,2,4,6,8,10],
  blues:            [0,3,5,6,7,10],
};

const midiToHz = (m) => 440 * Math.pow(2, (m - 69) / 12);

function degreeToMidi(tonic, scale, deg, octaveOffset = 0) {
  const intervals = SCALES[scale];
  const n = deg - 1;
  const oct = Math.floor(n / intervals.length);
  const pc = intervals[((n % intervals.length) + intervals.length) % intervals.length];
  return tonic + pc + 12 * (oct + octaveOffset);
}

function chordTones(tonic, scale, deg, ext = 'triad') {
  const offsets = ext === 'thirteenth' ? [0, 2, 4, 6, 8, 10, 12]
                : ext === 'eleventh'   ? [0, 2, 4, 6, 8, 10]
                : ext === 'ninth'      ? [0, 2, 4, 6, 8]
                : ext === 'seventh'    ? [0, 2, 4, 6]
                :                        [0, 2, 4];
  return offsets.map((d) => degreeToMidi(tonic, scale, deg + d));
}

function voiceLead(chord, prevTop, lo = 60, hi = 84) {
  const candidates = [];
  for (let oct = -1; oct <= 2; oct++) {
    for (let inv = 0; inv < chord.length; inv++) {
      const c = chord
        .map((n, i) => n + 12 * oct + (i < inv ? 12 : 0))
        .sort((a, b) => a - b);
      if (c.every((n) => n >= lo && n <= hi + 4) && c[c.length - 1] <= hi) {
        candidates.push(c);
      }
    }
  }
  if (!candidates.length) return chord.map((n) => n + 12);
  candidates.sort(
    (a, b) => Math.abs(a[a.length-1] - prevTop) - Math.abs(b[b.length-1] - prevTop)
  );
  return candidates[0];
}

// ---------- profiles (genres) ----------
// drumPattern values are velocities 0..1 per 16th step (16 steps = 1 bar).
// reverb: { room 0..1, damp 0..1, mix } — passed to /n_set on the reverb synth.
// delay:  { beats, fb, mix } — beats converted to seconds at runtime.
export const PROFILES = {
  ambient: {
    tonic: 60, scale: 'lydian', bpm: 60,
    progressions: [[1,3,4,1],[1,4,5,4],[1,6,4,5]],
    chordExt: 'ninth', barsPerChord: 8,
    bassStyle: 'none',
    leadDensity: 0,
    shimmerRate: 5,
    swing: 0,
    pad: { warmth: 0.9, sub: 1, amp: 0.08 },
    reverb: { room: 0.95, damp: 0.2, mix: 1.6 },
    delay:  { beats: 1.0, fb: 0.55, mix: 0.6 },
  },

  calming: {
    tonic: 65, scale: 'lydian', bpm: 70,
    progressions: [[1,3,4,1],[1,5,6,4],[1,2,1,5]],
    chordExt: 'ninth', barsPerChord: 4,
    bassStyle: 'rootSparse',
    leadDensity: 0.18,
    shimmerRate: 3,
    swing: 0,
    pad: { warmth: 0.85, sub: 0.7, amp: 0.07 },
    reverb: { room: 0.9, damp: 0.3, mix: 1.1 },
    delay:  { beats: 0.75, fb: 0.45, mix: 0.4 },
  },

  deepFocus: {
    tonic: 52, scale: 'dorian', bpm: 86,
    progressions: [[1,7,6,7],[1,4,7,3],[1,5,1,7]],
    chordExt: 'seventh', barsPerChord: 2,
    drumPattern: {
      kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 0.7,0,0,0, 0,0,0,0, 0.7,0,0,0],
      hat:   [0.9,0,0.5,0, 0.9,0,0.5,0, 0.9,0,0.5,0, 0.9,0,0.5,0.4],
    },
    bassStyle: 'rootSparse',
    leadDensity: 0.4,
    shimmerRate: 2,
    swing: 0.05,
    pad: { warmth: 0.55, sub: 0.5, amp: 0.07 },
    reverb: { room: 0.82, damp: 0.4, mix: 0.85 },
    delay:  { beats: 0.375, fb: 0.4, mix: 0.4 },
  },

  lofi: {
    tonic: 57, scale: 'aeolian', bpm: 78,
    progressions: [[1,6,3,7],[1,4,7,1],[6,4,1,5]],
    chordExt: 'seventh', barsPerChord: 2,
    drumPattern: {
      kick:  [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 0.9,0,0,0.5],
      hat:   [0.7,0,0.5,0, 0.7,0,0.5,0.4, 0.7,0,0.5,0, 0.7,0,0.5,0],
    },
    bassStyle: 'rootSparse',
    leadDensity: 0.3,
    shimmerRate: 1,
    swing: 0.16,
    pad: { warmth: 0.7, sub: 0.6, amp: 0.07 },
    reverb: { room: 0.78, damp: 0.5, mix: 0.75 },
    delay:  { beats: 0.5, fb: 0.45, mix: 0.4 },
  },

  jazzNoir: {
    tonic: 50, scale: 'dorian', bpm: 96,
    progressions: [[2,5,1,6],[1,6,2,5],[3,6,2,5]],
    chordExt: 'ninth', barsPerChord: 2,
    drumPattern: {
      kick: [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      rim:  [0,0,0,0, 0.7,0,0,0, 0,0,0,0, 0.7,0,0,0],
      ride: [1,0,0,0.6, 1,0,0.6,0, 1,0,0,0.6, 1,0,0.6,0],
    },
    bassStyle: 'walk',
    leadDensity: 0.5,
    shimmerRate: 0,
    swing: 0.2,
    pad: { warmth: 0.7, sub: 0.5, amp: 0.06 },
    reverb: { room: 0.7, damp: 0.5, mix: 0.6 },
    delay:  { beats: 0.25, fb: 0.25, mix: 0.2 },
  },

  techno: {
    tonic: 45, scale: 'phrygian', bpm: 128,
    progressions: [[1,1,1,2],[1,1,1,1]],
    chordExt: 'triad', barsPerChord: 4,
    drumPattern: {
      kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      hat:  [0,0,0.8,0, 0,0,0.8,0, 0,0,0.8,0, 0,0,0.8,0.5],
      clap: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
    },
    bassStyle: 'driving',
    leadDensity: 0,
    shimmerRate: 1,
    swing: 0,
    pad: { warmth: 0.4, sub: 0.4, amp: 0.06 },
    reverb: { room: 0.7, damp: 0.5, mix: 0.5 },
    delay:  { beats: 0.375, fb: 0.55, mix: 0.5 },
  },

  dnb: {
    tonic: 45, scale: 'aeolian', bpm: 174,
    progressions: [[1,6,3,7],[1,4,5,1]],
    chordExt: 'seventh', barsPerChord: 4,
    drumPattern: {
      kick:  [1,0,0,0, 0,0,0,0, 0,0,1,0, 0,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:   [0.7,0,0.6,0, 0.7,0,0.6,0.5, 0.7,0,0.6,0, 0.7,0,0.6,0.5],
    },
    bassStyle: 'sub',
    leadDensity: 0.22,
    shimmerRate: 1,
    swing: 0,
    pad: { warmth: 0.5, sub: 0.5, amp: 0.05 },
    reverb: { room: 0.7, damp: 0.5, mix: 0.55 },
    delay:  { beats: 0.25, fb: 0.5, mix: 0.4 },
  },

  dub: {
    tonic: 45, scale: 'aeolian', bpm: 75,
    progressions: [[1,1,4,1],[1,5,1,5]],
    chordExt: 'seventh', barsPerChord: 2,
    drumPattern: {
      kick:  [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      snare: [0,0,0,0, 0,0,1,0, 0,0,0,0, 0,0,1,0],
      hat:   [0,0,0.7,0, 0,0,0.7,0, 0,0,0.7,0, 0,0,0.7,0],
    },
    bassStyle: 'sub',
    leadDensity: 0.12,
    shimmerRate: 2,
    swing: 0,
    pad: { warmth: 0.7, sub: 0.8, amp: 0.07 },
    reverb: { room: 0.95, damp: 0.3, mix: 1.6 },
    delay:  { beats: 0.75, fb: 0.7, mix: 0.7 },
  },

  uplift: {
    tonic: 60, scale: 'ionian', bpm: 122,
    progressions: [[1,5,6,4],[6,4,1,5]],
    chordExt: 'triad', barsPerChord: 2,
    drumPattern: {
      kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      clap: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
      hat:  [0.7,0,0.5,0, 0.7,0,0.5,0, 0.7,0,0.5,0, 0.7,0,0.5,0],
    },
    bassStyle: 'driving',
    leadDensity: 0.5,
    shimmerRate: 1,
    swing: 0,
    pad: { warmth: 0.6, sub: 0.5, amp: 0.06 },
    reverb: { room: 0.78, damp: 0.4, mix: 0.6 },
    delay:  { beats: 0.375, fb: 0.4, mix: 0.4 },
  },

  neoSoul: {
    tonic: 53, scale: 'dorian', bpm: 84,
    progressions: [[1,4,7,3],[2,5,1,1]],
    chordExt: 'eleventh', barsPerChord: 2,
    drumPattern: {
      kick:  [1,0,0,0.4, 0,0,0.6,0, 0,0.5,0,0, 1,0,0,0],
      snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0.4],
      hat:   [0.6,0.4,0.7,0.4, 0.6,0.4,0.7,0.4, 0.6,0.4,0.7,0.4, 0.6,0.4,0.7,0.4],
    },
    bassStyle: 'rootGroove',
    leadDensity: 0.4,
    shimmerRate: 1,
    swing: 0.18,
    pad: { warmth: 0.78, sub: 0.6, amp: 0.07 },
    reverb: { room: 0.78, damp: 0.45, mix: 0.7 },
    delay:  { beats: 0.5, fb: 0.4, mix: 0.4 },
  },

  dreamPop: {
    tonic: 62, scale: 'lydian', bpm: 72,
    progressions: [[1,5,6,4],[1,3,4,4],[6,4,1,5]],
    chordExt: 'ninth', barsPerChord: 4,
    drumPattern: {
      kick:  [1,0,0,0, 0,0,0,0, 0.8,0,0,0, 0,0,0,0],
      snare: [0,0,0,0, 0.7,0,0,0, 0,0,0,0, 0.7,0,0,0],
      hat:   [0.35,0,0.2,0, 0.3,0,0.2,0, 0.35,0,0.2,0, 0.3,0,0.2,0],
    },
    bassStyle: 'rootSparse',
    leadDensity: 0.18,
    shimmerRate: 3,
    swing: 0.08,
    pad: { warmth: 0.92, sub: 0.75, amp: 0.075 },
    reverb: { room: 0.94, damp: 0.25, mix: 1.2 },
    delay:  { beats: 0.75, fb: 0.52, mix: 0.48 },
  },

  soulHop: {
    tonic: 58, scale: 'mixolydian', bpm: 88,
    progressions: [[1,4,2,5],[1,6,2,5],[4,5,1,6]],
    chordExt: 'eleventh', barsPerChord: 2,
    drumPattern: {
      kick:  [1,0,0,0.3, 0,0,0.6,0, 0.8,0,0,0, 0,0.4,0,0],
      snare: [0,0,0,0, 0.95,0,0,0, 0,0,0,0, 0.85,0,0,0.35],
      hat:   [0.55,0.25,0.65,0.25, 0.55,0.2,0.65,0.35, 0.55,0.25,0.65,0.25, 0.55,0.2,0.65,0.3],
    },
    bassStyle: 'rootGroove',
    leadDensity: 0.32,
    shimmerRate: 1,
    swing: 0.18,
    pad: { warmth: 0.8, sub: 0.62, amp: 0.068 },
    reverb: { room: 0.8, damp: 0.42, mix: 0.72 },
    delay:  { beats: 0.5, fb: 0.36, mix: 0.34 },
  },

  cityPop: {
    tonic: 61, scale: 'lydian', bpm: 110,
    progressions: [[1,5,6,3],[4,5,3,6],[1,3,4,5]],
    chordExt: 'thirteenth', barsPerChord: 2,
    drumPattern: {
      kick:  [1,0,0,0, 0.8,0,0,0, 1,0,0,0, 0.75,0,0,0],
      clap:  [0,0,0,0, 0.85,0,0,0, 0,0,0,0, 0.85,0,0,0],
      hat:   [0.6,0,0.45,0.15, 0.6,0,0.45,0.25, 0.6,0,0.45,0.15, 0.6,0,0.45,0.3],
    },
    bassStyle: 'driving',
    leadDensity: 0.42,
    shimmerRate: 2,
    swing: 0.04,
    pad: { warmth: 0.82, sub: 0.52, amp: 0.064 },
    reverb: { room: 0.74, damp: 0.38, mix: 0.62 },
    delay:  { beats: 0.375, fb: 0.34, mix: 0.34 },
  },

  bossaNova: {
    tonic: 60, scale: 'melodicMinor', bpm: 94,
    progressions: [[1,6,2,5],[1,3,6,2],[4,5,3,6]],
    chordExt: 'ninth', barsPerChord: 2,
    drumPattern: {
      kick:  [1,0,0,0, 0,0,0.55,0, 0.8,0,0,0, 0,0,0.55,0],
      rim:   [0,0,0.45,0, 0,0.7,0,0, 0,0,0.45,0, 0,0.7,0,0],
      hat:   [0.42,0.18,0.38,0.18, 0.42,0.18,0.38,0.18, 0.42,0.18,0.38,0.18, 0.42,0.18,0.38,0.18],
    },
    bassStyle: 'rootGroove',
    leadDensity: 0.24,
    shimmerRate: 1,
    swing: 0.1,
    pad: { warmth: 0.74, sub: 0.46, amp: 0.06 },
    reverb: { room: 0.72, damp: 0.42, mix: 0.56 },
    delay:  { beats: 0.25, fb: 0.28, mix: 0.22 },
  },

  chillHouse: {
    tonic: 58, scale: 'ionian', bpm: 118,
    progressions: [[1,5,6,4],[1,6,4,5],[6,4,1,5]],
    chordExt: 'ninth', barsPerChord: 2,
    drumPattern: {
      kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
      clap:  [0,0,0,0, 0.9,0,0,0, 0,0,0,0, 0.9,0,0,0],
      hat:   [0,0.18,0.62,0.18, 0,0.18,0.62,0.18, 0,0.18,0.62,0.18, 0,0.18,0.62,0.3],
    },
    bassStyle: 'driving',
    leadDensity: 0.3,
    shimmerRate: 2,
    swing: 0,
    pad: { warmth: 0.72, sub: 0.5, amp: 0.06 },
    reverb: { room: 0.76, damp: 0.4, mix: 0.58 },
    delay:  { beats: 0.375, fb: 0.4, mix: 0.34 },
  },

  rainyPiano: {
    tonic: 65, scale: 'majorPentatonic', bpm: 68,
    progressions: [[1,3,6,4],[1,5,6,3],[1,2,6,5]],
    chordExt: 'ninth', barsPerChord: 4,
    bassStyle: 'none',
    leadDensity: 0.1,
    shimmerRate: 2,
    swing: 0,
    pad: { warmth: 0.88, sub: 0.18, amp: 0.055 },
    reverb: { room: 0.96, damp: 0.24, mix: 1.32 },
    delay:  { beats: 1.0, fb: 0.42, mix: 0.38 },
  },

  sunsetGroove: {
    tonic: 55, scale: 'mixolydian', bpm: 102,
    progressions: [[1,7,4,1],[1,5,4,1],[6,7,1,4]],
    chordExt: 'thirteenth', barsPerChord: 2,
    drumPattern: {
      kick:  [1,0,0,0, 0,0,0.5,0, 1,0,0,0, 0,0,0.4,0],
      snare: [0,0,0,0, 0.85,0,0,0, 0,0,0,0, 0.85,0,0,0],
      hat:   [0.58,0.18,0.48,0.18, 0.58,0.18,0.48,0.24, 0.58,0.18,0.48,0.18, 0.58,0.18,0.48,0.26],
    },
    bassStyle: 'rootGroove',
    leadDensity: 0.34,
    shimmerRate: 1,
    swing: 0.08,
    pad: { warmth: 0.8, sub: 0.56, amp: 0.065 },
    reverb: { room: 0.76, damp: 0.38, mix: 0.64 },
    delay:  { beats: 0.5, fb: 0.36, mix: 0.32 },
  },
};

// ---------- per-bar generator ----------
export function makeGenerator(profileId, seed) {
  const profile = PROFILES[profileId];
  if (!profile) throw new Error(`unknown profile ${profileId}`);
  const rng = makeRng(seed);
  const progression = pickFrom(rng, profile.progressions);
  const state = { profile, rng, progression, barCount: 0, prevTop: 72 };

  return { profile, bpm: profile.bpm, nextBar: () => genBar(state) };
}

function pickFrom(rng, arr) {
  return arr[Math.floor(rng.float() * arr.length)];
}

function genBar(state) {
  const { profile, rng, progression } = state;
  const beatSec = 60 / profile.bpm;
  const stepSec = beatSec / 4;        // 16th
  const barSec = beatSec * 4;
  const bar = state.barCount++;

  const chordIdx = Math.floor(bar / profile.barsPerChord) % progression.length;
  const deg = progression[chordIdx];
  const chord = chordTones(profile.tonic, profile.scale, deg, profile.chordExt);
  const padVoicing = voiceLead(chord.map((n) => n + 12), state.prevTop);
  state.prevTop = padVoicing[padVoicing.length - 1];

  const scaleArr = SCALES[profile.scale];
  const rootMidi =
    profile.tonic + scaleArr[(deg - 1 + scaleArr.length * 4) % scaleArr.length] - 24;

  const events = [];

  // ---- pad (re-trigger only on chord change) ----
  if (profile.pad && bar % profile.barsPerChord === 0) {
    const dur = barSec * profile.barsPerChord - 0.05;
    padVoicing.forEach((n, i) => {
      events.push({
        time: i * 0.008,
        def: 'pad',
        args: {
          freq: midiToHz(n),
          amp: profile.pad.amp,
          dur,
          cutoff: 600 + 2400 * profile.pad.warmth,
          pan: [-0.4, 0.0, 0.4, -0.2, 0.2][i] ?? 0,
          sub: i === 0 ? profile.pad.sub : 0,
        },
      });
    });
  }

  // ---- bass ----
  switch (profile.bassStyle) {
    case 'driving':   // 4 quarter notes
      for (let b = 0; b < 4; b++) {
        events.push({ time: b * beatSec, def: 'bass',
          args: { freq: midiToHz(rootMidi), amp: 0.42, dur: beatSec * 0.85, cutoff: 220 } });
      }
      break;
    case 'rootSparse':  // beats 1 & 3
      for (const b of [0, 2]) {
        events.push({ time: b * beatSec, def: 'bass',
          args: { freq: midiToHz(rootMidi), amp: 0.42, dur: beatSec * 1.6, cutoff: 200 } });
      }
      break;
    case 'rootGroove':  // syncopated
      const groove = [0, 1.5, 2, 3.5];
      for (const b of groove) {
        events.push({ time: b * beatSec, def: 'bass',
          args: { freq: midiToHz(rootMidi + (rng.chance(0.2) ? 7 : 0)),
                  amp: 0.42, dur: beatSec * 0.6, cutoff: 240 } });
      }
      break;
    case 'walk':  // walking bass — root, 3rd, 5th, leading note
      const interval3 = chord[1] - chord[0];
      const targets = [
        rootMidi,
        rootMidi + interval3,
        rootMidi + 7,
        rootMidi + (rng.chance(0.5) ? -1 : 1) + 12,  // approach next root
      ];
      targets.forEach((n, b) => {
        events.push({ time: b * beatSec, def: 'bass',
          args: { freq: midiToHz(n), amp: 0.4, dur: beatSec * 0.95, cutoff: 260 } });
      });
      break;
    case 'sub':  // sub-bass on downbeats + and-of-3
      events.push({ time: 0, def: 'subBass',
        args: { freq: midiToHz(rootMidi - 12), amp: 0.55, dur: beatSec * 1.6 } });
      if (rng.chance(0.6)) {
        events.push({ time: 2.5 * beatSec, def: 'subBass',
          args: { freq: midiToHz(rootMidi - 12), amp: 0.4, dur: beatSec * 1.4 } });
      }
      break;
    case 'none': default: break;
  }

  // ---- drums ----
  if (profile.drumPattern) {
    for (const [role, pattern] of Object.entries(profile.drumPattern)) {
      for (let s = 0; s < pattern.length; s++) {
        const v = pattern[s];
        if (!v) continue;
        const swing = (s % 2 === 1) ? profile.swing * stepSec : 0;
        const t = s * stepSec + swing;
        events.push(buildDrumEvent(role, t, v, rng));
      }
    }
  }

  // ---- lead ----
  if (profile.leadDensity > 0) {
    let direction = rng.chance(0.5) ? 1 : -1;
    let lastNote = null;
    for (let step = 0; step < 16; step++) {
      if (rng.chance(profile.leadDensity / 2.5)) {
        const candidates = [...chord, ...chord.map((n) => n + 12), ...chord.map((n) => n - 12)];
        let note = candidates[Math.floor(rng.float() * candidates.length)] + 12;
        if (lastNote !== null) {
          if (Math.abs(note - lastNote) > 7 && rng.chance(0.7)) {
            note = lastNote + direction * (1 + Math.floor(rng.float() * 3));
          }
        }
        note = Math.max(67, Math.min(88, note));
        lastNote = note;
        events.push({
          time: step * stepSec,
          def: 'lead',
          args: {
            freq: midiToHz(note),
            amp: 0.18 + rng.float() * 0.08,
            dur: stepSec * (1 + rng.int(0, 4)),
            spark: profile.pad?.warmth ? 0.4 + rng.float() * 0.4 : 0.5,
            pan: rng.range(-0.3, 0.3) + 0.15,
          },
        });
      }
    }
  }

  // ---- shimmer (Poisson sprinkle) ----
  // Tamed: max 1 grain per bar at low rates; lower amps; shorter tails;
  // and chance-gated so quiet bars stay quiet.
  if (profile.shimmerRate > 0 && rng.chance(0.45)) {
    const grainCount = Math.max(1, Math.round(profile.shimmerRate * 0.4));
    for (let g = 0; g < grainCount; g++) {
      const n = chord[Math.floor(rng.float() * chord.length)]
              + [12, 19, 24][Math.floor(rng.float() * 3)];
      events.push({
        time: rng.range(0, barSec),
        def: 'shimmer',
        args: {
          freq: midiToHz(n),
          amp: 0.018 + rng.float() * 0.02,
          dur: 0.3 + rng.float() * 0.5,
          pan: rng.range(-0.7, 0.7),
        },
      });
    }
  }

  return { events, barSec, bar, deg };
}

function buildDrumEvent(role, t, v, rng) {
  switch (role) {
    case 'kick':
      return { time: t, def: 'kick', args: { amp: 0.85 * v } };
    case 'snare':
      return { time: t, def: 'snare', args: { amp: 0.4 * v } };
    case 'clap':
      return { time: t, def: 'clap', args: { amp: 0.4 * v } };
    case 'hat':
      // every 4th hat has a chance of an open hat
      const open = (Math.floor(t * 1000) % 4 === 3) && rng.chance(0.3);
      return { time: t, def: 'hat', args: {
        amp: 0.18 * v,
        len: open ? 0.22 : 0.05,
        pan: (Math.round(t * 1000) % 2 === 0) ? -0.25 : 0.25,
      }};
    case 'ride':
      return { time: t, def: 'ride', args: { amp: 0.28 * v, pan: 0.4 } };
    case 'rim':
      return { time: t, def: 'rim', args: { amp: 0.35 * v } };
    default:
      return { time: t, def: role, args: { amp: 0.3 * v } };
  }
}
