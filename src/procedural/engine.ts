/**
 * Procedural audio engine — canonical entry point for
 * `@beatly/core/procedural`.
 *
 * Public surface is deliberately minimal: the caller mainly chooses mood,
 * intensity, seed, and an optional broad style profile. The style profile is
 * intentionally high-level: it biases groove, density, ambience, and macro
 * mapping so the playground can jump between clearly different scenes without
 * exposing a giant synthesis control panel.
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
import { MODE_INTERVALS, MOOD_PALETTES, type MoodPalette } from "./music/moods.js";
import {
  createProgressionScheduler,
  type ProgressionScheduler,
} from "./music/progression.js";
import { createStream, defaultSessionSeed, type Prng } from "./prng.js";
import { createAmbienceVoice, type AmbienceVoice } from "./voices/ambience.js";
import { createBassVoice, type BassVoice } from "./voices/bass.js";
import { createKickVoice, type KickVoice } from "./voices/kick.js";
import { createHatVoice, type HatPattern, type HatVoice } from "./voices/hat.js";
import { createLeadVoice, type LeadMode, type LeadVoice } from "./voices/lead.js";
import { createPadBus, type PadBus } from "./voices/pad.js";
import { createSparkleVoice, type SparkleVoice } from "./voices/sparkle.js";
import { encodeWavPcm16Mono, encodeWavPcm16Stereo } from "./wav.js";

const BLOCK_SIZE = 128;
const DEFAULT_CHORD_BARS = 2;
const BARS_PER_PROGRESSION = 8;

export type ProceduralStyleId =
  | "ambient-wash"
  | "synthwave-drive"
  | "dub-tech"
  | "noir-waltz"
  | "arcade-sprint"
  | "cosmic-drone";

interface ProceduralStyleProfile {
  readonly id: ProceduralStyleId;
  readonly label: string;
  readonly tempoMultiplier: number;
  readonly warmthBias: number;
  readonly sparkleBias: number;
  readonly pulseBias: number;
  readonly spaceBias: number;
  readonly padGain: number;
  readonly bassGain: number;
  readonly kickGain: number;
  readonly ambienceGain: number;
  readonly sparkleGain: number;
  readonly retriggerBias: number;
  readonly chordBarsBias: -1 | 0 | 1;
  readonly kickMode: "off" | "sparse" | "backbeat" | "four" | "broken";
  readonly bassMode: "root" | "walk" | "octave" | "pulse" | "offbeat" | "pedal";
  readonly leadMode: LeadMode;
  readonly hatPattern: HatPattern;
}

export const PROCEDURAL_STYLE_PROFILES: Record<ProceduralStyleId, ProceduralStyleProfile> = {
  "ambient-wash": {
    id: "ambient-wash",
    label: "Ambient Wash",
    tempoMultiplier: 0.72,
    warmthBias: 0.2,
    sparkleBias: 0.05,
    pulseBias: -0.35,
    spaceBias: 0.28,
    padGain: 1.18,
    bassGain: 0.45,
    kickGain: 0.08,
    ambienceGain: 1.45,
    sparkleGain: 0.9,
    retriggerBias: -0.18,
    chordBarsBias: 1,
    kickMode: "off",
    bassMode: "pedal",
    leadMode: "sparse",
    hatPattern: "off",
  },
  "synthwave-drive": {
    id: "synthwave-drive",
    label: "Synthwave Drive",
    tempoMultiplier: 1.05,
    warmthBias: 0.08,
    sparkleBias: 0.16,
    pulseBias: 0.22,
    spaceBias: 0.02,
    padGain: 0.92,
    bassGain: 1.08,
    kickGain: 0.95,
    ambienceGain: 0.65,
    sparkleGain: 0.78,
    retriggerBias: 0.14,
    chordBarsBias: -1,
    kickMode: "four",
    bassMode: "octave",
    leadMode: "hook",
    hatPattern: "eighths",
  },
  "dub-tech": {
    id: "dub-tech",
    label: "Dub Tech",
    tempoMultiplier: 0.9,
    warmthBias: 0.1,
    sparkleBias: -0.08,
    pulseBias: 0.12,
    spaceBias: 0.18,
    padGain: 0.86,
    bassGain: 1.2,
    kickGain: 0.8,
    ambienceGain: 0.72,
    sparkleGain: 0.45,
    retriggerBias: 0.03,
    chordBarsBias: 0,
    kickMode: "broken",
    bassMode: "offbeat",
    leadMode: "stabs",
    hatPattern: "syncopated",
  },
  "noir-waltz": {
    id: "noir-waltz",
    label: "Noir Waltz",
    tempoMultiplier: 0.78,
    warmthBias: 0.16,
    sparkleBias: -0.02,
    pulseBias: -0.12,
    spaceBias: 0.12,
    padGain: 1.05,
    bassGain: 0.85,
    kickGain: 0.45,
    ambienceGain: 0.8,
    sparkleGain: 0.62,
    retriggerBias: -0.08,
    chordBarsBias: 1,
    kickMode: "sparse",
    bassMode: "walk",
    leadMode: "sparse",
    hatPattern: "eighths",
  },
  "arcade-sprint": {
    id: "arcade-sprint",
    label: "Arcade Sprint",
    tempoMultiplier: 1.18,
    warmthBias: -0.1,
    sparkleBias: 0.28,
    pulseBias: 0.3,
    spaceBias: -0.08,
    padGain: 0.74,
    bassGain: 1.18,
    kickGain: 1.08,
    ambienceGain: 0.42,
    sparkleGain: 1.18,
    retriggerBias: 0.2,
    chordBarsBias: -1,
    kickMode: "four",
    bassMode: "pulse",
    leadMode: "arp",
    hatPattern: "sixteenths",
  },
  "cosmic-drone": {
    id: "cosmic-drone",
    label: "Cosmic Drone",
    tempoMultiplier: 0.66,
    warmthBias: 0.18,
    sparkleBias: 0.12,
    pulseBias: -0.28,
    spaceBias: 0.3,
    padGain: 1.25,
    bassGain: 0.58,
    kickGain: 0.12,
    ambienceGain: 1.35,
    sparkleGain: 1.1,
    retriggerBias: -0.22,
    chordBarsBias: 1,
    kickMode: "off",
    bassMode: "root",
    leadMode: "sparse",
    hatPattern: "off",
  },
};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface ProceduralEngineOptions {
  readonly mood: BeatlyMood;
  /** 0..1 — the single exposed macro. Defaults to 0.5. */
  readonly intensity?: number;
  readonly sampleRate?: number;
  readonly seed?: number;
  readonly style?: ProceduralStyleId;
}

