import { createOnePoleHpf, createSvf } from "../dsp/svf.js";
import type { Prng } from "../prng.js";

export type HatPattern = "off" | "eighths" | "sixteenths" | "syncopated";

export interface HatVoice {
  setTempoBpm(bpm: number): void;
  setPulse(v: number): void;
  setPattern(pattern: HatPattern): void;
  trigger(accent?: number, open?: boolean): void;
  render(): [number, number];
}

export function createHatVoice(sampleRate: number, prng: Prng): HatVoice {
  const hpf = createOnePoleHpf(sampleRate, 7000);
  const bpf = createSvf(sampleRate, 9000, 0.9);

  let phase = 0;
  let env = 0;
  let decay = Math.exp(-1 / (0.05 * sampleRate));
  let pulse = 0.5;
  let pattern: HatPattern = "eighths";
  let pan = 0;
  let amp = 0;
  let tempoBpm = 100;

  return {
    setTempoBpm(bpm: number) {
      tempoBpm = bpm;
      void tempoBpm;
    },
    setPulse(v: number) {
      pulse = v < 0 ? 0 : v > 1 ? 1 : v;
    },
    setPattern(next: HatPattern) {
      pattern = next;
      void pattern;
    },
    trigger(accent = 1, open = false) {
      env = 1;
      amp = (0.08 + pulse * 0.15) * accent;
      decay = Math.exp(-1 / ((open ? 0.18 : 0.045) * sampleRate));
      pan = prng.next() < 0.5 ? -0.22 : 0.22;
      const cutoff = 8200 + prng.next() * 1800;
      bpf.setCutoff(cutoff);
      phase = prng.next();
    },
    render(): [number, number] {
      if (env < 1e-4) return [0, 0];
      phase += 0.6180339887;
      if (phase >= 1) phase -= 1;
      const white = prng.next() * 2 - 1;
      const bright = hpf.process(white);
      const { band } = bpf.processAll(bright * 0.75);
      env *= decay;
      const s = band * env * amp;
      const l = s * (pan <= 0 ? 1 : 1 - pan);
      const r = s * (pan >= 0 ? 1 : 1 + pan);
      return [l, r];
    },
  };
}
