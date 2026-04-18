/**
 * Deterministic PRNG for the procedural engine (§2.3).
 *
 * - Mulberry32 as the single algorithm.
 * - Sub-streams are derived by hashing (seed, name) so every layer has an
 *   independent, reproducible sequence.
 * - `Math.random()` must not appear anywhere inside the DSP path.
 */

export type PrngStreamName = "melody" | "humanize" | "shimmer" | "form" | "perc";

export interface Prng {
  /** Next float in [0, 1). */
  next(): number;
  /** Next int in [0, n). */
  nextInt(n: number): number;
  /** Next float in [lo, hi). */
  range(lo: number, hi: number): number;
  /** Fresh snapshot of the internal state (32-bit). */
  state(): number;
}

export function createPrng(seed: number): Prng {
  let s = (seed | 0) >>> 0;
  // Avoid the degenerate zero state.
  if (s === 0) {
    s = 0x9e3779b9;
  }

  const next = (): number => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  return {
    next,
    nextInt: (n: number) => Math.floor(next() * n),
    range: (lo: number, hi: number) => lo + next() * (hi - lo),
    state: () => s >>> 0,
  };
}

/**
 * Derive a stream seed from a parent seed and a layer name by mixing the
 * parent seed with an FNV-1a hash of the name.
 */
export function deriveStreamSeed(parentSeed: number, name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i += 1) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // splitmix-style mix of parentSeed and h so close seeds don't produce
  // correlated sub-streams.
  let x = ((parentSeed | 0) ^ (h | 0)) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x7feb352d) >>> 0;
  x = Math.imul(x ^ (x >>> 15), 0x846ca68b) >>> 0;
  x = (x ^ (x >>> 16)) >>> 0;
  return x >>> 0;
}

export function createStream(parentSeed: number, name: PrngStreamName | string): Prng {
  return createPrng(deriveStreamSeed(parentSeed, name));
}

/**
 * Default session seed derivation when the caller doesn't pass one.
 * Stable under identical (mood, durationSeconds, sampleRate).
 */
export function defaultSessionSeed(mood: string, durationSeconds: number, sampleRate: number): number {
  const payload = `${mood}|${durationSeconds.toFixed(6)}|${sampleRate}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < payload.length; i += 1) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
