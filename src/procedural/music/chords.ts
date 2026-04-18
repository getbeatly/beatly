/**
 * Chord resolver + voice leading (§3.2).
 *
 * Pipeline:
 *   1. `resolveChord(palette, step, intensity)` → set of diatonic MIDI pitches
 *      (root, third, fifth, plus optional extensions per mood rules).
 *   2. `pickVoicing(chordMidis, prevVoicing)` → a 3-note voicing inside the
 *      window C4–C5 (MIDI 60–72) that minimises total voice motion from the
 *      previous voicing.
 *   3. `pickBassMidi(rootMidi, prevBass)` → C2–C3 (36–48) octave closest to
 *      the previous bass note.
 */

import type { BeatlyMood } from "../../adapters.js";
import { MODE_INTERVALS, type MoodPalette, type ProgressionStep } from "./moods.js";

export interface ResolvedChord {
  /** MIDI pitches, ascending, minimally the root/3/5. May include extensions. */
  readonly pitches: readonly number[];
  /** Scale-relative root MIDI (pre-inversion), for the bass line. */
  readonly rootMidi: number;
  /** "maj" / "min" / "dim" / "dom7" — for downstream logic. */
  readonly quality: "maj" | "min" | "dim" | "dom7";
}

export interface Voicing {
  /** 3 MIDI pitches in ascending order inside the voicing window. */
  readonly pitches: readonly [number, number, number];
}

const VOICING_LO = 60;
const VOICING_HI = 72;

/**
 * Mode-diatonic triad quality for scale degree 0..6.
 * Computed from the mode intervals so we don't hard-code per mode.
 */
function diatonicQuality(modeIntervals: readonly number[], degree: number): "maj" | "min" | "dim" {
  const n = modeIntervals.length;
  const root = modeIntervals[degree % n] ?? 0;
  const third = (modeIntervals[(degree + 2) % n] ?? 0) + (degree + 2 >= n ? 12 : 0);
  const fifth = (modeIntervals[(degree + 4) % n] ?? 0) + (degree + 4 >= n ? 12 : 0);
  const thirdInt = mod12(third - root);
  const fifthInt = mod12(fifth - root);
  if (thirdInt === 4 && fifthInt === 7) return "maj";
  if (thirdInt === 3 && fifthInt === 7) return "min";
  if (thirdInt === 3 && fifthInt === 6) return "dim";
  return "maj";
}

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

export function resolveChord(
  mood: BeatlyMood,
  palette: MoodPalette,
  step: ProgressionStep,
): ResolvedChord {
  const intervals = MODE_INTERVALS[palette.mode];
  const n = intervals.length;
  const deg = step.degree % n;

  // Build triad: root/3/5 taking scale-step jumps of 2.
  const rootPc = (intervals[deg] ?? 0) + (step.rootOffset ?? 0);
  const thirdPc = (intervals[(deg + 2) % n] ?? 0) + (deg + 2 >= n ? 12 : 0);
  const fifthPc = (intervals[(deg + 4) % n] ?? 0) + (deg + 4 >= n ? 12 : 0);

  const rootMidi = palette.tonicMidi + rootPc;
  const thirdMidi = palette.tonicMidi + thirdPc;
  const fifthMidi = palette.tonicMidi + fifthPc;

  const quality = step.quality ?? diatonicQuality(intervals, deg);
  const pitches: number[] = [rootMidi, thirdMidi, fifthMidi];

  // Mood-specific extensions (§3.2).
  const addNinth = () => pitches.push(rootMidi + 14);
  const addMaj7 = () => pitches.push(rootMidi + 11);
  const addMin7 = () => pitches.push(rootMidi + 10);
  const addSus2 = () => {
    // Replace third with 2nd for sus2 colour.
    const secondMidi = palette.tonicMidi + (intervals[(deg + 1) % n] ?? 0) + (deg + 1 >= n ? 12 : 0);
    pitches[1] = secondMidi;
  };
  const dropFifth = () => {
    const idx = pitches.indexOf(fifthMidi);
    if (idx >= 0) pitches.splice(idx, 1);
  };

  switch (mood) {
    case "calming":
      if (deg === 0 || deg === 3) {
        addNinth();
        dropFifth(); // "drop the 5 if 9 is present"
      }
      break;
    case "deep-focus":
      if (deg === 0 || deg === 3) addMin7();
      if (deg === 6) addSus2();
      break;
    case "flow":
      // "add 7 to all chords" — major or dominant? Use quality-aware 7.
      if (quality === "maj") addMaj7();
      else addMin7();
      break;
    case "uplift":
      if (deg === 0 || deg === 5) addNinth();
      break;
    case "neutral":
      // Triads only.
      break;
  }

  pitches.sort((a, b) => a - b);
  return { pitches, rootMidi, quality: quality as ResolvedChord["quality"] };
}

/**
 * Fold a MIDI pitch into the voicing window by octave-shifting.
 * Chooses the octave that is closest to the anchor (or the window centre).
 */
