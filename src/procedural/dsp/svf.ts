/**
 * Chamberlin state-variable filter, 12 dB/oct (§4.1, §4.2).
 *
 * Two-pole, stable for cutoffs well below Nyquist/2. Exposes low/band/high
 * outputs from a single update. Cascade two instances for a 24 dB/oct
 * response (bass filter per §4.2).
 *
 * The `q` parameter here is the damping coefficient in [0, 2] — higher
 * values = less resonance. For the pad/bass we use q ≈ 1.4 (mild).
 */

export interface Svf {
  process(x: number): number; // returns low-pass output
  processAll(x: number): { low: number; band: number; high: number };
  setCutoff(hz: number): void;
  setDamping(q: number): void;
  reset(): void;
}

export function createSvf(sampleRate: number, cutoffHz: number, damping = 1.4): Svf {
  let low = 0;
  let band = 0;
  let f = 2 * Math.sin(Math.PI * Math.min(cutoffHz, sampleRate * 0.45) / sampleRate);
  let q = Math.max(0, Math.min(2, damping));

  const setCutoff = (hz: number) => {
    const c = Math.min(Math.max(hz, 20), sampleRate * 0.45);
    f = 2 * Math.sin(Math.PI * c / sampleRate);
  };

  return {
    setCutoff,
    setDamping(v: number) {
      q = Math.max(0, Math.min(2, v));
    },
    reset() {
      low = 0;
      band = 0;
    },
    process(x: number): number {
      low += f * band;
      const high = x - low - q * band;
      band += f * high;
      return low;
    },
    processAll(x: number) {
      low += f * band;
      const high = x - low - q * band;
      band += f * high;
      return { low, band, high };
    },
  };
}

/** Simple one-pole high-pass used for sub control (e.g. HPF @ 40 Hz on bass). */
export interface OnePoleHpf {
  process(x: number): number;
  setCutoff(hz: number): void;
  reset(): void;
}

export function createOnePoleHpf(sampleRate: number, cutoffHz: number): OnePoleHpf {
  let a = Math.exp(-2 * Math.PI * cutoffHz / sampleRate);
  let prevIn = 0;
  let prevOut = 0;

  return {
    setCutoff(hz: number) {
      a = Math.exp(-2 * Math.PI * Math.max(1, hz) / sampleRate);
    },
    reset() {
      prevIn = 0;
      prevOut = 0;
    },
    process(x: number): number {
      const y = a * (prevOut + x - prevIn);
      prevIn = x;
      prevOut = y;
      return y;
    },
  };
}

/** One-pole low-pass (for reverb damping, sidechain smoothing, etc.). */
export interface OnePoleLpf {
  process(x: number): number;
  setCutoff(hz: number): void;
  reset(): void;
}

export function createOnePoleLpf(sampleRate: number, cutoffHz: number): OnePoleLpf {
  let a = 1 - Math.exp(-2 * Math.PI * cutoffHz / sampleRate);
  let y = 0;

  return {
    setCutoff(hz: number) {
      a = 1 - Math.exp(-2 * Math.PI * Math.max(1, hz) / sampleRate);
    },
    reset() {
      y = 0;
    },
    process(x: number): number {
      y += a * (x - y);
      return y;
    },
  };
}
