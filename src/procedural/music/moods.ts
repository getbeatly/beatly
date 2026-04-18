/**
 * Mood palette data (§3.1).
 *
 * Every entry is a palette, not a single preset: a tonic, a mode, a tempo
 * range, a weighted progression palette, and a form template.
 */

import type { BeatlyMood } from "../../adapters.js";

/** MIDI pitch-class intervals for each mode (in semitones from the tonic). */
export const MODE_INTERVALS = {
  lydian: [0, 2, 4, 6, 7, 9, 11],
  dorian: [0, 2, 3, 5, 7, 9, 10],
  mixolydian: [0, 2, 4, 5, 7, 9, 10],
  ionian: [0, 2, 4, 5, 7, 9, 11],
  "ionian-add9": [0, 2, 4, 5, 7, 9, 11], // add9 is a chord extension, not a scale change
  aeolian: [0, 2, 3, 5, 7, 8, 10],
} as const;

export type ModeName = keyof typeof MODE_INTERVALS;

/**
 * A progression is a sequence of diatonic scale degrees. Capitalisation
 * (I vs i) is informational only — chord quality follows the mode.
 *
 * Special tokens:
 *   - "bVII"  → scale degree 6 flattened (Mixolydian already has it)
 *   - "V/vi"  → secondary dominant of vi (degree 2 major w.r.t. vi)
 *   - "III"   → major III in Dorian/Aeolian (parallel)
 *
 * For simplicity we store degree indices 0..6 plus a quality override and
 * resolve special cases in the chord layer.
 */
export interface ProgressionStep {
  /** 0..6 diatonic degree (0 = tonic). */
  readonly degree: number;
  /** Optional override, otherwise mode-diatonic. */
  readonly quality?: "maj" | "min" | "dim" | "dom7";
  /** Optional semitone offset applied to the root (e.g. bVII = -1 from VII). */
  readonly rootOffset?: number;
}

export interface WeightedProgression {
  readonly weight: number;
  readonly steps: readonly ProgressionStep[];
}

export interface MoodPalette {
  readonly tonicMidi: number;            // e.g. F3 = 53
  readonly mode: ModeName;
  readonly tempoBpmRange: readonly [number, number];
  readonly tempoBpmDefault: number;
  readonly progressions: readonly WeightedProgression[];
  readonly formTemplate: readonly ("A" | "B")[];
  readonly swingAmount: number;
  /** Default macro overrides. */
  readonly defaults: {
    readonly warmth: number;
    readonly sparkle: number;
    readonly pulse: number;
    readonly space: number;
  };
}

// Shorthand builder for readability.
const p = (weight: number, degrees: (number | ProgressionStep)[]): WeightedProgression => ({
  weight,
  steps: degrees.map((d) => (typeof d === "number" ? { degree: d } : d)),
});

export const MOOD_PALETTES: Record<BeatlyMood, MoodPalette> = {
  calming: {
    tonicMidi: 53, // F3
    mode: "lydian",
    tempoBpmRange: [64, 76],
    tempoBpmDefault: 70,
    progressions: [
      p(3, [0, 2, 3, 0]),                                         // I–iii–IV–I
      p(2, [0, { degree: 4, quality: "maj" }, 5, 3]),             // I–V/vi→vi–IV (approximation)
      p(1, [0, 1, 0, 4]),                                         // I–ii–I–V
    ],
    formTemplate: ["A", "A", "A", "B"],
    swingAmount: 0.12,
    defaults: { warmth: 0.7, sparkle: 0.35, pulse: 0.35, space: 0.65 },
  },
  "deep-focus": {
    tonicMidi: 52, // E3
    mode: "dorian",
    tempoBpmRange: [80, 92],
    tempoBpmDefault: 86,
    progressions: [
      p(3, [0, 6, 5, 6]),                                         // i–VII–VI–VII
      p(2, [0, 3, 6, { degree: 2, rootOffset: 0, quality: "maj" }]), // i–iv–VII–III
      p(1, [0, 4, 0, 6]),                                         // i–v–i–VII
    ],
    formTemplate: ["A", "B", "A", "B"],
    swingAmount: 0.10,
    defaults: { warmth: 0.55, sparkle: 0.3, pulse: 0.5, space: 0.5 },
  },
  flow: {
    tonicMidi: 50, // D3
    mode: "mixolydian",
    tempoBpmRange: [96, 108],
    tempoBpmDefault: 102,
    progressions: [
      p(3, [0, { degree: 6, rootOffset: 0 }, 3, 0]),              // I–bVII–IV–I (Mixolydian natural)
      p(2, [0, 5, 1, 4]),                                         // I–vi–ii–V
      p(1, [0, 2, 3, 4]),                                         // I–iii–IV–V
    ],
    formTemplate: ["A", "B", "A", "B"], // ABAC handled via section variants later
    swingAmount: 0.15,
    defaults: { warmth: 0.55, sparkle: 0.5, pulse: 0.6, space: 0.45 },
  },
  uplift: {
    tonicMidi: 48, // C3
    mode: "ionian-add9",
    tempoBpmRange: [118, 132],
    tempoBpmDefault: 124,
    progressions: [
      p(3, [0, 4, 5, 3]),                                         // I–V–vi–IV
      p(2, [5, 3, 0, 4]),                                         // vi–IV–I–V
      p(1, [0, 2, 3, 4]),                                         // I–iii–IV–V
    ],
    formTemplate: ["A", "A", "B", "B"],
    swingAmount: 0.06,
    defaults: { warmth: 0.5, sparkle: 0.65, pulse: 0.75, space: 0.35 },
  },
  neutral: {
    tonicMidi: 50, // D3
    mode: "aeolian",
    tempoBpmRange: [88, 100],
    tempoBpmDefault: 94,
    progressions: [
      p(3, [0, 5, 2, 6]),                                         // i–VI–III–VII
      p(2, [0, 3, 4, 0]),                                         // i–iv–v–i
    ],
    formTemplate: ["A", "A", "B", "A"],
    swingAmount: 0.08,
    defaults: { warmth: 0.5, sparkle: 0.4, pulse: 0.45, space: 0.45 },
  },
};

export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}
