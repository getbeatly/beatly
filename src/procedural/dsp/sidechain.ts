/**
 * Kick-driven sidechain envelope follower (§5.3).
 *
 * Attack 5 ms, release 180 ms. Output is a gain multiplier in (0, 1] to
 * be applied to the pad/lead/shimmer sum. Depth in dB is mapped as
 * `3 + 4 * pulse` dB by the caller.
 */

export interface Sidechain {
  /** Feed the raw kick sample; returns a gain multiplier for the duck bus. */
  process(kickSample: number): number;
  setDepthDb(db: number): void;
  reset(): void;
}

export function createSidechain(sampleRate: number, depthDb = 5): Sidechain {
  const attackMs = 5;
  const releaseMs = 180;
  const aAtk = 1 - Math.exp(-1 / (attackMs * 1e-3 * sampleRate));
  const aRel = 1 - Math.exp(-1 / (releaseMs * 1e-3 * sampleRate));
  let env = 0;
  let depth = clampDepth(depthDb);

  return {
    setDepthDb(db: number) {
      depth = clampDepth(db);
    },
    reset() {
      env = 0;
    },
    process(kickSample: number): number {
      const rect = Math.abs(kickSample);
      // Asymmetric smoothing: fast attack, slow release.
      if (rect > env) env += aAtk * (rect - env);
      else env += aRel * (rect - env);

      // env ∈ [0, ~1]. Map to gain reduction: at env=1 → full duck depth.
      const gainDb = -depth * Math.min(1, env * 3);
      return Math.pow(10, gainDb / 20);
    },
  };
}

function clampDepth(db: number): number {
  return Math.max(0, Math.min(18, db));
}
