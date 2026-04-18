import type { BeatlyMood } from "./adapters.js";

export interface ProceduralRenderOptions {
  readonly mood: BeatlyMood;
  /** 0..1 */
  readonly intensity: number;
  readonly durationSeconds: number;
  readonly sampleRate?: number;
}

interface MoodProfile {
  readonly tempoBpm: number;
  readonly rootHz: number;
  readonly scale: readonly number[];
  readonly padWave: Waveform;
  readonly leadWave: Waveform;
}

type Waveform = "sine" | "triangle" | "saw";

const MOOD_PROFILES: Record<BeatlyMood, MoodProfile> = {
  calming: {
    tempoBpm: 72,
    rootHz: 174.61, // F3
    scale: [0, 3, 5, 7, 10],
    padWave: "sine",
    leadWave: "triangle",
  },
  "deep-focus": {
    tempoBpm: 86,
    rootHz: 164.81, // E3
    scale: [0, 2, 3, 5, 7, 10],
    padWave: "triangle",
    leadWave: "sine",
  },
  flow: {
    tempoBpm: 102,
    rootHz: 146.83, // D3
    scale: [0, 2, 4, 5, 7, 9, 11],
    padWave: "triangle",
    leadWave: "saw",
  },
  uplift: {
    tempoBpm: 124,
    rootHz: 130.81, // C3
    scale: [0, 2, 4, 7, 9, 11],
    padWave: "saw",
    leadWave: "triangle",
  },
  neutral: {
    tempoBpm: 96,
    rootHz: 146.83,
    scale: [0, 2, 4, 5, 7, 9, 11],
    padWave: "triangle",
    leadWave: "triangle",
  },
};

/**
 * Renders a mono PCM buffer in the range [-1, 1].
 * This is a lightweight procedural demo engine for rapid prototyping.
 */
export function renderProceduralPcm(options: ProceduralRenderOptions): Float32Array {
  const profile = MOOD_PROFILES[options.mood];
  const sampleRate = options.sampleRate ?? 44_100;
  const intensity = clamp01(options.intensity);
  const durationSeconds = Math.max(0.5, options.durationSeconds);

  const totalFrames = Math.floor(durationSeconds * sampleRate);
  const pcm = new Float32Array(totalFrames);

  const secondsPerBeat = 60 / profile.tempoBpm;
  const progression = [0, 5, 3, 4] as const;

  for (let i = 0; i < totalFrames; i += 1) {
    const t = i / sampleRate;
    const beat = t / secondsPerBeat;
    const beatInBar = beat % 4;
    const barIndex = Math.floor(beat / 4) % progression.length;

    const chordDegree = progression[barIndex] ?? 0;
    const chordRootHz = semitone(profile.rootHz, profile.scale[chordDegree % profile.scale.length] ?? 0);

    const pad =
      osc(profile.padWave, chordRootHz, t) * 0.24 +
      osc(profile.padWave, chordRootHz * 1.5, t) * 0.1 +
      osc(profile.padWave, chordRootHz * 2, t) * 0.07;

    const arpStep = Math.floor(beat * 2) % profile.scale.length;
    const leadHz = semitone(chordRootHz, profile.scale[arpStep] ?? 0);
    const leadEnvelope = 1 - ((beat * 2) % 1);
    const lead = osc(profile.leadWave, leadHz, t) * (0.18 + intensity * 0.22) * leadEnvelope;

    const kickEnvelope = Math.exp(-10 * (beatInBar % 1));
    const kick = osc("sine", 48 + intensity * 20, t) * kickEnvelope * (0.08 + intensity * 0.22);

    const shimmer = (Math.random() * 2 - 1) * 0.012 * (0.2 + intensity * 0.8);

    const value = (pad * (0.7 - intensity * 0.1) + lead + kick + shimmer) * 0.88;
    pcm[i] = clampAudio(value);
  }

  return pcm;
}

/**
 * Encodes mono Float32 PCM to 16-bit PCM WAV.
 */
export function encodeWavPcm16Mono(samples: Float32Array, sampleRate = 44_100): Uint8Array {
  const headerSize = 44;
  const dataSize = samples.length * 2;
  const fileSize = headerSize + dataSize;

  const buffer = new ArrayBuffer(fileSize);
  const view = new DataView(buffer);

  writeAscii(view, 0, "RIFF");
  view.setUint32(4, fileSize - 8, true);
  writeAscii(view, 8, "WAVE");

  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample

  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (const sample of samples) {
    const normalized = clampAudio(sample);
    const int16 = normalized < 0 ? Math.round(normalized * 0x8000) : Math.round(normalized * 0x7fff);
    view.setInt16(offset, int16, true);
    offset += 2;
  }

  return new Uint8Array(buffer);
}

/**
 * Convenience API: procedural render + WAV encoding in one call.
 */
export function renderProceduralWav(options: ProceduralRenderOptions): Uint8Array {
  const sampleRate = options.sampleRate ?? 44_100;
  const pcm = renderProceduralPcm({ ...options, sampleRate });
  return encodeWavPcm16Mono(pcm, sampleRate);
}

function osc(wave: Waveform, hz: number, t: number): number {
  const phase = (t * hz) % 1;

  switch (wave) {
    case "sine":
      return Math.sin(2 * Math.PI * phase);
    case "triangle":
      return 2 * Math.abs(2 * phase - 1) - 1;
    case "saw":
      return 2 * phase - 1;
    default:
      return 0;
  }
}

function semitone(freq: number, offset: number): number {
  return freq * 2 ** (offset / 12);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) {
    return 0;
  }

  return Math.max(0, Math.min(1, value));
}

function clampAudio(value: number): number {
  return Math.max(-1, Math.min(1, value));
}
