/**
 * Tempo / bar / beat clock (§2.2, §3.1).
 *
 * - Advances sample-by-sample inside the DSP loop.
 * - Exposes bar boundaries for the form scheduler (§3.6) and a slow random
 *   walk on tempo (±2 BPM over 32 bars, §3.1) driven by the form PRNG.
 */

import type { Prng } from "../prng.js";

export interface TempoClockOptions {
  readonly sampleRate: number;
  readonly initialBpm: number;
  readonly beatsPerBar?: number; // default 4
  readonly drift?: {
    readonly prng: Prng;
    /** Maximum ± deviation from initialBpm (spec: 2). */
    readonly rangeBpm: number;
    /** Full-scale traversal in bars (spec: ~32). */
    readonly periodBars: number;
  };
}

export interface TempoClock {
  /** Current instantaneous BPM (already smoothed). */
  readonly bpm: number;
  /** Beats per bar. */
  readonly beatsPerBar: number;
  /** Continuous beat position since construction. */
  readonly beat: number;
  /** Integer bar count since construction. */
  readonly bar: number;
  /** Beat position within the current bar, in [0, beatsPerBar). */
  readonly beatInBar: number;
  /** Seconds per beat at the current tempo. */
  readonly secondsPerBeat: number;
  /** Advance by N audio frames; returns true iff a bar boundary was crossed. */
  advance(frames: number): boolean;
}

export function createTempoClock(opts: TempoClockOptions): TempoClock {
  const beatsPerBar = opts.beatsPerBar ?? 4;
  let bpm = opts.initialBpm;
  let targetBpm = opts.initialBpm;
  let beat = 0;
  let bar = 0;
  let barsSinceDriftStep = 0;

  const driftEverySeconds = 1; // update random-walk target once per second
  let driftTimerFrames = 0;
  const driftStepFrames = Math.round(driftEverySeconds * opts.sampleRate);

  const clock: TempoClock = {
    get bpm() {
      return bpm;
    },
    beatsPerBar,
    get beat() {
      return beat;
    },
    get bar() {
      return bar;
    },
    get beatInBar() {
      return beat - bar * beatsPerBar;
    },
    get secondsPerBeat() {
      return 60 / bpm;
    },
    advance(frames: number) {
      // Smooth bpm toward target.
      bpm += (targetBpm - bpm) * 0.002;

      const secs = frames / opts.sampleRate;
      const prevBeat = beat;
      beat += secs * (bpm / 60);

      const prevBar = bar;
      bar = Math.floor(beat / beatsPerBar);
      const crossedBar = bar !== prevBar;

      // Slow random walk on the target tempo.
      if (opts.drift) {
        driftTimerFrames += frames;
        if (driftTimerFrames >= driftStepFrames) {
          driftTimerFrames -= driftStepFrames;
          const { prng, rangeBpm, periodBars } = opts.drift;
          // Per-second walk step ~ range / (periodBars * secondsPerBar).
          const secondsPerBar = (60 / opts.initialBpm) * beatsPerBar;
          const perSecondStep = rangeBpm / (periodBars * secondsPerBar);
          const jitter = (prng.next() * 2 - 1) * perSecondStep;
          targetBpm = clamp(
            targetBpm + jitter,
            opts.initialBpm - rangeBpm,
            opts.initialBpm + rangeBpm,
          );
        }
      }

      // Avoid referencing prevBeat variable lint (kept for readability).
      void prevBeat;
      void barsSinceDriftStep;

      return crossedBar;
    },
  };

  return clock;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}