export interface ProceduralEngineState {
  readonly mood: BeatlyMood;
  readonly style: ProceduralStyleId;
  readonly styleLabel: string;
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
  setStyle(style: ProceduralStyleId): void;
  setSeed(seed: number): void;
}

export interface ProceduralRenderOptions extends ProceduralEngineOptions {
  readonly durationSeconds: number;
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
  let style: ProceduralStyleId = options.style ?? "synthwave-drive";
  let styleProfile = PROCEDURAL_STYLE_PROFILES[style];
  let seed =
    options.seed !== undefined
      ? options.seed >>> 0
      : randomSessionSeed(mood, sampleRate, style);
  let pendingMood: BeatlyMood | null = null;
  let pendingStyle: ProceduralStyleId | null = null;

  let formPrng: Prng = createStream(seed, "form");
  let humanizePrng: Prng = createStream(seed, "humanize");

  let intensitySmoother: OnePoleSmoother = createOnePoleSmoother({
    controlPeriodSec,
    tauSec: tauFromTransitionMs(900),
    initial: clamp01(options.intensity ?? 0.5),
  });

  let liftEnv = 0;
  let dropEnv = 0;
  const liftDecay = Math.exp(-1 / (0.45 * sampleRate));
  const dropDecay = Math.exp(-1 / (0.65 * sampleRate));

  const clock: TempoClock = createTempoClock({
    sampleRate,
    initialBpm: styledBaseTempo(palette, styleProfile),
    drift: { prng: formPrng, rangeBpm: 2, periodBars: 32 },
  });

