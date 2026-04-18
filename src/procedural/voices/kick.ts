/**
 * Kick voice (§4.4).
 *
 * - Sine with exponential pitch envelope 110 Hz → 45 Hz over 80 ms.
 * - Amp env: attack 1 ms, decay 220 ms, no sustain (one-shot).
 * - Output soft-clipped (tanh × 1.2) for thump.
 * - HPF @ 30 Hz. Centred pan.
 */

import { sine, wrapPhase } from "../dsp/oscillators.js";
import { createOnePoleHpf } from "../dsp/svf.js";

export interface KickVoice {
  trigger(): void;
  render(): number;
}

export function createKickVoice(sampleRate: number): KickVoice {
  let phase = 0;
  let active = false;
  let t = 0; // seconds since trigger

  // Amp envelope: linear attack then exponential decay.
  const attackSec = 0.001;
  const decayCoef = Math.exp(-1 / (0.22 * sampleRate));
  let amp = 0;

  // Pitch envelope: 110 → 45 Hz, tau ~ 35 ms.
  const pitchTauSec = 0.035;
  const f0 = 110;
  const f1 = 45;

  const hpf = createOnePoleHpf(sampleRate, 30);

  return {
    trigger() {
      active = true;
      t = 0;
      amp = 0;
    },
    render(): number {
      if (!active) return 0;

      t += 1 / sampleRate;

      // Amp env.
      if (t < attackSec) {
        amp = t / attackSec;
      } else {
        amp *= decayCoef;
        if (amp < 1e-4) {
          active = false;
          amp = 0;
        }
      }

      // Pitch env.
      const freq = f1 + (f0 - f1) * Math.exp(-t / pitchTauSec);
      phase = wrapPhase(phase + freq / sampleRate);

      const raw = sine(phase) * amp;
      const clipped = Math.tanh(raw * 1.2);
      return hpf.process(clipped);
    },
  };
}
