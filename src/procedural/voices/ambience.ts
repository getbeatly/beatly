/**
 * Ambience bed — a quiet, always-on noise layer that adds "air" and keeps
 * the soundscape from feeling static between chord changes.
 *
 * Design:
 *   - Two decorrelated pink-ish noise sources (L and R).
 *   - State-variable band-pass per channel with a slow LFO on cutoff
 *     (0.03–0.09 Hz), sweeping 1.8 → 5.5 kHz (higher when `sparkle` is up).
 *   - Slow amplitude LFO (~0.12 Hz, ±25%) on top for breathing.
 *   - Stereo width via independent L/R phases on both LFOs.
 *   - Output level is low (~−28 dBFS peak). Sends heavily to reverb.
 *
 * Deterministic when driven by a seeded PRNG.
 */

import { wrapPhase } from "../dsp/oscillators.js";
import { createSvf, type Svf } from "../dsp/svf.js";
import type { Prng } from "../prng.js";

export interface AmbienceVoice {
  /** Render one stereo sample pair (wet bed). */
  render(): [number, number];
  setSparkle(v: number): void;
  setWarmth(v: number): void;
}

export function createAmbienceVoice(sampleRate: number, prng: Prng): AmbienceVoice {
  // Pink-noise filter state (Paul Kellet's economy variant, 3-stage).
  const pinkL = [0, 0, 0];
  const pinkR = [0, 0, 0];

  // White-noise source driven by the layer's own PRNG — keep it cheap.
  const whiteStream = (): number => prng.next() * 2 - 1;

  const bpL: Svf = createSvf(sampleRate, 2500, 1.6);
  const bpR: Svf = createSvf(sampleRate, 2500, 1.6);

  // Slow cutoff LFOs, slightly different rates per channel for stereo motion.
  const cutoffLfoHzL = 0.03 + prng.next() * 0.06;
  const cutoffLfoHzR = 0.03 + prng.next() * 0.06;
  let phaseCutoffL = prng.next();
  let phaseCutoffR = prng.next();

  const ampLfoHzL = 0.10 + prng.next() * 0.06;
  const ampLfoHzR = 0.10 + prng.next() * 0.06;
  let phaseAmpL = prng.next();
  let phaseAmpR = prng.next();

  let sparkle = 0.5;
  let warmth = 0.5;

  const centerHz = (): number => 1800 + 3600 * sparkle; // 1.8 → 5.4 kHz
  const depthHz = (): number => 900 + 1800 * sparkle;   // wider sweep at high sparkle
  const level = (): number => 0.035 + 0.02 * warmth;     // bed gain

  return {
    setSparkle(v) {
      sparkle = v < 0 ? 0 : v > 1 ? 1 : v;
    },
    setWarmth(v) {
      warmth = v < 0 ? 0 : v > 1 ? 1 : v;
    },
    render(): [number, number] {
      // Pink-ify white noise.
      const wL = whiteStream();
      const wR = whiteStream();
      pinkL[0] = 0.99765 * (pinkL[0] ?? 0) + wL * 0.0990460;
      pinkL[1] = 0.96300 * (pinkL[1] ?? 0) + wL * 0.2965164;
      pinkL[2] = 0.57000 * (pinkL[2] ?? 0) + wL * 1.0526913;
      const pL = (pinkL[0] ?? 0) + (pinkL[1] ?? 0) + (pinkL[2] ?? 0) + wL * 0.1848;

      pinkR[0] = 0.99765 * (pinkR[0] ?? 0) + wR * 0.0990460;
      pinkR[1] = 0.96300 * (pinkR[1] ?? 0) + wR * 0.2965164;
      pinkR[2] = 0.57000 * (pinkR[2] ?? 0) + wR * 1.0526913;
      const pR = (pinkR[0] ?? 0) + (pinkR[1] ?? 0) + (pinkR[2] ?? 0) + wR * 0.1848;

      // Modulate band-pass cutoff per channel.
      phaseCutoffL = wrapPhase(phaseCutoffL + cutoffLfoHzL / sampleRate);
      phaseCutoffR = wrapPhase(phaseCutoffR + cutoffLfoHzR / sampleRate);
      const cL = centerHz() + depthHz() * Math.sin(2 * Math.PI * phaseCutoffL);
      const cR = centerHz() + depthHz() * Math.sin(2 * Math.PI * phaseCutoffR);
      bpL.setCutoff(cL);
      bpR.setCutoff(cR);

      // SVF .processAll gives us the band-pass tap directly.
      const { band: bL } = bpL.processAll(pL * 0.15);
      const { band: bR } = bpR.processAll(pR * 0.15);

      // Slow amp LFO — stereo width by differing L/R phase.
      phaseAmpL = wrapPhase(phaseAmpL + ampLfoHzL / sampleRate);
      phaseAmpR = wrapPhase(phaseAmpR + ampLfoHzR / sampleRate);
      const aL = 1 + 0.25 * Math.sin(2 * Math.PI * phaseAmpL);
      const aR = 1 + 0.25 * Math.sin(2 * Math.PI * phaseAmpR);

      const g = level();
      return [bL * aL * g, bR * aR * g];
    },
  };
}
