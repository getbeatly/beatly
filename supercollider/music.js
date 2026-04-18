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

// ---------- genres + variants ----------
//
// Each genre has a BASE profile (shape below) plus a map of VARIANTS that
// shallow-merge over the base. `pad`, `reverb`, `delay`, and `drumPattern` are
// deep-merged so a variant can tweak one field without redeclaring the whole
// block. The first variant listed is the default for the genre.
//
// Profile shape:
//   tonic, scale, bpm, progressions, chordExt, barsPerChord,
//   drumPattern { kick|snare|clap|hat|ride|rim: [16 velocities 0..1] },
//   bassStyle ('driving'|'rootSparse'|'rootGroove'|'walk'|'sub'|'none'),
//   leadDensity 0..1, shimmerRate int, swing 0..0.25,
//   pad { warmth 0..1, sub 0..1, amp },
//   reverb { room 0..1, damp 0..1, mix },
//   delay { beats, fb, mix }.

function mergeProfile(base, delta) {
  const out = { ...base, ...delta };
  if (base.pad || delta.pad) out.pad = { ...(base.pad ?? {}), ...(delta.pad ?? {}) };
  if (base.reverb || delta.reverb) out.reverb = { ...(base.reverb ?? {}), ...(delta.reverb ?? {}) };
  if (base.delay || delta.delay) out.delay = { ...(base.delay ?? {}), ...(delta.delay ?? {}) };
  if (delta.drumPattern === null) {
    delete out.drumPattern;
  } else if (delta.drumPattern) {
    const merged = { ...(base.drumPattern ?? {}), ...delta.drumPattern };
    // Allow variants to remove a drum role by setting it to null.
    for (const role of Object.keys(merged)) {
      if (merged[role] == null) delete merged[role];
    }
    out.drumPattern = merged;
  }
  if (delta.progressions) out.progressions = delta.progressions;
  return out;
}

