/**
 * Sparkle bells — chord-tone pings scheduled by a Poisson timer.
 *
 * This is a lightweight stand-in for the full granular shimmer bus (§4.6)
 * that lands in §10 step 8. It already gives the soundscape most of the
 * "air motion" that the spec's shimmer is designed for: every few seconds
 * a soft sine bell rings out on a random chord tone, two octaves up, in
 * a random stereo position, with a long exponential decay and a heavy
 * reverb send.
 *
 * Deterministic when driven by a seeded PRNG.
 */

import { sine, wrapPhase } from "../dsp/oscillators.js";
import type { Prng } from "../prng.js";

interface Bell {
  phase: number;
  freq: number;
  amp: number;
  decay: number;
  panL: number;
  panR: number;
}

export interface SparkleVoice {
  /** Call every sample — returns a stereo pair. */
  render(): [number, number];
  /** Call at bar boundaries with current chord pitches (MIDI). */
  setChordTones(midis: readonly number[]): void;
  /** 0..1 — denser & louder bells at higher values. */
  setSparkle(v: number): void;
  /** 0..1 — sparkle intensity from the macro layer. */
  setIntensity(v: number): void;
}

export function createSparkleVoice(sampleRate: number, prng: Prng): SparkleVoice {
  const bells: Bell[] = [];
  const maxBells = 6;

  let chordTones: number[] = [60, 64, 67];
  let sparkle = 0.5;
  let intensity = 0.5;

  // Poisson inter-arrival: mean interval between bells. At sparkle=1,
  // mean 1.8 s; at sparkle=0, mean 6 s.
  const meanIntervalSec = (): number => 1.8 + (1 - sparkle) * 4.2;

  let framesUntilNext = Math.floor(meanIntervalSec() * sampleRate);

  const spawn = (): void => {
    if (bells.length >= maxBells) return;
    const midi = (chordTones[prng.nextInt(chordTones.length)] ?? 60) + 24;
    const freq = 440 * Math.pow(2, (midi - 69) / 12);
    const pan = prng.next() * 1.8 - 0.9; // [-0.9, 0.9]
    const panAngle = (pan * 0.5 + 0.5) * (Math.PI / 2);

    const amp = 0.06 + 0.09 * sparkle * (0.4 + 0.6 * intensity);
    const decaySec = 0.5 + prng.next() * 0.4; // 0.5–0.9 s

    bells.push({
      phase: prng.next(),
      freq,
      amp,
      decay: Math.exp(-1 / (decaySec * sampleRate)),
      panL: Math.cos(panAngle),
      panR: Math.sin(panAngle),
    });
  };

  return {
    setChordTones(midis) {
      if (midis.length > 0) chordTones = [...midis];
    },
    setSparkle(v) {
      sparkle = v < 0 ? 0 : v > 1 ? 1 : v;
    },
    setIntensity(v) {
      intensity = v < 0 ? 0 : v > 1 ? 1 : v;
    },
    render(): [number, number] {
      // Schedule next bell.
      framesUntilNext -= 1;
      if (framesUntilNext <= 0) {
        spawn();
        // Exponential inter-arrival for Poisson-ish distribution.
        const u = Math.max(1e-6, prng.next());
        framesUntilNext = Math.max(
          Math.floor(0.15 * sampleRate),
          Math.floor(-Math.log(u) * meanIntervalSec() * sampleRate),
        );
      }

      // Render all active bells.
      let outL = 0;
      let outR = 0;
      for (let i = bells.length - 1; i >= 0; i -= 1) {
        const b = bells[i]!;
        b.phase = wrapPhase(b.phase + b.freq / sampleRate);
        const s = sine(b.phase) * b.amp;
        outL += s * b.panL;
        outR += s * b.panR;
        b.amp *= b.decay;
        if (b.amp < 1e-4) bells.splice(i, 1);
      }

      return [outL, outR];
    },
  };
}
