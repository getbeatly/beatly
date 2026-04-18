/**
 * FDN-8 reverb (§5.1).
 *
 * - 8 delay lines with co-prime-ish delay times (23, 29, 41, 53, 67, 79,
 *   97, 113 ms).
 * - Feedback matrix is a Householder reflection I − (2/N)·11ᵀ, applied in
 *   O(N) via the vector identity `y = x − (2 * mean(x)) * 1`. Lossless.
 * - Each line has an in-loop one-pole low-pass for frequency-dependent
 *   damping (darker rooms when `space` is low).
 * - Pre-delay on the input, stereo output by summing lines 0..3 → L and
 *   4..7 → R.
 */

const DELAY_TIMES_MS = [23, 29, 41, 53, 67, 79, 97, 113];
const N = 8;
const MEAN_SCALE = 2 / N;

export interface FdnReverbOptions {
  readonly sampleRate: number;
  /** 0..1 — drives rt60, pre-delay, damping, wet mix. */
  readonly space?: number;
}

export interface FdnReverb {
  /** Process one stereo input sample, returns the wet (L, R) pair. */
  process(inL: number, inR: number): [number, number];
  /** Update macro params between blocks. */
  setSpace(space: number): void;
  reset(): void;
  /** Convenience: wet mix level implied by the current `space`. */
  readonly wetMix: number;
}

export function createFdnReverb(opts: FdnReverbOptions): FdnReverb {
  const sr = opts.sampleRate;
  let space = clamp01(opts.space ?? 0.5);

  // Per-line delay buffers sized to the longest delay + pre-delay headroom.
  const lineLengths: number[] = DELAY_TIMES_MS.map((ms) =>
    Math.max(2, Math.floor((ms / 1000) * sr)),
  );
  const buffers: Float32Array[] = lineLengths.map((n) => new Float32Array(n));
  const writeIdx = new Int32Array(N);
  const damp = new Float32Array(N); // one-pole LPF state per line
  const scratch = new Float32Array(N);

  // Pre-delay buffer sized for the maximum 60 ms.
  const maxPreSamples = Math.ceil((60 / 1000) * sr);
  const preBufL = new Float32Array(maxPreSamples + 1);
  const preBufR = new Float32Array(maxPreSamples + 1);
  let preW = 0;

  // Derived from space, recomputed on setSpace().
  let g = 0;         // global decay coefficient
  let dampA = 0;     // per-line LPF coefficient (1 - exp(-2π fc/sr))
  let preSamples = 0;
  let wetMix = 0;

  const recompute = () => {
    const meanDelaySec =
      DELAY_TIMES_MS.reduce((a, b) => a + b, 0) / N / 1000;
    const rt60 = 1.5 + 5.5 * space;
    g = Math.pow(10, -3 * meanDelaySec / rt60);
    const dampHz = 3500 + 3500 * (1 - space);
    dampA = 1 - Math.exp(-2 * Math.PI * dampHz / sr);
    preSamples = Math.floor(((20 + 40 * space) / 1000) * sr);
    wetMix = Math.min(0.55, 0.25 + 0.35 * space);
  };
  recompute();

  return {
    get wetMix() {
      return wetMix;
    },
    setSpace(v: number) {
      space = clamp01(v);
      recompute();
    },
    reset() {
      for (const b of buffers) b.fill(0);
      damp.fill(0);
      preBufL.fill(0);
      preBufR.fill(0);
      preW = 0;
    },
    process(inL: number, inR: number): [number, number] {
      // --- Pre-delay (stereo) ---
      preBufL[preW] = inL;
      preBufR[preW] = inR;
      const preR = (preW - preSamples + preBufL.length) % preBufL.length;
      const pL = preBufL[preR] ?? 0;
      const pR = preBufR[preR] ?? 0;
      preW = (preW + 1) % preBufL.length;

      // The input is distributed to all 8 lines; split mono-ish so L feeds
      // lines 0..3 and R feeds 4..7 (this preserves stereo entry).
      const inSum = pL + pR;

      // --- 1. Read from each line, LPF for damping ---
      for (let i = 0; i < N; i += 1) {
        const buf = buffers[i] as Float32Array;
        const len = buf.length;
        const rIdx = writeIdx[i] ?? 0; // read slot == next-write slot (one-sample delay of length len)
        void len;
        const s = buf[rIdx] ?? 0;
        // one-pole damping LPF in the loop
        const prev = damp[i] ?? 0;
        const lpf = prev + dampA * (s - prev);
        damp[i] = lpf;
        scratch[i] = lpf;
      }

      // --- 2. Householder mix: y = x − (2/N) * sum(x) * 1 ---
      let sum = 0;
      for (let i = 0; i < N; i += 1) sum += scratch[i] ?? 0;
      const offset = MEAN_SCALE * sum;
      for (let i = 0; i < N; i += 1) {
        scratch[i] = (scratch[i] ?? 0) - offset;
      }

      // --- 3. Write back with input + feedback * g ---
      for (let i = 0; i < N; i += 1) {
        const buf = buffers[i] as Float32Array;
        const len = buf.length;
        const injected = i < 4 ? pL : pR;
        buf[writeIdx[i] ?? 0] = injected + (scratch[i] ?? 0) * g;
        writeIdx[i] = (((writeIdx[i] ?? 0) + 1) % len) | 0;
      }

      // --- 4. Stereo output: L = sum 0..3, R = sum 4..7, scaled ---
      const outScale = 0.35;
      let outL = 0;
      let outR = 0;
      for (let i = 0; i < 4; i += 1) outL += scratch[i] ?? 0;
      for (let i = 4; i < 8; i += 1) outR += scratch[i] ?? 0;

      // Very light cross-mix so the two halves don't feel like two separate
      // mono reverbs, but keep it low so the stereo image stays wide.
      const lOut = (outL + outR * 0.05) * outScale;
      const rOut = (outR + outL * 0.05) * outScale;

      // Swallow the inSum lint without affecting behaviour; pre-delay uses
      // pL/pR directly.
      void inSum;

      return [lOut, rOut];
    },
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