function foldIntoWindow(midi: number, lo = VOICING_LO, hi = VOICING_HI): number {
  let n = midi;
  while (n < lo) n += 12;
  while (n > hi) n -= 12;
  // If pushing below lo was unavoidable, shove back up.
  while (n < lo) n += 12;
  return n;
}

/**
 * Pick the 3-note voicing that minimises total voice motion from the previous
 * voicing. Ties broken by preferring the inversion whose top voice moves by
 * step (|Δ| ≤ 2 semitones).
 */
export function pickVoicing(chord: ResolvedChord, prev: Voicing | null): Voicing {
  // Build candidate voicings: for each combination of 3 chord tones (root,
  // third, fifth — ignoring extensions for pad voicing), try every inversion
  // inside the window.
  const core = [chord.pitches[0] ?? chord.rootMidi, chord.pitches[1] ?? chord.rootMidi + 4, chord.pitches[2] ?? chord.rootMidi + 7];

  // Generate all three inversions by rotating the lowest note up by octaves.
  const candidates: [number, number, number][] = [];
  for (let invert = 0; invert < 3; invert += 1) {
    const rotated = [...core];
    for (let k = 0; k < invert; k += 1) {
      const low = rotated.shift();
      if (low !== undefined) rotated.push(low + 12);
    }
    // Fold each voice into window, then also try whole-chord octave shifts.
    for (const octShift of [-12, 0, 12]) {
      const shifted = rotated.map((n) => foldIntoWindow(n + octShift));
      shifted.sort((a, b) => a - b);
      candidates.push([shifted[0] ?? 0, shifted[1] ?? 0, shifted[2] ?? 0]);
    }
  }

  // Deduplicate.
  const unique = Array.from(new Set(candidates.map((v) => v.join(",")))).map((s) =>
    s.split(",").map(Number) as [number, number, number],
  );

  if (prev === null) {
    // First chord: pick the voicing with lowest top note (compact, centred).
    unique.sort((a, b) => a[2] - b[2]);
    return { pitches: unique[0] ?? [60, 64, 67] };
  }

  const ranked = rankByMotion(unique, prev);
  return { pitches: ranked[0] ?? [60, 64, 67] };
}

/**
 * Return up to `k` voicings ordered by ascending total voice motion from
 * `prev`. Used by the engine to rotate between a handful of near-optimal
 * voicings so chord repeats don't sound identical.
 */
export function pickVoicingAlternates(
  chord: ResolvedChord,
  prev: Voicing | null,
  k = 3,
): Voicing[] {
  const core = [
    chord.pitches[0] ?? chord.rootMidi,
    chord.pitches[1] ?? chord.rootMidi + 4,
    chord.pitches[2] ?? chord.rootMidi + 7,
  ];

  const candidates: [number, number, number][] = [];
  for (let invert = 0; invert < 3; invert += 1) {
    const rotated = [...core];
    for (let r = 0; r < invert; r += 1) {
      const low = rotated.shift();
      if (low !== undefined) rotated.push(low + 12);
    }
    for (const octShift of [-12, 0, 12]) {
      const shifted = rotated.map((n) => foldIntoWindow(n + octShift));
      shifted.sort((a, b) => a - b);
      candidates.push([shifted[0] ?? 0, shifted[1] ?? 0, shifted[2] ?? 0]);
    }
  }

  const unique = Array.from(new Set(candidates.map((v) => v.join(",")))).map((s) =>
    s.split(",").map(Number) as [number, number, number],
  );

  if (prev === null) {
    unique.sort((a, b) => a[2] - b[2]);
    return unique.slice(0, k).map((p) => ({ pitches: p }));
  }

  const ranked = rankByMotion(unique, prev);
  return ranked.slice(0, k).map((p) => ({ pitches: p }));
}

function rankByMotion(
  candidates: [number, number, number][],
  prev: Voicing,
): [number, number, number][] {
  const scored = candidates.map((cand) => {
    const motion =
      Math.abs(cand[0] - prev.pitches[0]) +
      Math.abs(cand[1] - prev.pitches[1]) +
      Math.abs(cand[2] - prev.pitches[2]);
    const topStep = Math.abs(cand[2] - prev.pitches[2]) <= 2 ? 0 : 1;
    return { cand, motion, topStep };
  });
  scored.sort((a, b) => a.motion - b.motion || a.topStep - b.topStep);
  return scored.map((s) => s.cand);
}

const BASS_LO = 36; // C2
const BASS_HI = 48; // C3

export function pickBassMidi(rootMidi: number, prev: number | null): number {
  // Generate root ± octaves inside [36, 48]; pick closest to prev (or 42).
  const candidates: number[] = [];
  for (let n = rootMidi - 36; n <= rootMidi + 36; n += 12) {
    if (n >= BASS_LO && n <= BASS_HI) candidates.push(n);
  }
  if (candidates.length === 0) {
    // Force into range.
    let n = rootMidi;
    while (n < BASS_LO) n += 12;
    while (n > BASS_HI) n -= 12;
    return n;
  }

  const anchor = prev ?? 42;
  candidates.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor));
  return candidates[0] ?? 42;
}