// ---------- BASE profiles (one per genre) ----------
const BASES = {
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

// ---------- VARIANTS (deltas from each base) ----------
// The first variant key in each genre is the default.
const VARIANTS = {
  ambient: {
    classic:   {},
    abyss:     { tonic: 48, scale: 'aeolian', reverb: { mix: 1.9 } },
    cathedral: { bpm: 54, reverb: { room: 0.98, mix: 2.4 }, delay: { beats: 1.5, fb: 0.65, mix: 0.7 } },
    glacial:   { bpm: 48, shimmerRate: 3, pad: { amp: 0.075 } },
    pastoral:  { tonic: 64, scale: 'lydian', pad: { warmth: 0.95 } },
    voidwalk:  { tonic: 45, scale: 'phrygian', bpm: 56, reverb: { mix: 2.1 } },
  },

  calming: {
    classic:   {},
    warmth:    { chordExt: 'ninth', pad: { warmth: 0.95, amp: 0.08 } },
    rain:      { shimmerRate: 6, delay: { beats: 0.5, fb: 0.55, mix: 0.5 } },
    cloudland: { bpm: 58, barsPerChord: 8 },
    hymn:      { scale: 'majorPentatonic', tonic: 67, chordExt: 'seventh' },
    mist:      { tonic: 62, scale: 'dorian', pad: { warmth: 0.82 } },
  },

  deepFocus: {
    dorian:   {},
    phrygian: { scale: 'phrygian', tonic: 50 },
    minimal:  { drumPattern: null, leadDensity: 0.15, shimmerRate: 1 },
    driving:  {
      drumPattern: {
        kick:  [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
        hat:   [0.6,0,0.45,0, 0.6,0,0.45,0, 0.6,0,0.45,0, 0.6,0,0.45,0.4],
      },
      bassStyle: 'driving',
    },
    pulse:    { bpm: 92, swing: 0 },
    nocturne: { tonic: 48, scale: 'aeolian', bpm: 78, pad: { warmth: 0.7 } },
  },

  lofi: {
    classic: {},
    night:   { tonic: 53, bpm: 72, pad: { warmth: 0.85 } },
    crate:   { swing: 0.22, pad: { warmth: 0.8 }, reverb: { damp: 0.6 } },
    sunday:  { scale: 'majorPentatonic', tonic: 60, chordExt: 'ninth' },
    jazzy:   { chordExt: 'ninth', swing: 0.2, scale: 'dorian' },
    tape:    { bpm: 74, pad: { warmth: 0.88 }, delay: { fb: 0.55, mix: 0.5 } },
  },

  jazzNoir: {
    classic:  {},
    ballad:   { bpm: 72, chordExt: 'ninth', leadDensity: 0.35 },
    uptempo:  { bpm: 132, leadDensity: 0.6 },
    rhodes:   { pad: { warmth: 0.88 }, chordExt: 'eleventh' },
    blue:     { scale: 'blues', chordExt: 'seventh' },
    afterhours: { tonic: 46, bpm: 84, pad: { warmth: 0.82 } },
  },

  techno: {
    driving: {},
    dub:     { bpm: 124, delay: { beats: 0.75, fb: 0.7, mix: 0.7 }, reverb: { mix: 0.9 } },
    melodic: { scale: 'aeolian', chordExt: 'seventh', leadDensity: 0.3, tonic: 48 },
    acid:    { leadDensity: 0.65, pad: { warmth: 0.35 } },
    minimal: {
      drumPattern: {
        kick: [1,0,0,0, 1,0,0,0, 1,0,0,0, 1,0,0,0],
        hat:  [0,0,0.6,0, 0,0,0.6,0, 0,0,0.6,0, 0,0,0.6,0.3],
        clap: null,
      },
      leadDensity: 0,
    },
    peak:    { bpm: 134, leadDensity: 0.2 },
  },

  dnb: {
    classic:      {},
    liquid:       { tonic: 48, scale: 'dorian', pad: { warmth: 0.78 }, chordExt: 'ninth' },
    neuro:        { tonic: 43, pad: { warmth: 0.4 }, leadDensity: 0.3 },
    jungle:       {
      bpm: 162,
      drumPattern: {
        kick:  [1,0,0,0.4, 0,0,0.7,0, 0,0,1,0, 0,0.5,0,0],
        snare: [0,0,0,0, 1,0,0,0.5, 0,0,0,0, 1,0,0.4,0],
        hat:   [0.6,0.4,0.7,0.3, 0.6,0.4,0.7,0.5, 0.6,0.4,0.7,0.3, 0.6,0.4,0.7,0.5],
      },
    },
    atmospheric:  { leadDensity: 0.1, shimmerRate: 4, pad: { warmth: 0.82 } },
    halftime:     { bpm: 86, chordExt: 'ninth' },
  },

  dub: {
    classic:     {},
    roots:       { bpm: 68, scale: 'dorian', pad: { warmth: 0.82 } },
    echo:        { delay: { beats: 1.0, fb: 0.78, mix: 0.85 }, reverb: { mix: 1.8 } },
    stepper:     {
      drumPattern: {
        kick:  [1,0,0,0, 0,0,0,0, 1,0,0,0, 0,0,0,0],
        snare: [0,0,0,0, 1,0,0,0, 0,0,0,0, 1,0,0,0],
        hat:   [0,0,0.6,0, 0,0,0.6,0, 0,0,0.6,0, 0,0,0.6,0.4],
      },
    },
    meditative:  { bpm: 62, leadDensity: 0.05 },
    digital:     { tonic: 48, scale: 'phrygian', leadDensity: 0.2 },
  },

  uplift: {
    classic:   {},
    euphoric:  { bpm: 128, chordExt: 'ninth', leadDensity: 0.6 },
    anthem:    { leadDensity: 0.7, pad: { warmth: 0.7 } },
    gospel:    { scale: 'majorPentatonic', chordExt: 'seventh' },
    dawn:      { bpm: 108, pad: { warmth: 0.75 } },
    stadium:   { bpm: 126, chordExt: 'seventh', reverb: { mix: 0.8 } },
  },

  neoSoul: {
    classic: {},
    dusty:   { swing: 0.22, pad: { warmth: 0.88 } },
    smooth:  { bpm: 78, chordExt: 'ninth', pad: { warmth: 0.85 } },
    rhodes:  { pad: { warmth: 0.92 }, chordExt: 'thirteenth' },
    funk:    { bpm: 96, leadDensity: 0.5, swing: 0.1 },
    amber:   { tonic: 56, scale: 'mixolydian', chordExt: 'ninth' },
  },

  dreamPop: {
    classic:  {},
    shoegaze: { shimmerRate: 6, reverb: { room: 0.96, mix: 1.6 }, pad: { warmth: 0.95 } },
    bedroom:  { bpm: 64, leadDensity: 0.12 },
    summer:   { tonic: 64, pad: { warmth: 0.9 } },
    winter:   { tonic: 60, scale: 'aeolian', pad: { warmth: 0.82 } },
    nocturne: { tonic: 58, scale: 'dorian', bpm: 68 },
  },

  soulHop: {
    classic:  {},
    boombap:  { bpm: 92, swing: 0.14 },
    buttery:  { bpm: 80, chordExt: 'thirteenth', pad: { warmth: 0.88 } },
    jazzy:    { chordExt: 'ninth', scale: 'dorian' },
    midnight: { tonic: 53, pad: { warmth: 0.8 } },
    sunday:   { scale: 'majorPentatonic', tonic: 60, bpm: 86 },
  },

  cityPop: {
    classic: {},
    tokyo:   { bpm: 116, chordExt: 'thirteenth' },
    neon:    { bpm: 120, leadDensity: 0.55, pad: { warmth: 0.75 } },
    coastal: { bpm: 104, pad: { warmth: 0.85 } },
    sunset:  { tonic: 58, bpm: 102, scale: 'mixolydian' },
    drive:   { bpm: 114, bassStyle: 'driving', leadDensity: 0.5 },
  },

  bossaNova: {
    classic: {},
    samba:   { bpm: 112, leadDensity: 0.32 },
    gentle:  { bpm: 80, pad: { warmth: 0.8 } },
    blue:    { scale: 'aeolian', chordExt: 'ninth' },
    rio:     { bpm: 100, swing: 0.12 },
    jobim:   { chordExt: 'eleventh', leadDensity: 0.28 },
  },

  chillHouse: {
    classic: {},
    deep:    { tonic: 53, scale: 'dorian', chordExt: 'ninth', pad: { warmth: 0.8 } },
    beach:   { scale: 'majorPentatonic', tonic: 62, pad: { warmth: 0.85 } },
    sunset:  { bpm: 110 },
    rooftop: { bpm: 124, leadDensity: 0.4 },
    balearic:{ bpm: 114, chordExt: 'ninth', pad: { warmth: 0.82 } },
  },

  rainyPiano: {
    classic:  {},
    midnight: { tonic: 58, scale: 'aeolian', pad: { warmth: 0.82 } },
    morning:  { tonic: 67, scale: 'lydian' },
    moss:     { bpm: 56 },
    stormy:   { shimmerRate: 5, reverb: { mix: 1.5 } },
    hymn:     { scale: 'ionian', chordExt: 'seventh' },
  },

  sunsetGroove: {
    classic:    {},
    beach:      { tonic: 58, scale: 'majorPentatonic', pad: { warmth: 0.85 } },
    dusk:       { bpm: 90, pad: { warmth: 0.82 } },
    golden:     { bpm: 108, chordExt: 'thirteenth' },
    saltwater:  { bpm: 94, scale: 'dorian' },
    boardwalk:  { bpm: 106, leadDensity: 0.42 },
  },
};

// ---------- derive flat PROFILES + catalog ----------
function buildProfiles() {
  const profiles = {};
  const genres = {};
  for (const [genreId, base] of Object.entries(BASES)) {
    const variantMap = VARIANTS[genreId];
    if (!variantMap) throw new Error(`Missing variants for genre ${genreId}`);
    const variantIds = Object.keys(variantMap);
    if (variantIds.length === 0) throw new Error(`Genre ${genreId} has no variants`);
    const defaultVariant = variantIds[0];
    const builtVariants = {};
    for (const vid of variantIds) {
      const profile = mergeProfile(base, variantMap[vid]);
      const key = `${genreId}.${vid}`;
      profiles[key] = profile;
      builtVariants[vid] = profile;
    }
    // short-form alias: `"lofi"` → default variant profile
    profiles[genreId] = profiles[`${genreId}.${defaultVariant}`];
    genres[genreId] = {
      id: genreId,
      defaultVariant,
      variantIds,
      variants: builtVariants,
    };
  }
  return { profiles, genres };
}

const { profiles: BUILT_PROFILES, genres: BUILT_GENRES } = buildProfiles();

export const PROFILES = BUILT_PROFILES;
export const GENRES = BUILT_GENRES;

export function listProfileIds() {
  // genre.variant keys only (excludes the short-form aliases)
  return Object.keys(PROFILES).filter((k) => k.includes('.'));
}

export function resolveProfileId(genreId, variantId) {
  if (!genreId) return null;
  if (genreId.includes('.')) return PROFILES[genreId] ? genreId : null;
  const meta = GENRES[genreId];
  if (!meta) return null;
  const v = variantId && meta.variantIds.includes(variantId) ? variantId : meta.defaultVariant;
  return `${genreId}.${v}`;
}

export function splitProfileId(profileId) {
  const [genreId, variantId] = profileId.split('.');
  return { genreId, variantId: variantId ?? GENRES[genreId]?.defaultVariant ?? null };
}



// ---------- per-bar generator ----------
export function makeGenerator(profileId, seed) {
  const key = resolveProfileId(profileId) ?? profileId;
  const profile = PROFILES[key];
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
