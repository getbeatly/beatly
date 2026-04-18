import { createAdsr, type Adsr } from "../dsp/adsr.js";
import { polyBlepSaw, sine, triangle, wrapPhase } from "../dsp/oscillators.js";
import { createSvf } from "../dsp/svf.js";
import type { Prng } from "../prng.js";

export type LeadMode = "off" | "sparse" | "arp" | "hook" | "stabs";

export interface LeadVoice {
  setChordTones(midis: readonly number[]): void;
  setTempoBpm(bpm: number): void;
  setIntensity(v: number): void;
  setSparkle(v: number): void;
  setMode(mode: LeadMode): void;
  trigger(midi: number, accent?: number): void;
  render(): [number, number];
}

export function createLeadVoice(sampleRate: number, prng: Prng): LeadVoice {
  let phaseA = prng.next();
  let phaseB = prng.next();
  let freqHz = 440;
  let targetHz = 440;
  let sparkle = 0.5;
  let intensity = 0.5;
  let mode: LeadMode = "off";
  let chordTones: number[] = [60, 64, 67];
  let pan = 0.12;
  let accent = 1;
  let tempoBpm = 100;

  const env: Adsr = createAdsr({
    sampleRate,
    attackMs: 3,
    decayMs: 160,
    sustain: 0.16,
    releaseMs: 260,
  });
  const lpf = createSvf(sampleRate, 2800, 1.1);

  const portamentoCoef = 1 - Math.exp(-1 / (0.02 * sampleRate));

  return {
    setChordTones(midis) {
      if (midis.length > 0) chordTones = [...midis];
    },
    setTempoBpm(bpm) {
      tempoBpm = bpm;
      void tempoBpm;
    },
    setIntensity(v) {
      intensity = v < 0 ? 0 : v > 1 ? 1 : v;
    },
    setSparkle(v) {
      sparkle = v < 0 ? 0 : v > 1 ? 1 : v;
    },
    setMode(next) {
      mode = next;
      if (mode === "off") env.gateOff();
    },
    trigger(midi: number, nextAccent = 1) {
      targetHz = 440 * Math.pow(2, (midi - 69) / 12);
      pan = 0.08 + prng.next() * 0.24;
      accent = nextAccent;
      env.gateOn();
      lpf.setCutoff(1800 + sparkle * 5200 + intensity * 1000);
    },
    render(): [number, number] {
      if (env.stage === "idle" && mode === "off") return [0, 0];

      freqHz += portamentoCoef * (targetHz - freqHz);
      const dtA = freqHz / sampleRate;
      const dtB = (freqHz * (mode === "stabs" ? 0.5 : 1.002)) / sampleRate;
      phaseA = wrapPhase(phaseA + dtA);
      phaseB = wrapPhase(phaseB + dtB);

      const source = mode === "sparse"
        ? triangle(phaseA) * 0.8 + sine(phaseB) * 0.2
        : mode === "stabs"
          ? sine(phaseA) * 0.4 + polyBlepSaw(phaseB, dtB) * 0.35
          : polyBlepSaw(phaseA, dtA) * 0.42 + triangle(phaseB) * 0.28;

      const filtered = lpf.process(source);
      const e = env.process();
      const s = filtered * e * (0.22 + sparkle * 0.16) * accent;
      return [s * (1 - pan), s * (1 + pan)];
    },
  };
}