  const pad: PadBus = createPadBus(sampleRate, createStream(seed, "pad"));
  const bass: BassVoice = createBassVoice(sampleRate);
  const kick: KickVoice = createKickVoice(sampleRate);
  const hat: HatVoice = createHatVoice(sampleRate, createStream(seed, "perc"));
  const lead: LeadVoice = createLeadVoice(sampleRate, createStream(seed, "melody"));
  const ambience: AmbienceVoice = createAmbienceVoice(sampleRate, createStream(seed, "ambience"));
  const sparkle: SparkleVoice = createSparkleVoice(sampleRate, createStream(seed, "sparkle"));
  const reverb: FdnReverb = createFdnReverb({
    sampleRate,
    space: deriveMacros(palette, 0.5, styleProfile).space,
  });
  const sidechain: Sidechain = createSidechain(sampleRate, 5);

  const prog: ProgressionScheduler = createProgressionScheduler({
    palette,
    prng: formPrng,
    barsPerProgression: BARS_PER_PROGRESSION,
  });

  const voicingCache = new Map<string, { voicings: Voicing[]; visit: number }>();

  let chordIdx = 0;
  let prevVoicing: Voicing | null = null;
  let prevBass: number | null = null;
  let currentChordRootMidi = palette.tonicMidi;
  let currentChordPitches: readonly number[] = [palette.tonicMidi, palette.tonicMidi + 4, palette.tonicMidi + 7];
  let randomLoop = randomLoopFromPrng(formPrng, intensitySmoother.value);
  let lastBarIndex = -1;
  let lastBeatInt = -1;
  let lastSixteenthInt = -1;

  const applyDerivedMacros = (): void => {
    const m = deriveMacros(palette, intensitySmoother.value, styleProfile);
    pad.setWarmth(m.warmth);
    bass.setWarmth(m.warmth);
    pad.setBreathingRateBarHz((clock.bpm / 60 / 8) * styleBreathingMultiplier(styleProfile));
    reverb.setSpace(m.space);
    sidechain.setDepthDb(2 + 5.5 * m.pulse);
    ambience.setSparkle(m.sparkle);
    ambience.setWarmth(m.warmth);
    sparkle.setSparkle(m.sparkle);
    sparkle.setIntensity(intensitySmoother.value);
    hat.setTempoBpm(clock.bpm);
    hat.setPulse(m.pulse);
    hat.setPattern(styleProfile.hatPattern);
    lead.setTempoBpm(clock.bpm);
    lead.setIntensity(intensitySmoother.value);
    lead.setSparkle(m.sparkle);
    lead.setMode(styleProfile.leadMode);
  };

  const applyNextChord = (barIndex: number): void => {
    const chordBars = chordBarsFor(mood, intensitySmoother.value, styleProfile);
    if (barIndex !== 0 && barIndex % chordBars !== 0) return;
    const step = prog.current.steps[chordIdx % prog.current.steps.length];
    if (!step) return;
    const chord = resolveChord(mood, palette, step);

    const key = `${mood}:${style}:${step.degree}:${step.rootOffset ?? 0}`;
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
    lead.setChordTones(chord.pitches);
    currentChordRootMidi = chord.rootMidi;
    currentChordPitches = chord.pitches;

    const b = pickBassMidi(chord.rootMidi, prevBass);
    bass.trigger(b);
    prevVoicing = voicing;
    prevBass = b;
    chordIdx += 1;
  };

  applyDerivedMacros();
  pad.gateOn();
  applyNextChord(0);

