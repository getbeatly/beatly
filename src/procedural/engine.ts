/**
 * Procedural audio engine — canonical entry point for
 * `@beatly/core/procedural`.
 *
 * Public surface is deliberately minimal: the only parameters you pick are
 *
 *   - `mood`: which palette to use
 *   - `intensity`: 0..1, the only macro exposed to callers
 *   - `seed` (optional): reproducibility knob
 *
 * Everything else (warmth, sparkle, pulse, space, tempo, progression,
 * voicing, humanization) is derived internally from mood × intensity × seed.
 * That keeps the DSP surface stable while we evolve what "sounds good" lives
 * behind the curtain.
 *
 * What's implemented so far (§10 steps 1–5 plus variation tweaks):
 *   - Seeded PRNG streams (§2.3)
 *   - Tempo/bar clock with slow drift (§3.1)
 *   - Progression scheduler: re-picks every 8 bars, never immediate repeat
 *   - Chord resolver with voice leading; voicing rotation across repeats
 *   - Three-voice pad with Haas widening (§4.1)
 *   - Bass + kick (humanized velocity) + kick-sidechain duck
 *   - Always-on ambience bed (pink noise → BP w/ slow LFO sweep)
 *   - Sparkle bell scheduler (Poisson-driven chord-tone pings)
 *   - FDN-8 reverb (§5.1) + soft-clipped stereo master
 *
 * Still to come (§10 steps 6–10):
 *   lead + ping-pong delay, hats, perc, granular shimmer, A/B form,
 *   tilt EQ + lookahead limiter, additive pad mode.
 */

import type { BeatlyMood } from "../adapters.js";
import { createTempoClock, type TempoClock } from "./dsp/clock.js";
import { createFdnReverb, type FdnReverb } from "./dsp/reverb-fdn8.js";
import { createSidechain, type Sidechain } from "./dsp/sidechain.js";
import {
  createOnePoleSmoother,
  tauFromTransitionMs,
  type OnePoleSmoother,
} from "./dsp/smoothers.js";
import {
  pickBassMidi,
  pickVoicingAlternates,
  resolveChord,
  type Voicing,
} from "./music/chords.js";
import { MOOD_PALETTES, type MoodPalette } from "./music/moods.js";
import {
  createProgressionScheduler,
  type ProgressionScheduler,
} from "./music/progression.js";
import { createStream, defaultSessionSeed, type Prng } from "./prng.js";
import { createAmbienceVoice, type AmbienceVoice } from "./voices/ambience.js";
import { createBassVoice, type BassVoice } from "./voices/bass.js";
import { createKickVoice, type KickVoice } from "./voices/kick.js";
import { createPadBus, type PadBus } from "./voices/pad.js";
import { createSparkleVoice, type SparkleVoice } from "./voices/sparkle.js";
import { encodeWavPcm16Mono, encodeWavPcm16Stereo } from "./wav.js";

const BLOCK_SIZE = 128;
const DEFAULT_CHORD_BARS = 2;
const BARS_PER_PROGRESSION = 8;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ProceduralEngineOptions {
  readonly mood: BeatlyMood;
  /** 0..1 — the single exposed macro. Defaults to 0.5. */
  readonly intensity?: number;
  readonly sampleRate?: number;
  /**
   * Deterministic seed. If omitted, a fresh pseudo-random seed is chosen so
   * every session sounds different — but once the seed is fixed, the output
   * is bit-identical.
   */
  readonly seed?: number;
}

export interface ProceduralEngineState {
  readonly mood: BeatlyMood;
  readonly seed: number;
  readonly sampleRate: number;
  readonly bar: number;
  readonly beat: number;
  readonly beatInBar: number;
  readonly tempoBpm: number;
  readonly intensity: number;
}

export interface ProceduralEngine {
  readonly sampleRate: number;
  readonly state: ProceduralEngineState;
  renderChunk(frames: number, channels?: 1 | 2): Float32Array;
  renderInto(buffer: Float32Array, frames: number, channels: 1 | 2): void;
  setIntensity(value: number, transitionMs?: number): void;
  setMood(mood: BeatlyMood): void;
  setSeed(seed: number): void;
}

