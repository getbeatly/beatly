/**
 * Pad bus — three voices, one per chord tone (§4.1).
 *
 * Per voice:
 *   - 2 detuned polyBLEP saws (±7 cents) + 1 sine sub one octave down at
 *     0.35 amplitude.
 *   - Slow amp LFO (0.07–0.19 Hz), ±12% depth, for "breathing".
 *   - 12 dB/oct SVF low-pass, cutoff = 600 + 2400 * warmth (Hz), modulated
 *     by a very slow LFO (tempo/8) with ±30% depth.
 *   - Per-voice ADSR: A 1200 / D 400 / S 0.85 / R 2500 ms.
 *   - Pan: voice 0 → −0.35, voice 1 → 0.0, voice 2 → +0.35 (equal-power).
 *   - Haas widening: voices 0 and 2 delay the opposite channel by 7 ms.
 *
 * Chord changes are applied as a portamento-like frequency glide on each
 * voice; the envelope is not retriggered, so there are no clicks on bar
 * boundaries.
 */

import { createAdsr, type Adsr } from "../dsp/adsr.js";
import { polyBlepSaw, sine, wrapPhase } from "../dsp/oscillators.js";
import { createSvf, type Svf } from "../dsp/svf.js";
import type { Prng } from "../prng.js";

const DETUNE_UP = Math.pow(2, 7 / 1200);   // +7 cents
const DETUNE_DOWN = Math.pow(2, -7 / 1200); // -7 cents
const HAAS_MS = 7;

const PAN_PER_VOICE = [-0.35, 0.0, 0.35] as const;

interface PadVoice {
  setTargetMidi(midi: number): void;
  setWarmth(warmth: number): void;
  setBreathingRateBarHz(hz: number): void;
  gateOn(): void;
  gateOff(): void;
  render(): [number, number];
}

function createPadVoice(
  sampleRate: number,
  voiceIndex: 0 | 1 | 2,
  prng: Prng,
): PadVoice {
  // Oscillator phase state.
  let phaseSawA = prng.next();
  let phaseSawB = prng.next();
  let phaseSub = prng.next();
  // Slow amp + filter LFOs — random rate in [0.07, 0.19] Hz per voice.
  let phaseAmpLfo = prng.next();
  const ampLfoHz = 0.07 + prng.next() * 0.12;
  let phaseFiltLfo = prng.next();
  // Filter LFO rate is patched in by the engine (tempo/8); start at 0.1 Hz.
  let filtLfoHz = 0.1;

  // Frequency portamento state.
  let freqHz = 261.63; // C4 default
  let targetFreqHz = freqHz;
  const portamentoCoef = 1 - Math.exp(-1 / (0.25 * sampleRate)); // ~250 ms glide

  let warmth = 0.5;
  const svf: Svf = createSvf(sampleRate, 1800, 1.4);
  const env: Adsr = createAdsr({
    sampleRate,
    attackMs: 1200,
    decayMs: 400,
    sustain: 0.85,
    releaseMs: 2500,
  });

  // Haas delay line for stereo widening (only used on voices 0 and 2).
  const haasSamples = Math.floor((HAAS_MS / 1000) * sampleRate);
  const haasBuf = new Float32Array(Math.max(1, haasSamples + 1));
  let haasW = 0;

  const pan = PAN_PER_VOICE[voiceIndex] ?? 0;
  // Equal-power pan coefficients.
  const panAngle = (pan * 0.5 + 0.5) * (Math.PI / 2);
  const panL = Math.cos(panAngle);
  const panR = Math.sin(panAngle);

  return {
    setTargetMidi(midi: number) {
      targetFreqHz = 440 * Math.pow(2, (midi - 69) / 12);
    },
    setWarmth(v: number) {
      warmth = v < 0 ? 0 : v > 1 ? 1 : v;
    },
    setBreathingRateBarHz(hz: number) {
      filtLfoHz = hz;
    },
    gateOn: () => env.gateOn(),
    gateOff: () => env.gateOff(),
    render(): [number, number] {
      // Glide frequency.
      freqHz += portamentoCoef * (targetFreqHz - freqHz);

      // Oscillators.
      const dtA = (freqHz * DETUNE_UP) / sampleRate;
      const dtB = (freqHz * DETUNE_DOWN) / sampleRate;
      const dtSub = (freqHz * 0.5) / sampleRate;
      phaseSawA = wrapPhase(phaseSawA + dtA);
      phaseSawB = wrapPhase(phaseSawB + dtB);
      phaseSub = wrapPhase(phaseSub + dtSub);
      const sawA = polyBlepSaw(phaseSawA, dtA);
      const sawB = polyBlepSaw(phaseSawB, dtB);
      const sub = sine(phaseSub) * 0.35;
      let osc = sawA * 0.45 + sawB * 0.45 + sub;

      // Slow filter cutoff LFO (±30%).
      phaseFiltLfo = wrapPhase(phaseFiltLfo + filtLfoHz / sampleRate);
      const cutoffBase = 600 + 2400 * warmth;
      const cutoff = cutoffBase * (1 + 0.3 * Math.sin(2 * Math.PI * phaseFiltLfo));
      svf.setCutoff(cutoff);
      osc = svf.process(osc);

      // Envelope.
      const amp = env.process();

      // Slow amp LFO (±12%).
      phaseAmpLfo = wrapPhase(phaseAmpLfo + ampLfoHz / sampleRate);
      const breath = 1 + 0.12 * Math.sin(2 * Math.PI * phaseAmpLfo);

      const mono = osc * amp * breath * 0.32;

      // Pan + Haas.
      let outL = mono * panL;
      let outR = mono * panR;

      if (voiceIndex === 0) {
        // Delay R channel so voice-0 (panned L) widens.
        haasBuf[haasW] = outR;
        const r = (haasW + 1) % haasBuf.length;
        const delayed = haasBuf[r] ?? 0;
        haasW = (haasW + 1) % haasBuf.length;
        outR = delayed;
      } else if (voiceIndex === 2) {
        haasBuf[haasW] = outL;
        const r = (haasW + 1) % haasBuf.length;
        const delayed = haasBuf[r] ?? 0;
        haasW = (haasW + 1) % haasBuf.length;
        outL = delayed;
      }

      return [outL, outR];
    },
  };
}

export interface PadBus {
  setVoicing(midis: readonly [number, number, number]): void;
  setWarmth(v: number): void;
  setBreathingRateBarHz(hz: number): void;
  gateOn(): void;
  gateOff(): void;
  render(): [number, number];
}

export function createPadBus(sampleRate: number, prng: Prng): PadBus {
  const voices: [PadVoice, PadVoice, PadVoice] = [
    createPadVoice(sampleRate, 0, prng),
    createPadVoice(sampleRate, 1, prng),
    createPadVoice(sampleRate, 2, prng),
  ];

  return {
    setVoicing(midis) {
      voices[0].setTargetMidi(midis[0]);
      voices[1].setTargetMidi(midis[1]);
      voices[2].setTargetMidi(midis[2]);
    },
    setWarmth(v) {
      for (const voice of voices) voice.setWarmth(v);
    },
    setBreathingRateBarHz(hz) {
      for (const voice of voices) voice.setBreathingRateBarHz(hz);
    },
    gateOn() {
      for (const voice of voices) voice.gateOn();
    },
    gateOff() {
      for (const voice of voices) voice.gateOff();
    },
    render(): [number, number] {
      let l = 0;
      let r = 0;
      for (const voice of voices) {
        const [vl, vr] = voice.render();
        l += vl;
        r += vr;
      }
      return [l, r];
    },
  };
}