  const engine: ProceduralEngine = {
    sampleRate,
    get state() {
      return {
        mood,
        style,
        styleLabel: styleProfile.label,
        seed,
        sampleRate,
        bar: clock.bar,
        beat: clock.beat,
        beatInBar: clock.beatInBar,
        tempoBpm: clock.bpm,
        intensity: intensitySmoother.value,
      };
    },
    setIntensity(value, transitionMs = 900) {
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
    setStyle(next) {
      pendingStyle = next;
    },
    setSeed(next) {
      seed = next >>> 0;
      formPrng = createStream(seed, "form");
      humanizePrng = createStream(seed, "humanize");
      randomLoop = randomLoopFromPrng(formPrng, intensitySmoother.value);
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

        intensitySmoother.tick();
        applyDerivedMacros();

        if (crossedBar && clock.bar !== lastBarIndex) {
          lastBarIndex = clock.bar;

          if (pendingStyle !== null && pendingStyle !== style) {
            style = pendingStyle;
            styleProfile = PROCEDURAL_STYLE_PROFILES[style];
            clock.setBaseBpm(styledBaseTempo(palette, styleProfile));
            voicingCache.clear();
            pendingStyle = null;
          }

          if (pendingMood !== null && pendingMood !== mood) {
            mood = pendingMood;
            palette = MOOD_PALETTES[mood];
            prog.setPalette(palette);
            clock.setBaseBpm(styledBaseTempo(palette, styleProfile));
            chordIdx = 0;
            voicingCache.clear();
            pendingMood = null;
          }

          prog.tick();

          if (clock.bar % 2 === 0 || humanizePrng.next() < 0.4) {
            randomLoop = randomLoopFromPrng(formPrng, intensitySmoother.value);
          }

          if (humanizePrng.next() < padRetriggerChance(mood, intensitySmoother.value, styleProfile)) {
            pad.gateOn();
          }

          applyNextChord(clock.bar);
        }

        const m = deriveMacros(palette, intensitySmoother.value, styleProfile);

        const curBeatInt = Math.floor(clock.beat);
        if (curBeatInt !== lastBeatInt) {
          const rhythm = rhythmPatternFor(mood, m.pulse, styleProfile);
          for (let b = lastBeatInt + 1; b <= curBeatInt; b += 1) {
            const beatInBar = ((b % clock.beatsPerBar) + clock.beatsPerBar) % clock.beatsPerBar;
            const beatOn = maskHasBeat(randomLoop.kickMask, beatInBar);
            if (beatOn && rhythm.kickBeats.has(beatInBar)) kick.trigger();

            const bassBeatOn = maskHasBeat(randomLoop.bassMask, beatInBar);
            if (bassBeatOn && rhythm.bassBeats.has(beatInBar)) {
              let nextBass = bassPatternMidiFor({
                mood,
                style: styleProfile,
                beatInBar,
                pulse: m.pulse,
                rootMidi: currentChordRootMidi,
                chordPitches: currentChordPitches,
                prevBass,
              });

              if (formPrng.next() < randomLoop.bassScaleChance) {
                nextBass = pickRandomScaleBassMidi({
                  palette,
                  chordPitches: currentChordPitches,
                  rootMidi: currentChordRootMidi,
                  prevBass,
                  prng: formPrng,
                });
              }

              bass.trigger(nextBass);
              prevBass = nextBass;
            }
          }
          lastBeatInt = curBeatInt;
        }

        const curSixteenthInt = Math.floor(clock.beat * 4);
        if (curSixteenthInt !== lastSixteenthInt) {
          for (let s = lastSixteenthInt + 1; s <= curSixteenthInt; s += 1) {
            const stepInBar = ((s % 16) + 16) % 16;

            if (shouldTriggerHat(stepInBar, styleProfile, randomLoop, m.pulse)) {
              const open = isOpenHatStep(stepInBar, styleProfile, formPrng, randomLoop);
              const accent = stepInBar % 4 === 0 ? 1.15 : stepInBar % 2 === 0 ? 0.95 : 0.78;
              hat.trigger(accent, open);
            }

            if (shouldTriggerLead(stepInBar, styleProfile, randomLoop, intensitySmoother.value)) {
              const nextLeadMidi = pickLeadMidi({
                palette,
                chordPitches: currentChordPitches,
                style: styleProfile,
                stepInBar,
                prng: formPrng,
              });
              const accent = stepInBar % 4 === 0 ? 1.15 : 0.9 + formPrng.next() * 0.18;
              lead.trigger(nextLeadMidi + randomLoop.leadTranspose, accent);
            }
          }
          lastSixteenthInt = curSixteenthInt;
        }

        const gains = styleGains(styleProfile, intensitySmoother.value);

        for (let i = 0; i < blockFrames; i += 1) {
          const [padL, padR] = pad.render();
          const bassSample = bass.render();
          const kickSample = kick.render();
          const [hatL, hatR] = hat.render();
          const [leadL, leadR] = lead.render();
          const [ambL, ambR] = ambience.render();
          const [spkL, spkR] = sparkle.render();

          const lift = liftEnv;
          const drop = dropEnv;
          liftEnv *= liftDecay;
          dropEnv *= dropDecay;

          const kickDyn =
            kickSample * gains.kick * randomLoop.kick * (1 + 0.55 * lift) * (1 - 0.45 * drop);
          const bassDyn =
            bassSample * gains.bass * randomLoop.bass * (1 + 0.20 * lift) * (1 - 0.30 * drop);
          const hatDynL = hatL * gains.hat * randomLoop.hat;
          const hatDynR = hatR * gains.hat * randomLoop.hat;
          const leadDynL = leadL * gains.lead * randomLoop.lead;
          const leadDynR = leadR * gains.lead * randomLoop.lead;
          const padGain = gains.pad * randomLoop.pad * (1 - 0.22 * lift + 0.10 * drop);
          const ambGain = gains.ambience * randomLoop.ambience * (1 - 0.30 * lift + 0.18 * drop);
          const spkGain = gains.sparkle * randomLoop.sparkle * (1 + 0.10 * lift - 0.20 * drop);

          const padDynL = padL * padGain;
          const padDynR = padR * padGain;
          const ambDynL = ambL * ambGain;
          const ambDynR = ambR * ambGain;
          const spkDynL = spkL * spkGain;
          const spkDynR = spkR * spkGain;

          const duck = sidechain.process(kickDyn);

          const dryL = padDynL * duck + bassDyn + kickDyn + hatDynL + leadDynL * duck + ambDynL * duck + spkDynL * duck;
          const dryR = padDynR * duck + bassDyn + kickDyn + hatDynR + leadDynR * duck + ambDynR * duck + spkDynR * duck;

          const sendL =
            padDynL * 0.55 * duck +
            bassDyn * 0.10 +
            kickDyn * 0.08 +
            hatDynL * 0.18 +
            leadDynL * 0.32 +
            spkDynL * 0.9 +
            ambDynL * 0.7;
          const sendR =
            padDynR * 0.55 * duck +
            bassDyn * 0.10 +
            kickDyn * 0.08 +
            hatDynR * 0.18 +
            leadDynR * 0.32 +
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

interface DerivedMacros {
  warmth: number;
  sparkle: number;
  pulse: number;
  space: number;
}

function deriveMacros(
  palette: MoodPalette,
  intensity: number,
  style: ProceduralStyleProfile,
): DerivedMacros {
  const d = palette.defaults;
  const t = clamp01(intensity);
  return {
    warmth: clamp01(d.warmth + style.warmthBias),
    sparkle: clamp01(d.sparkle * 0.7 + t * 0.4 + style.sparkleBias),
    pulse: clamp01(d.pulse * 0.4 + t * 0.8 + style.pulseBias),
    space: clamp01(d.space + style.spaceBias),
  };
}

function styledBaseTempo(palette: MoodPalette, style: ProceduralStyleProfile): number {
  return clamp(palette.tempoBpmDefault * style.tempoMultiplier, 54, 148);
}

function styleBreathingMultiplier(style: ProceduralStyleProfile): number {
  switch (style.id) {
    case "ambient-wash":
    case "cosmic-drone":
      return 0.6;
    case "arcade-sprint":
      return 1.3;
    default:
      return 1;
  }
}

function styleGains(style: ProceduralStyleProfile, intensity: number) {
  const t = clamp01(intensity);
  return {
    pad: style.padGain * (0.92 + (1 - t) * 0.18),
    bass: style.bassGain * (0.7 + t * 0.45),
    kick: style.kickGain * (0.6 + t * 0.5),
    hat: (style.hatPattern === "off" ? 0 : 0.18 + t * 0.32),
    lead: (style.leadMode === "off" ? 0 : 0.22 + t * 0.34),
    ambience: style.ambienceGain * (0.85 + (1 - t) * 0.2),
    sparkle: style.sparkleGain * (0.75 + t * 0.35),
  };
}

interface RandomLoopState {
  kickMask: number;
  bassMask: number;
  hatMask16: number;
  leadMask16: number;
  pad: number;
  bass: number;
  kick: number;
  hat: number;
  lead: number;
  ambience: number;
  sparkle: number;
  bassScaleChance: number;
  leadTranspose: number;
  hatOpenChance: number;
}

function randomLoopFromPrng(prng: Prng, intensity: number): RandomLoopState {
  const t = clamp01(intensity);
  const beatDensity = 0.25 + t * 0.65;
  const stepDensity = 0.2 + t * 0.55;

  const buildMask = (steps: number, threshold: number, mustHaveFirst: boolean): number => {
    let mask = 0;
    for (let step = 0; step < steps; step += 1) {
      if (prng.next() < threshold) mask |= 1 << step;
    }
    if (mustHaveFirst) mask |= 1;
    return mask;
  };

  return {
    kickMask: buildMask(4, beatDensity, true),
    bassMask: buildMask(4, beatDensity, true),
    hatMask16: buildMask(16, stepDensity + 0.12, false),
    leadMask16: buildMask(16, stepDensity, false),
    pad: 0.25 + prng.next() * 0.95,
    bass: 0.4 + prng.next() * 0.9,
    kick: prng.next() < 0.1 ? 0 : 0.45 + prng.next() * 0.85,
    hat: prng.next() < 0.2 ? 0.35 : 0.7 + prng.next() * 0.7,
    lead: prng.next() < 0.18 ? 0.3 : 0.65 + prng.next() * 0.7,
    ambience: prng.next() < 0.2 ? 0 : 0.2 + prng.next() * 0.95,
    sparkle: prng.next() < 0.15 ? 0 : 0.25 + prng.next() * 1.0,
    bassScaleChance: 0.35 + t * 0.55,
    leadTranspose: (prng.next() < 0.5 ? 0 : 12) - (prng.next() < 0.18 ? 12 : 0),
    hatOpenChance: 0.08 + prng.next() * 0.24,
  };
}

function maskHasBeat(mask: number, beatInBar: number): boolean {
  return (mask & (1 << (beatInBar & 3))) !== 0;
}

function maskHasStep(mask: number, stepInBar: number): boolean {
  return (mask & (1 << (stepInBar & 15))) !== 0;
}

function shouldTriggerHat(
  stepInBar: number,
  style: ProceduralStyleProfile,
  randomLoop: RandomLoopState,
  pulse: number,
): boolean {
  if (style.hatPattern === "off" || pulse < 0.2) return false;
  if (!maskHasStep(randomLoop.hatMask16, stepInBar)) return false;

  switch (style.hatPattern) {
    case "eighths":
      return stepInBar % 2 === 0;
    case "sixteenths":
      return true;
    case "syncopated":
      return stepInBar % 4 === 2 || stepInBar % 8 === 7 || stepInBar === 3 || stepInBar === 11;
    default:
      return false;
  }
}

function isOpenHatStep(
  stepInBar: number,
  style: ProceduralStyleProfile,
  prng: Prng,
  randomLoop: RandomLoopState,
): boolean {
  if (style.hatPattern === "off") return false;
  if (stepInBar % 8 === 7) return true;
  return prng.next() < randomLoop.hatOpenChance * (style.hatPattern === "sixteenths" ? 1.25 : 0.8);
}

function shouldTriggerLead(
  stepInBar: number,
  style: ProceduralStyleProfile,
  randomLoop: RandomLoopState,
  intensity: number,
): boolean {
  if (style.leadMode === "off" || intensity < 0.18) return false;
  if (!maskHasStep(randomLoop.leadMask16, stepInBar)) return false;

  switch (style.leadMode) {
    case "sparse":
      return stepInBar % 4 === 0 || stepInBar === 10;
    case "arp":
      return stepInBar % 2 === 0;
    case "hook":
      return stepInBar === 0 || stepInBar === 3 || stepInBar === 6 || stepInBar === 8 || stepInBar === 11 || stepInBar === 14;
    case "stabs":
      return stepInBar === 2 || stepInBar === 6 || stepInBar === 10 || stepInBar === 14;
    default:
      return false;
  }
}

function pickLeadMidi(args: {
  palette: MoodPalette;
  chordPitches: readonly number[];
  style: ProceduralStyleProfile;
  stepInBar: number;
  prng: Prng;
}): number {
  const { palette, chordPitches, style, stepInBar, prng } = args;
  const chord = chordPitches.length > 0 ? chordPitches : [palette.tonicMidi, palette.tonicMidi + 4, palette.tonicMidi + 7];
  const top = chord[chord.length - 1] ?? palette.tonicMidi + 7;
  const root = chord[0] ?? palette.tonicMidi;
  const third = chord[1] ?? root + 4;
  const fifth = chord[2] ?? root + 7;

  switch (style.leadMode) {
    case "arp": {
      const arp = [root + 12, third + 12, fifth + 12, top + 12];
      return arp[stepInBar % arp.length] ?? top + 12;
    }
    case "hook": {
      const motif = [top + 12, fifth + 12, third + 12, fifth + 12, root + 24, fifth + 12];
      return motif[(stepInBar / 2) | 0] ?? top + 12;
    }
    case "stabs": {
      const choices = [root + 12, third + 12, fifth + 12, top + 12];
      return choices[prng.nextInt(choices.length)] ?? root + 12;
    }
    case "sparse":
    default:
      return (prng.next() < 0.5 ? top : fifth) + 12;
  }
}

function pickRandomScaleBassMidi(args: {
  palette: MoodPalette;
  chordPitches: readonly number[];
  rootMidi: number;
  prevBass: number | null;
  prng: Prng;
}): number {
  const { palette, chordPitches, rootMidi, prevBass, prng } = args;
  const intervals = MODE_INTERVALS[palette.mode];
  const tonicPc = mod12(palette.tonicMidi);
  const scalePcs = new Set(intervals.map((i) => mod12(tonicPc + i)));
  const chordPcs = new Set(chordPitches.map((p) => mod12(p)));
  const rootPc = mod12(rootMidi);

  const candidates: number[] = [];
  for (let n = 36; n <= 48; n += 1) {
    if (scalePcs.has(mod12(n))) candidates.push(n);
  }
  if (candidates.length === 0) return fitBassRangeNear(rootMidi, prevBass);

  const weights = candidates.map((n) => {
    const pc = mod12(n);
    const chordWeight = chordPcs.has(pc) ? 3 : 1;
    const rootWeight = pc === rootPc ? 2 : 1;
    const nearWeight = 1 / (1 + Math.abs(n - (prevBass ?? 42)) * 0.15);
    return chordWeight * rootWeight * nearWeight;
  });

  const total = weights.reduce((s, w) => s + w, 0);
  let pick = prng.next() * total;
  for (let i = 0; i < candidates.length; i += 1) {
    pick -= weights[i] ?? 0;
    if (pick <= 0) return candidates[i] ?? 42;
  }
  return candidates[0] ?? 42;
}

function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

function randomSessionSeed(mood: BeatlyMood, sampleRate: number, style: ProceduralStyleId): number {
  const nonce = Date.now() ^ Math.floor(Math.random() * 0xffff_ffff);
  return defaultSessionSeed(`${mood}|${style}|${nonce}`, 0, sampleRate);
}

const EMPTY_SET: ReadonlySet<number> = new Set();
const BEATS_1_3: ReadonlySet<number> = new Set([0, 2]);
const BEATS_ALL: ReadonlySet<number> = new Set([0, 1, 2, 3]);
const BEATS_1_2_3_4: ReadonlySet<number> = new Set([0, 1, 2, 3]);
const BEATS_1_2_4: ReadonlySet<number> = new Set([0, 1, 3]);
const BEATS_2_4: ReadonlySet<number> = new Set([1, 3]);
const BEATS_1_ONLY: ReadonlySet<number> = new Set([0]);
const BEATS_1_AND_4: ReadonlySet<number> = new Set([0, 3]);
const BEATS_1_3_AND_4: ReadonlySet<number> = new Set([0, 2, 3]);
const BEATS_OFFBEAT: ReadonlySet<number> = new Set([1, 3]);

interface RhythmPattern {
  kickBeats: ReadonlySet<number>;
  bassBeats: ReadonlySet<number>;
}

function rhythmPatternFor(
  mood: BeatlyMood,
  pulse: number,
  style: ProceduralStyleProfile,
): RhythmPattern {
  if (style.kickMode === "off") {
    return { kickBeats: EMPTY_SET, bassBeats: bassBeatsForStyle(style, pulse) };
  }

  const moodKick = pulse < 0.2
    ? EMPTY_SET
    : mood === "flow" || mood === "uplift"
      ? BEATS_ALL
      : BEATS_1_3;

  const kickBeats = (() => {
    switch (style.kickMode) {
      case "sparse":
        return pulse > 0.45 ? BEATS_1_3 : BEATS_1_ONLY;
      case "backbeat":
        return pulse > 0.55 ? BEATS_1_3_AND_4 : BEATS_2_4;
      case "four":
        return pulse > 0.18 ? BEATS_ALL : BEATS_1_3;
      case "broken":
        return pulse > 0.45 ? BEATS_1_AND_4 : BEATS_1_3;
      default:
        return moodKick;
    }
  })();

  return { kickBeats, bassBeats: bassBeatsForStyle(style, pulse) };
}

function bassBeatsForStyle(style: ProceduralStyleProfile, pulse: number): ReadonlySet<number> {
  switch (style.bassMode) {
    case "pedal":
      return BEATS_1_ONLY;
    case "root":
      return pulse > 0.45 ? BEATS_1_3 : BEATS_1_ONLY;
    case "walk":
    case "pulse":
    case "octave":
      return BEATS_1_2_3_4;
    case "offbeat":
      return pulse > 0.45 ? BEATS_OFFBEAT : BEATS_1_3;
    default:
      return BEATS_1_3;
  }
}

function bassPatternMidiFor(args: {
  mood: BeatlyMood;
  style: ProceduralStyleProfile;
  beatInBar: number;
  pulse: number;
  rootMidi: number;
  chordPitches: readonly number[];
  prevBass: number | null;
}): number {
  const { mood, style, beatInBar, pulse, rootMidi, chordPitches, prevBass } = args;

  const third = chordPitches[1] ?? rootMidi + 4;
  const fifth = chordPitches[2] ?? rootMidi + 7;
  const seventh = chordPitches[chordPitches.length - 1] ?? rootMidi + 10;

  switch (style.bassMode) {
    case "pedal":
      return fitBassRangeNear(rootMidi, prevBass);
    case "root":
      return beatInBar >= 2 ? fitBassRangeNear(rootMidi + 12, prevBass) : fitBassRangeNear(rootMidi, prevBass);
    case "octave":
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(rootMidi + 12, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(rootMidi + 7, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
    case "pulse":
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(fifth, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(rootMidi + 12, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
    case "offbeat":
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(rootMidi + 12, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
    case "walk":
      if (beatInBar === 0) return fitBassRangeNear(rootMidi, prevBass);
      if (beatInBar === 1) return fitBassRangeNear(third, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(fifth, prevBass);
      return pulse > 0.35 ? fitBassRangeNear(seventh, prevBass) : fitBassRangeNear(rootMidi, prevBass);
  }

  switch (mood) {
    case "calming":
      if (beatInBar === 0) return fitBassRangeNear(rootMidi, prevBass);
      if (beatInBar === 1) return fitBassRangeNear(third, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(fifth, prevBass);
      return pulse > 0.45 ? fitBassRangeNear(seventh, prevBass) : fitBassRangeNear(rootMidi, prevBass);
    case "deep-focus":
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(rootMidi + 7, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(rootMidi + 12, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
    case "flow":
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(rootMidi + 12, prevBass);
      if (beatInBar === 2) return fitBassRangeNear(rootMidi + 7, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
    case "uplift":
      if (beatInBar === 1 || beatInBar === 3) return fitBassRangeNear(rootMidi + 7, prevBass);
      return fitBassRangeNear(rootMidi, prevBass);
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

function chordBarsFor(
  mood: BeatlyMood,
  intensity: number,
  style: ProceduralStyleProfile,
): number {
  const t = clamp01(intensity);
  const base = t < 0.78 ? DEFAULT_CHORD_BARS : mood === "flow" || mood === "uplift" || mood === "deep-focus" ? 1 : DEFAULT_CHORD_BARS;
  return clampInt(base + style.chordBarsBias, 1, 4);
}

function padRetriggerChance(
  mood: BeatlyMood,
  intensity: number,
  style: ProceduralStyleProfile,
): number {
  const t = clamp01(intensity);
  const base = (() => {
    switch (mood) {
      case "calming":
        return 0.18 + t * 0.12;
      case "deep-focus":
        return 0.22 + t * 0.2;
      case "flow":
        return 0.3 + t * 0.24;
      case "uplift":
        return 0.34 + t * 0.22;
      case "neutral":
      default:
        return 0.22 + t * 0.16;
    }
  })();
  return clamp01(base + style.retriggerBias);
}

const MASTER_HEADROOM = 0.5;
const CEILING = 0.98;

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 0;
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function clampInt(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, Math.round(v)));
}

function softClip(x: number): number {
  const DRIVE = 1.1;
  const NORM = 0.800499;
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
  HatVoice,
  KickVoice,
  LeadVoice,
  PadBus,
  Sidechain,
  SparkleVoice,
  TempoClock,
};
