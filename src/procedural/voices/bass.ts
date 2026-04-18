/**
 * Bass voice (§4.2).
 *
 * - Sine fundamental + 0.35 triangle one octave up.
 * - 24 dB/oct low-pass (two cascaded 12 dB SVFs) @ 160 + 120 * warmth Hz.
 * - ADSR: A 8 / D 120 / S 0.7 / R 180 ms. Legato ties: if a new note
 *   arrives while still in sustain, just update the pitch.
 * - One-pole HPF @ 40 Hz to keep the sub tight.
 * - Centred pan.
 */

import { createAdsr } from "../dsp/adsr.js";
import { sine, triangle, wrapPhase } from "../dsp/oscillators.js";
import { createOnePoleHpf, createSvf } from "../dsp/svf.js";

export interface BassVoice {
  trigger(midi: number): void;
  gateOff(): void;
  setWarmth(v: number): void;
  render(): number;
}

export function createBassVoice(sampleRate: number): BassVoice {
  let phaseSine = 0;
  let phaseTri = 0;
  let freqHz = 55;
  let targetFreqHz = 55;
  const portamentoCoef = 1 - Math.exp(-1 / (0.04 * sampleRate)); // 40 ms glide

  const svf1 = createSvf(sampleRate, 220, 1.4);
  const svf2 = createSvf(sampleRate, 220, 1.4);
  const hpf = createOnePoleHpf(sampleRate, 40);
  const env = createAdsr({
    sampleRate,
    attackMs: 8,
    decayMs: 120,
    sustain: 0.7,
    releaseMs: 180,
  });

  let warmth = 0.5;

  return {
    setWarmth(v: number) {
      warmth = v < 0 ? 0 : v > 1 ? 1 : v;
      const c = 160 + 120 * warmth;
      svf1.setCutoff(c);
      svf2.setCutoff(c);
    },
    trigger(midi: number) {
      targetFreqHz = 440 * Math.pow(2, (midi - 69) / 12);
      // Legato: only retrigger if the envelope is idle/released.
      if (env.stage === "idle" || env.stage === "release") {
        env.gateOn();
      }
    },
    gateOff() {
      env.gateOff();
    },
    render(): number {
      freqHz += portamentoCoef * (targetFreqHz - freqHz);

      const dtSine = freqHz / sampleRate;
      const dtTri = (freqHz * 2) / sampleRate;
      phaseSine = wrapPhase(phaseSine + dtSine);
      phaseTri = wrapPhase(phaseTri + dtTri);

      const sig = sine(phaseSine) + triangle(phaseTri) * 0.35;
      const filtered = svf2.process(svf1.process(sig));
      const controlled = hpf.process(filtered);
      return controlled * env.process() * 0.55;
    },
  };
}
