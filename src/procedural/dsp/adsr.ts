/**
 * ADSR envelope (§4.x). Stages are attack → decay → sustain (held while
 * gate=true) → release. Times are in milliseconds.
 *
 * Attack and release use linear ramps; decay uses exponential approach to
 * the sustain level. This matches classic analog behaviour closely enough
 * while staying click-free.
 */

export type EnvStage = "idle" | "attack" | "decay" | "sustain" | "release";

export interface Adsr {
  readonly value: number;
  readonly stage: EnvStage;
  gateOn(): void;
  gateOff(): void;
  /** Move to release immediately from the current value. */
  release(): void;
  /** Advance one sample. */
  process(): number;
  reset(value?: number): void;
}

export interface AdsrOptions {
  readonly sampleRate: number;
  readonly attackMs: number;
  readonly decayMs: number;
  readonly sustain: number; // 0..1
  readonly releaseMs: number;
  readonly initialValue?: number;
}

export function createAdsr(opts: AdsrOptions): Adsr {
  let value = opts.initialValue ?? 0;
  let stage: EnvStage = "idle";

  const sr = opts.sampleRate;
  const attackStep = 1 / Math.max(1, opts.attackMs * 1e-3 * sr);
  const decayCoef = Math.exp(-1 / Math.max(1, opts.decayMs * 1e-3 * sr));
  const releaseCoef = Math.exp(-1 / Math.max(1, opts.releaseMs * 1e-3 * sr));
  const sustain = Math.max(0, Math.min(1, opts.sustain));

  return {
    get value() {
      return value;
    },
    get stage() {
      return stage;
    },
    gateOn() {
      stage = "attack";
    },
    gateOff() {
      if (stage !== "idle") stage = "release";
    },
    release() {
      stage = "release";
    },
    reset(v = 0) {
      value = v;
      stage = "idle";
    },
    process(): number {
      switch (stage) {
        case "attack":
          value += attackStep;
          if (value >= 1) {
            value = 1;
            stage = "decay";
          }
          break;
        case "decay":
          value = sustain + (value - sustain) * decayCoef;
          if (Math.abs(value - sustain) < 1e-4) {
            value = sustain;
            stage = "sustain";
          }
          break;
        case "sustain":
          value = sustain;
          break;
        case "release":
          value *= releaseCoef;
          if (value < 1e-4) {
            value = 0;
            stage = "idle";
          }
          break;
        default:
          value = 0;
      }
      return value;
    },
  };
}
