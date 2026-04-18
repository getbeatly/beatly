#!/usr/bin/env node
/**
 * Render one 12-second WAV per mood at default intensity.
 * Also spot-checks the invariants we care about (no NaN, no clipping,
 * determinism, audible level).
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { renderProceduralPcm, renderProceduralWav } from "../../dist/procedural/index.js";

const OUT_DIR = new URL("./out/", import.meta.url);
mkdirSync(OUT_DIR, { recursive: true });

const MOODS = ["calming", "deep-focus", "flow", "uplift", "neutral"];
const DURATION = 12;
const SEED = 0xBEA71;

let fail = 0;
const check = (label, cond, detail = "") => {
  console.log(`   ${cond ? "✅" : "❌"} ${label}${detail ? "  " + detail : ""}`);
  if (!cond) fail += 1;
};

for (const mood of MOODS) {
  const t0 = performance.now();
  const wav = renderProceduralWav({ mood, durationSeconds: DURATION, seed: SEED });
  const ms = performance.now() - t0;
  const path = new URL(`${mood}.wav`, OUT_DIR);
  writeFileSync(path, wav);

  const { samples, channels, sampleRate } = renderProceduralPcm({
    mood,
    durationSeconds: 1,
    seed: SEED,
  });
  const anyNaN = samples.some((s) => Number.isNaN(s));
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }

  const a = renderProceduralPcm({ mood, durationSeconds: 0.2, seed: SEED }).samples;
  const b = renderProceduralPcm({ mood, durationSeconds: 0.2, seed: SEED }).samples;
  let bitIdentical = a.length === b.length;
  if (bitIdentical) for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) { bitIdentical = false; break; }

  const rt = (DURATION * 1000) / ms;
  console.log(`\n${mood}  (${sampleRate} Hz, ${channels}ch, ${DURATION}s in ${ms.toFixed(0)} ms → ${rt.toFixed(1)}× realtime)`);
  check("no NaN", !anyNaN);
  check("peak ≤ 1.0", peak <= 1.0, `peak=${peak.toFixed(3)}`);
  check("peak ≥ 0.1 (audible)", peak >= 0.1, `peak=${peak.toFixed(3)}`);
  check("deterministic under same seed", bitIdentical);
  console.log(`   📁 ${path.pathname}`);
}

if (fail > 0) { console.error(`\n${fail} checks failed`); process.exit(1); }
console.log("\nAll renders passed invariant checks.");
