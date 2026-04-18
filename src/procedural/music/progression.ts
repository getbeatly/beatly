/**
 * Progression scheduler (§3.1 rules).
 *
 * - Picks from the mood's weighted progression palette.
 * - Refuses to repeat the previously-used progression twice in a row.
 * - Reshuffles every `barsPerProgression` bars (default 8).
 */

import type { MoodPalette, WeightedProgression } from "./moods.js";
import type { Prng } from "../prng.js";

export interface ProgressionScheduler {
  readonly current: WeightedProgression;
  /** Call at every bar boundary; returns true if the progression just rotated. */
  tick(): boolean;
  /** Swap the palette (e.g. on a mood change); forces an immediate re-pick. */
  setPalette(palette: MoodPalette): void;
}

export interface ProgressionSchedulerOptions {
  readonly palette: MoodPalette;
  readonly prng: Prng;
  readonly barsPerProgression?: number;
}

export function createProgressionScheduler(
  opts: ProgressionSchedulerOptions,
): ProgressionScheduler {
  const { prng } = opts;
  const barsPerProgression = opts.barsPerProgression ?? 8;

  let palette = opts.palette;
  let current = weightedPick(palette.progressions, prng, null);
  let barsElapsed = 0;

  const scheduler: ProgressionScheduler = {
    get current() {
      return current;
    },
    setPalette(nextPalette: MoodPalette) {
      palette = nextPalette;
      current = weightedPick(palette.progressions, prng, null);
      barsElapsed = 0;
    },
    tick() {
      barsElapsed += 1;
      if (barsElapsed >= barsPerProgression) {
        barsElapsed = 0;
        const next = weightedPick(palette.progressions, prng, current);
        const rotated = next !== current;
        current = next;
        return rotated;
      }
      return false;
    },
  };

  return scheduler;
}

function weightedPick(
  progressions: readonly WeightedProgression[],
  prng: Prng,
  exclude: WeightedProgression | null,
): WeightedProgression {
  const pool = progressions.filter((p) => p !== exclude);
  const candidates = pool.length > 0 ? pool : progressions;
  const total = candidates.reduce((s, p) => s + p.weight, 0);
  const pick = prng.next() * total;
  let acc = 0;
  for (const p of candidates) {
    acc += p.weight;
    if (pick <= acc) return p;
  }
  return candidates[0] as WeightedProgression;
}
