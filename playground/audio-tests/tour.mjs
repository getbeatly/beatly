#!/usr/bin/env node
/**
 * Render a continuous tour WAV: 20s in each mood (same engine, so reverb
 * tails bleed across transitions) + a 20s intensity sweep in `flow`.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import {
  createProceduralEngine,
  encodeWavPcm16Stereo,
} from "../../dist/procedural/index.js";

const OUT_DIR = new URL("./out/", import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const SECONDS_PER_MOOD = 20;
const SWEEP_SECONDS = 20;
const SEED = 0xBEA71;

const MOODS = ["calming", "deep-focus", "flow", "uplift", "neutral"];

const engine = createProceduralEngine({
  mood: MOODS[0],
  sampleRate: SAMPLE_RATE,
  seed: SEED,
  intensity: 0.5,
});

const stages = [];
for (const mood of MOODS) {
  stages.push({
    label: `mood=${mood}`,
    seconds: SECONDS_PER_MOOD,
    apply: () => engine.setMood(mood),
  });
}
stages.push({
  label: "intensity sweep 0.1→0.95 (flow)",
  seconds: SWEEP_SECONDS,
  apply: () => {
    engine.setMood("flow");
    engine.setIntensity(0.1, 300);
  },
  onEachSecond: (t, total) =>
    engine.setIntensity(0.1 + 0.85 * (t / total), 700),
});

const totalSeconds = stages.reduce((s, st) => s + st.seconds, 0);
const output = new Float32Array(totalSeconds * SAMPLE_RATE * CHANNELS);

const t0 = performance.now();
let frameCursor = 0;
for (const stage of stages) {
  console.log(`→ ${stage.label}  (${stage.seconds}s)`);
  stage.apply?.();
  const chunkFrames = SAMPLE_RATE;
  for (let sec = 0; sec < stage.seconds; sec += 1) {
    stage.onEachSecond?.(sec, stage.seconds);
    const view = output.subarray(frameCursor * CHANNELS, (frameCursor + chunkFrames) * CHANNELS);
    engine.renderInto(view, chunkFrames, CHANNELS);
    frameCursor += chunkFrames;
  }
}
const ms = performance.now() - t0;

const wav = encodeWavPcm16Stereo(output, SAMPLE_RATE);
const outPath = new URL("tour.wav", OUT_DIR);
writeFileSync(outPath, wav);

const rt = (totalSeconds * 1000) / ms;
console.log(`\n📁 ${outPath.pathname}`);
console.log(`   ${totalSeconds}s rendered in ${ms.toFixed(0)} ms → ${rt.toFixed(1)}× realtime`);
console.log(`\nPlay it:  ffplay -nodisp -autoexit ${outPath.pathname}`);
