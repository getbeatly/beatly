/**
 * One-pole smoothers running at control (block) rate (§6.2).
 *
 * We use the classic exponential smoother:
 *
 *     y[n] = y[n-1] + a * (target - y[n-1])
 *
 * where `a = 1 - exp(-dt / tau)`. The spec defines tau = transitionMs / 4,
 * so 4*tau ≈ full transition — that's where `OnePoleSmoother` lives.
 */

export interface OnePoleSmoother {
  /** Current smoothed value. */
  readonly value: number;
  /** Immediate jump to a value (no ramp); used for initialisation. */
  set(value: number): void;
  /** Move target; call once per control event. */
  target(value: number): void;
  /** Advance one control tick; returns the new value. */
  tick(): number;
  /** Batch-advance `n` control ticks (cheap). */
  advance(n: number): number;
}

export interface OnePoleOptions {
  /** Seconds between control ticks (= blockSize / sampleRate). */
  readonly controlPeriodSec: number;
  /** Spec: tau = transitionMs / 4. */
  readonly tauSec: number;
  /** Initial value for both current and target. */
  readonly initial?: number;
}

export function createOnePoleSmoother(opts: OnePoleOptions): OnePoleSmoother {
  const { controlPeriodSec, tauSec } = opts;
  const a = tauSec <= 0 ? 1 : 1 - Math.exp(-controlPeriodSec / tauSec);
  let current = opts.initial ?? 0;
  let tgt = current;

  return {
    get value() {
      return current;
    },
    set(v: number) {
      current = v;
      tgt = v;
    },
    target(v: number) {
      tgt = v;
    },
    tick() {
      current += a * (tgt - current);
      return current;
    },
    advance(n: number) {
      // y[n] = target + (y[0] - target) * (1 - a)^n  — closed form.
      const r = (1 - a) ** n;
      current = tgt + (current - tgt) * r;
      return current;
    },
  };
}

/**
 * Convenience helper: tau from the spec's `transitionMs` field.
 */
export function tauFromTransitionMs(transitionMs: number): number {
  return Math.max(0, transitionMs) / 4000;
}