export interface ProceduralRenderOptions extends ProceduralEngineOptions {
  readonly durationSeconds: number;
  /** Default true. When false returns mono (downmix). */
  readonly stereo?: boolean;
}

export interface ProceduralRenderResult {
  readonly samples: Float32Array;
  readonly channels: 1 | 2;
  readonly sampleRate: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

export function createProceduralEngine(options: ProceduralEngineOptions): ProceduralEngine {
  const sampleRate = options.sampleRate ?? 48_000;
  const controlPeriodSec = BLOCK_SIZE / sampleRate;

  let mood: BeatlyMood = options.mood;
  let palette: MoodPalette = MOOD_PALETTES[mood];
  let seed =
    options.seed !== undefined
      ? options.seed >>> 0
      : randomSessionSeed(mood, sampleRate);
  let pendingMood: BeatlyMood | null = null;

  // PRNG streams.
  let formPrng: Prng = createStream(seed, "form");
  let humanizePrng: Prng = createStream(seed, "humanize");

  // Intensity is the only exposed macro. All other "macros" are derived.
  // Held in a mutable binding so setIntensity() can swap in a smoother with
  // a different tau without destroying continuity (current value carries
  // over).
  let intensitySmoother: OnePoleSmoother = createOnePoleSmoother({
    controlPeriodSec,
    tauSec: tauFromTransitionMs(900),
    initial: clamp01(options.intensity ?? 0.5),
  });

  // Instant dynamic reaction envelopes (for "immediate" feel on intensity changes).
  let liftEnv = 0; // intensity pushed up
  let dropEnv = 0; // intensity pulled down
  const liftDecay = Math.exp(-1 / (0.45 * sampleRate));
  const dropDecay = Math.exp(-1 / (0.65 * sampleRate));

  const clock: TempoClock = createTempoClock({
    sampleRate,
    initialBpm: palette.tempoBpmDefault,
    drift: { prng: formPrng, rangeBpm: 2, periodBars: 32 },
  });

  // Voices + FX. Each gets its own PRNG sub-stream so they vary but remain
  // deterministic.
  const pad: PadBus = createPadBus(sampleRate, createStream(seed, "pad"));
  const bass: BassVoice = createBassVoice(sampleRate);
  const kick: KickVoice = createKickVoice(sampleRate);
  const ambience: AmbienceVoice = createAmbienceVoice(
    sampleRate,
    createStream(seed, "ambience"),
  );
  const sparkle: SparkleVoice = createSparkleVoice(
    sampleRate,
    createStream(seed, "sparkle"),
  );
  const reverb: FdnReverb = createFdnReverb({
    sampleRate,
    space: deriveMacros(palette, 0.5).space,
  });
  const sidechain: Sidechain = createSidechain(sampleRate, 5);

  const prog: ProgressionScheduler = createProgressionScheduler({
    palette,
    prng: formPrng,
    barsPerProgression: BARS_PER_PROGRESSION,
  });

  // Per-chord voicing cache so repeats of the same chord rotate voicings.
  // Key: `${mood}:${degree}:${rootOffset ?? 0}` → { voicings, visitCount }.
  const voicingCache = new Map<string, { voicings: Voicing[]; visit: number }>();

  let chordIdx = 0;
  let prevVoicing: Voicing | null = null;
  let prevBass: number | null = null;
  let currentChordRootMidi = palette.tonicMidi;
  let currentChordPitches: readonly number[] = [palette.tonicMidi, palette.tonicMidi + 4, palette.tonicMidi + 7];
  let lastBarIndex = -1;
  let lastBeatInt = -1;

  const applyDerivedMacros = (): void => {
    const m = deriveMacros(palette, intensitySmoother.value);
    pad.setWarmth(m.warmth);
    bass.setWarmth(m.warmth);
    pad.setBreathingRateBarHz(clock.bpm / 60 / 8);
    reverb.setSpace(m.space);
    sidechain.setDepthDb(3 + 4 * m.pulse);
    ambience.setSparkle(m.sparkle);
    ambience.setWarmth(m.warmth);
    sparkle.setSparkle(m.sparkle);
    sparkle.setIntensity(intensitySmoother.value);
  };

  const applyNextChord = (barIndex: number): void => {
    const chordBars = chordBarsFor(mood, intensitySmoother.value);
    if (barIndex !== 0 && barIndex % chordBars !== 0) return;
    const step = prog.current.steps[chordIdx % prog.current.steps.length];
    if (!step) return;
    const chord = resolveChord(mood, palette, step);

    const key = `${mood}:${step.degree}:${step.rootOffset ?? 0}`;
    let entry = voicingCache.get(key);
    if (!entry) {
      entry = {
        voicings: pickVoicingAlternates(chord, prevVoicing, 3),
        visit: 0,
      };
      voicingCache.set(key, entry);
    } else {
      entry.visit += 1;
    }
    const voicing =
      entry.voicings[entry.visit % entry.voicings.length] ??
      entry.voicings[0] ?? { pitches: [60, 64, 67] as const };

    pad.setVoicing(voicing.pitches);
    sparkle.setChordTones(voicing.pitches);
    currentChordRootMidi = chord.rootMidi;
    currentChordPitches = chord.pitches;

    const b = pickBassMidi(chord.rootMidi, prevBass);
    bass.trigger(b);
    prevVoicing = voicing;
    prevBass = b;
    chordIdx += 1;
  };

  // Kick off.
  applyDerivedMacros();
  pad.gateOn();
  applyNextChord(0);

  const engine: ProceduralEngine = {
    sampleRate,
    get state() {
      return {
        mood,
        seed,
        sampleRate,
        bar: clock.bar,
        beat: clock.beat,
        beatInBar: clock.beatInBar,
        tempoBpm: clock.bpm,
        intensity: intensitySmoother.value,
      };
    },
    setIntensity(value: number, transitionMs = 900) {
      const target = clamp01(value);
      const delta = target - intensitySmoother.value;
      if (delta > 0.03) {
        liftEnv = clamp01(liftEnv + delta * 1.4);
      } else if (delta < -0.03) {
        dropEnv = clamp01(dropEnv + -delta * 1.2);
      }

      const next = createOnePoleSmoother({
        controlPeriodSec,
        tauSec: tauFromTransitionMs(transitionMs),
        initial: intensitySmoother.value,
      });
      next.target(target);
      intensitySmoother = next;
    },
    setMood(next) {
      pendingMood = next;
    },
    setSeed(next) {
      seed = next >>> 0;
      formPrng = createStream(seed, "form");
      humanizePrng = createStream(seed, "humanize");
    },
    renderChunk(frames, channels = 2) {
      const buf = new Float32Array(frames * channels);
      this.renderInto(buf, frames, channels);
      return buf;
    },
    renderInto(buffer, frames, channels) {
      if (buffer.length < frames * channels) {
        throw new Error(`buffer too small: need ${frames * channels}, got ${buffer.length}`);
      }

      let frame = 0;
      while (frame < frames) {
        const blockFrames = Math.min(BLOCK_SIZE, frames - frame);
        const crossedBar = clock.advance(blockFrames);

        // Control-rate macro updates.
        intensitySmoother.tick();
        applyDerivedMacros();

        if (crossedBar && clock.bar !== lastBarIndex) {
          lastBarIndex = clock.bar;

          // Mood swap at bar boundary.
          if (pendingMood !== null && pendingMood !== mood) {
            mood = pendingMood;
            palette = MOOD_PALETTES[mood];
            prog.setPalette(palette);
            chordIdx = 0;
            voicingCache.clear();
            pendingMood = null;
          }

          // Progression rotation every N bars.
          prog.tick();

          // Mood-dependent pad swell chance to add phrasing movement.
          if (humanizePrng.next() < padRetriggerChance(mood, intensitySmoother.value)) {
            pad.gateOn(); // simple common-gate re-attack; all voices softly swell
          }

          applyNextChord(clock.bar);
        }

        // Beat-boundary rhythm scheduling.
        const curBeatInt = Math.floor(clock.beat);
        if (curBeatInt !== lastBeatInt) {
          const m = deriveMacros(palette, intensitySmoother.value);
          const rhythm = rhythmPatternFor(mood, m.pulse);
          for (let b = lastBeatInt + 1; b <= curBeatInt; b += 1) {
            const beatInBar = ((b % clock.beatsPerBar) + clock.beatsPerBar) % clock.beatsPerBar;
            if (rhythm.kickBeats.has(beatInBar)) kick.trigger();

            if (rhythm.bassBeats.has(beatInBar)) {
              const nextBass = bassPatternMidiFor({
                mood,
                beatInBar,
                pulse: m.pulse,
                rootMidi: currentChordRootMidi,
                chordPitches: currentChordPitches,
                prevBass,
              });
              bass.trigger(nextBass);
              prevBass = nextBass;
            }
          }
          lastBeatInt = curBeatInt;
        }

        // --- Sample loop ---
        for (let i = 0; i < blockFrames; i += 1) {
          const [padL, padR] = pad.render();
          const bassSample = bass.render();
          const kickSample = kick.render();
          const [ambL, ambR] = ambience.render();
          const [spkL, spkR] = sparkle.render();

          // Fast transient dynamics so intensity changes feel immediate.
          const lift = liftEnv;
          const drop = dropEnv;
          liftEnv *= liftDecay;
          dropEnv *= dropDecay;

          const kickDyn = kickSample * (1 + 0.55 * lift) * (1 - 0.45 * drop);
          const bassDyn = bassSample * (1 + 0.20 * lift) * (1 - 0.30 * drop);
          const padGain = 1 - 0.22 * lift + 0.10 * drop;
          const ambGain = 1 - 0.30 * lift + 0.18 * drop;
          const spkGain = 1 + 0.10 * lift - 0.20 * drop;

          const padDynL = padL * padGain;
          const padDynR = padR * padGain;
          const ambDynL = ambL * ambGain;
          const ambDynR = ambR * ambGain;
          const spkDynL = spkL * spkGain;
          const spkDynR = spkR * spkGain;

          const duck = sidechain.process(kickDyn);

          // Dry sum: pad/sparkle/ambience are ducked by the kick; bass isn't
          // (to keep the low end steady).
          const dryL = padDynL * duck + bassDyn + kickDyn + ambDynL * duck + spkDynL * duck;
          const dryR = padDynR * duck + bassDyn + kickDyn + ambDynR * duck + spkDynR * duck;

          // Reverb sends per §4.x (pad 0.55, bass 0.10, kick 0.08, sparkle 0.9, ambience 0.7).
          const sendL =
            padDynL * 0.55 * duck +
            bassDyn * 0.10 +
            kickDyn * 0.08 +
            spkDynL * 0.9 +
            ambDynL * 0.7;
          const sendR =
            padDynR * 0.55 * duck +
            bassDyn * 0.10 +
            kickDyn * 0.08 +
            spkDynR * 0.9 +
            ambDynR * 0.7;
          const [wetL, wetR] = reverb.process(sendL, sendR);

          const mixL = dryL + wetL * reverb.wetMix;
          const mixR = dryR + wetR * reverb.wetMix;

          const outL = ceiling(softClip(mixL * MASTER_HEADROOM));
          const outR = ceiling(softClip(mixR * MASTER_HEADROOM));

          const idx = (frame + i) * channels;
          if (channels === 2) {
            buffer[idx] = outL;
            buffer[idx + 1] = outR;
          } else {
            buffer[idx] = (outL + outR) * 0.5;
          }
        }

        frame += blockFrames;
      }


    },
  };

  return engine;
}

/**
 * One-shot deterministic render.
 */
export function renderProceduralPcm(options: ProceduralRenderOptions): ProceduralRenderResult {
  const sampleRate = options.sampleRate ?? 48_000;
  const stereo = options.stereo !== false;
  const durationSeconds = Math.max(0.5, options.durationSeconds);
  const totalFrames = Math.floor(durationSeconds * sampleRate);

  const engine = createProceduralEngine({ ...options, sampleRate });
  const channels: 1 | 2 = stereo ? 2 : 1;
  const samples = new Float32Array(totalFrames * channels);
  engine.renderInto(samples, totalFrames, channels);

  return { samples, channels, sampleRate };
}

export function renderProceduralWav(options: ProceduralRenderOptions): Uint8Array {
  const { samples, channels, sampleRate } = renderProceduralPcm(options);
  return channels === 2
    ? encodeWavPcm16Stereo(samples, sampleRate)
    : encodeWavPcm16Mono(samples, sampleRate);
}

// ---------------------------------------------------------------------------
// Mood × intensity → internal macros
// ---------------------------------------------------------------------------
//
// External API exposes only `mood` and `intensity`. Internally we still run
// the full macro set from AUDIO_SPEC.md §6 so the DSP can stay stable — we
// just compute them here instead of asking the caller for five sliders.

interface DerivedMacros {
  warmth: number;
  sparkle: number;
  pulse: number;
  space: number;
}

function deriveMacros(palette: MoodPalette, intensity: number): DerivedMacros {
  const d = palette.defaults;
  // Intensity mostly drives pulse (layer gating) and slightly pulls sparkle
  // up. Warmth & space stay characteristic of the mood — that's what makes
  // moods distinguishable even with the same intensity.
  const t = clamp01(intensity);
  return {
    warmth: d.warmth,
    sparkle: clamp01(d.sparkle * 0.7 + t * 0.4),
    pulse: clamp01(d.pulse * 0.4 + t * 0.8),
    space: d.space,
  };
}

function randomSessionSeed(mood: BeatlyMood, sampleRate: number): number {
  // One-time, outside the DSP path, so this doesn't violate §2.3.
  const nonce = Date.now() ^ Math.floor(Math.random() * 0xffff_ffff);
  return defaultSessionSeed(`${mood}|${nonce}`, 0, sampleRate);
}

// ---------------------------------------------------------------------------
// Master bus helpers
// ---------------------------------------------------------------------------

const EMPTY_SET: ReadonlySet<number> = new Set();
const BEATS_1_3: ReadonlySet<number> = new Set([0, 2]);
const BEATS_ALL: ReadonlySet<number> = new Set([0, 1, 2, 3]);
const BEATS_1_2_3_4: ReadonlySet<number> = new Set([0, 1, 2, 3]);
const BEATS_1_2_4: ReadonlySet<number> = new Set([0, 1, 3]);

interface RhythmPattern {
  kickBeats: ReadonlySet<number>;
  bassBeats: ReadonlySet<number>;
}

function rhythmPatternFor(mood: BeatlyMood, pulse: number): RhythmPattern {
  if (pulse < 0.2) {
    return { kickBeats: EMPTY_SET, bassBeats: new Set([0]) };
  }

  switch (mood) {
    case "calming":
      return {
        // jazzy + relaxed: sparse kick, walking-ish bass at higher pulse
        kickBeats: BEATS_1_3,
        bassBeats: pulse > 0.45 ? BEATS_1_2_3_4 : BEATS_1_3,
      };
    case "deep-focus":
      return {
        // rock-like: backbeat support and quarter bass when energetic
        kickBeats: pulse > 0.55 ? BEATS_ALL : BEATS_1_3,
        bassBeats: pulse > 0.55 ? BEATS_1_2_3_4 : BEATS_1_3,
      };
    case "flow":
      return {
        // electronic drive: four-on-the-floor + quarter bass
        kickBeats: BEATS_ALL,
        bassBeats: BEATS_1_2_3_4,
      };
    case "uplift":
      return {
        // brighter pop/electronic pulse
        kickBeats: BEATS_ALL,
        bassBeats: BEATS_1_2_4,
      };
    case "neutral":
    default:
      return {
        kickBeats: BEATS_1_3,
        bassBeats: pulse > 0.6 ? BEATS_1_2_3_4 : BEATS_1_3,
      };
  }
}

function bassPatternMidiFor(args: {
  mood: BeatlyMood;
  beatInBar: number;
  pulse: number;
  rootMidi: number;
  chordPitches: readonly number[];
  prevBass: number | null;
}): number {
  const { mood, beatInBar, pulse, rootMidi, chordPitches, prevBass } = args;

  const third = chordPitches[1] ?? rootMidi + 4;
  const fifth = chordPitches[2] ?? rootMidi + 7;
  const seventh = chordPitches[chordPitches.length - 1] ?? (rootMidi + 10);

  switch (mood) {
    case "calming": {
      // light jazz walk: root → 3rd → 5th → 7th (last step only when pulse allows)
      if (beatInBar === 0) return fitBassRangeNear(rootMidi, prevBass);
      if (beatInBar === 1) return fitBassRangeNear(third, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(fifth, prevBass);
      return pulse > 0.45 ? fitBassRangeNear(seventh, prevBass) : fitBassRangeNear(rootMidi, prevBass);
    }
    case "deep-focus": {
      // rock movement: root with fifth/octave alternation.
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(rootMidi + 7, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(rootMidi + 12, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
    }
    case "flow": {
      // electronic pulse: root-octave-fifth-octave.
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(rootMidi + 12, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(rootMidi + 7, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
    }
    case "uplift": {
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(rootMidi + 7, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
    }
    case "neutral":
    default:
      return beatInBar === 2 ? fitBassRangeNear(rootMidi + 7, prevBass) : fitBassRangeNear(rootMidi, prevBass);
  }
}

function fitBassRangeNear(targetMidi: number, prevBass: number | null): number {
  const candidates: number[] = [];
  for (let n = targetMidi - 36; n <= targetMidi + 36; n += 12) {
    if (n >= 36 && n <= 48) candidates.push(n);
  }
  if (candidates.length === 0) return pickBassMidi(targetMidi, prevBass);
  const anchor = prevBass ?? 42;
  candidates.sort((a, b) => Math.abs(a - anchor) - Math.abs(b - anchor));
  return candidates[0] ?? 42;
}

function chordBarsFor(mood: BeatlyMood, intensity: number): number {
  const t = clamp01(intensity);
  if (t < 0.78) return DEFAULT_CHORD_BARS;
  switch (mood) {
    case "flow":
    case "uplift":
    case "deep-focus":
      return 1;
    default:
      return DEFAULT_CHORD_BARS;
  }
}

function padRetriggerChance(mood: BeatlyMood, intensity: number): number {
  const t = clamp01(intensity);
  switch (mood) {
    case "calming":
      return 0.18 + t * 0.12;
    case "deep-focus":
      return 0.22 + t * 0.20;
    case "flow":
      return 0.30 + t * 0.24;
    case "uplift":
      return 0.34 + t * 0.22;
    case "neutral":
    default:
      return 0.22 + t * 0.16;
  }
}

const MASTER_HEADROOM = 0.5;
const CEILING = 0.98;

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function softClip(x: number): number {
  const DRIVE = 1.1;
  const NORM = 0.800499; // tanh(1.1)
  return Math.tanh(x * DRIVE) / NORM;
}

function ceiling(x: number): number {
  if (x > CEILING) return CEILING;
  if (x < -CEILING) return -CEILING;
  return x;
}

export type {
  AmbienceVoice,
  BassVoice,
  FdnReverb,
  KickVoice,
  PadBus,
  Sidechain,
  SparkleVoice,
  TempoClock,
};
