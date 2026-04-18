#!/usr/bin/env node
/**
 * Smoke test for the chord resolver + voice-leading inversion picker.
 * Run:  npm run build && node playground/audio-tests/voicing.mjs
 */

import {
  MOOD_PALETTES,
  resolveChord,
  pickVoicing,
  pickBassMidi,
} from "../../dist/procedural/index.js";

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const midiName = (m) => `${NAMES[m % 12]}${Math.floor(m / 12) - 1}`;
const motion = (a, b) =>
  Math.abs(a.pitches[0] - b.pitches[0]) +
  Math.abs(a.pitches[1] - b.pitches[1]) +
  Math.abs(a.pitches[2] - b.pitches[2]);

let failed = 0;
const check = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? "  " + detail : ""}`);
  if (!cond) failed += 1;
};

for (const [mood, palette] of Object.entries(MOOD_PALETTES)) {
  console.log(`\n== ${mood} (${palette.mode}) ==`);
  const progression = palette.progressions[0].steps;
  let prev = null;
  let prevBass = null;
  let total = 0;

  for (const step of progression) {
    const chord = resolveChord(mood, palette, step);
    const voicing = pickVoicing(chord, prev);
    const bass = pickBassMidi(chord.rootMidi, prevBass);

    console.log(
      `  deg ${step.degree}  root=${midiName(chord.rootMidi)}(${chord.quality})  ` +
        `voicing=[${voicing.pitches.map(midiName).join(",")}]  ` +
        `bass=${midiName(bass)}`,
    );

    if (prev) total += motion(prev, voicing);

    check(
      `  voicing inside window [60,72]`,
      voicing.pitches.every((n) => n >= 60 && n <= 72),
      `got ${voicing.pitches.join(",")}`,
    );
    check(`  bass inside window [36,48]`, bass >= 36 && bass <= 48, `got ${bass}`);

    prev = voicing;
    prevBass = bass;
  }

  const avg = total / Math.max(1, progression.length - 1);
  check(`  avg voice motion ≤ 10 semitones`, avg <= 10, `avg=${avg.toFixed(2)}`);
}

if (failed > 0) { console.error(`\n${failed} check(s) failed`); process.exit(1); }
console.log("\nAll voicing checks passed.");
