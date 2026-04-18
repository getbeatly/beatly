/**
 * Public entrypoint for `@beatly/core/procedural`.
 *
 * Canonical render surface:
 *   - `renderProceduralPcm` → `{ samples, channels, sampleRate }`
 *   - `renderProceduralWav` → PCM-16 WAV bytes
 *
 * Lower-level primitives are also re-exported so that tests and future
 * host integrations (WebAudio bridge, etc.) can reuse the same building
 * blocks without duplicating DSP code.
 */

export {
  createProceduralEngine,
  renderProceduralPcm,
  renderProceduralWav,
  type ProceduralEngine,
  type ProceduralEngineOptions,
  type ProceduralEngineState,
  type ProceduralRenderOptions,
  type ProceduralRenderResult,
} from "./engine.js";

export { createPrng, createStream, deriveStreamSeed, defaultSessionSeed } from "./prng.js";
export type { Prng, PrngStreamName } from "./prng.js";

export { createOnePoleSmoother, tauFromTransitionMs } from "./dsp/smoothers.js";
export type { OnePoleSmoother, OnePoleOptions } from "./dsp/smoothers.js";

export { createTempoClock } from "./dsp/clock.js";
export type { TempoClock, TempoClockOptions } from "./dsp/clock.js";

export { MOOD_PALETTES, MODE_INTERVALS, midiToHz } from "./music/moods.js";
export type { MoodPalette, ModeName, ProgressionStep, WeightedProgression } from "./music/moods.js";

export {
  resolveChord,
  pickVoicing,
  pickVoicingAlternates,
  pickBassMidi,
} from "./music/chords.js";
export type { ResolvedChord, Voicing } from "./music/chords.js";

export { encodeWavPcm16Mono, encodeWavPcm16Stereo } from "./wav.js";
