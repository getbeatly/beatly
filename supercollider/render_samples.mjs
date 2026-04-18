// Render one ~60s sample per genre via scsynth -N (non-realtime), then encode
// to mp3 via ffmpeg so the result is small enough to ship on the website.
//
// Usage:   node supercollider/render_samples.mjs [outDir] [seconds] [seed]
// Default: ../beatly.dev/public/samples, 60s, seed 1
//
// Strategy: reuse the same music.js generator + synthdef layout as server.js,
// but emit a binary OSC score file and let scsynth render it to disk.

import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import osc from "osc";

import { GENRES, makeGenerator } from "./music.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const SYNTHDEFS_DIR = join(__dirname, "synthdefs");

const [, , outArg, secondsArg, seedArg] = process.argv;
const OUT_DIR = resolve(outArg ?? join(repoRoot, "..", "beatly.dev", "public", "samples"));
const SECONDS = Number(secondsArg ?? 60);
const SEED = Number(seedArg ?? 1);

const SAMPLE_RATE = 48000;

// Keep group / node ids in sync with server.js so the synthdefs' default bus
// routing (voices → sends on 4 & 6, FX → out 0) still works.
const GROUP = { CLEAR: 50, FX: 200, MASTER: 300, VOICES: 100001 };
const FX_NODE = { REVERB: 90001, DELAY: 90002, MASTER: 90003 };

mkdirSync(OUT_DIR, { recursive: true });

const genreIds = Object.keys(GENRES);
console.log(`Rendering ${genreIds.length} genres → ${OUT_DIR}`);
console.log(`  ${SECONDS}s each, seed=${SEED}, sr=${SAMPLE_RATE}`);

const manifest = [];
for (const genreId of genreIds) {
  const variant = GENRES[genreId].defaultVariant;
  const profileId = `${genreId}.${variant}`;
  const wavFile = join(OUT_DIR, `${genreId}.wav`);
  const mp3File = join(OUT_DIR, `${genreId}.mp3`);
  console.log(`▶ ${profileId} → ${mp3File}`);
  const bpm = renderProfile(profileId, wavFile);
  encodeMp3(wavFile, mp3File);
  try { unlinkSync(wavFile); } catch {}
  manifest.push({ genre: genreId, variant, profileId, bpm, file: `${genreId}.mp3` });
}

writeFileSync(
  join(OUT_DIR, "manifest.json"),
  `${JSON.stringify({ seconds: SECONDS, seed: SEED, tracks: manifest }, null, 2)}\n`,
);

console.log(`✓ done (${manifest.length} tracks, manifest.json written)`);

function encodeMp3(wavFile, mp3File) {
  const result = spawnSync(
    "ffmpeg",
    ["-y", "-loglevel", "error", "-i", wavFile, "-codec:a", "libmp3lame", "-b:a", "128k", mp3File],
    { stdio: ["ignore", "inherit", "inherit"] },
  );
  if (result.status !== 0) {
    throw new Error(`ffmpeg failed (exit ${result.status}) for ${wavFile}`);
  }
}

function renderProfile(profileId, outFile) {
  const gen = makeGenerator(profileId, SEED);
  const profile = gen.profile;
  const beatSec = 60 / profile.bpm;
  const barSec = beatSec * 4;
  const numBars = Math.ceil(SECONDS / barSec);

  const bundles = [];
  const push = (timeSec, ...packets) => bundles.push({ time: timeSec, packets });

  // t=0: groups, synthdefs, bus clearer, FX chain with this profile's settings.
  const r = profile.reverb ?? { room: 0.85, damp: 0.4, mix: 0.7 };
  const d = profile.delay ?? { beats: 0.375, fb: 0.5, mix: 0.5 };
  push(
    0,
    { address: "/g_new", args: [GROUP.CLEAR, 1, 0] },
    { address: "/g_new", args: [GROUP.FX, 1, 0] },
    { address: "/g_new", args: [GROUP.MASTER, 1, 0] },
    { address: "/g_new", args: [GROUP.VOICES, 2, GROUP.FX] },
    { address: "/d_loadDir", args: [SYNTHDEFS_DIR] },
    { address: "/s_new", args: ["sysClear", -1, 0, GROUP.CLEAR] },
    {
      address: "/s_new",
      args: [
        "reverb", FX_NODE.REVERB, 0, GROUP.FX,
        "in", 4, "out", 0, "mix", 1.0,
        "room", r.room, "damp", r.damp,
      ],
    },
    {
      address: "/s_new",
      args: [
        "pingDelay", FX_NODE.DELAY, 1, GROUP.FX,
        "in", 6, "out", 0,
        "time", d.beats * beatSec, "fb", d.fb, "mix", d.mix,
      ],
    },
    { address: "/s_new", args: ["master", FX_NODE.MASTER, 0, GROUP.MASTER] },
    // Apply reverb mix explicitly (in case synthdef default differs).
    { address: "/n_set", args: [FX_NODE.REVERB, "mix", r.mix] },
  );

  // Schedule notes.
  let nodeId = 1000;
  const startPad = 0.5; // let FX warm up
  for (let b = 0; b < numBars; b++) {
    const { events } = gen.nextBar();
    const barStart = startPad + b * barSec;
    for (const ev of events) {
      const argList = [ev.def, ++nodeId, 0, GROUP.VOICES];
      for (const [k, v] of Object.entries(ev.args)) argList.push(k, Number(v));
      push(barStart + ev.time, { address: "/s_new", args: argList });
    }
  }

  // Tail for reverb / delay decay, then end marker.
  const totalSec = startPad + SECONDS + 3;
  push(totalSec, { address: "/c_set", args: [0, 0] });

  const scorePath = join(OUT_DIR, `.${profileId.replace(/\./g, "_")}.osc`);
  writeFileSync(scorePath, encodeScore(bundles));

  // scsynth NRT: -N <score> <in> <out> <sr> <header> <sample> [options]
  const result = spawnSync(
    "scsynth",
    [
      "-N", scorePath,
      "_", outFile,
      String(SAMPLE_RATE),
      "WAV", "int16",
      "-o", "2",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  // scsynth sometimes exits via a benign signal after flushing the WAV in NRT
  // mode; trust the output file instead of the exit code.
  if (!existsSync(outFile)) {
    process.stderr.write(result.stdout?.toString() ?? "");
    process.stderr.write(result.stderr?.toString() ?? "");
    throw new Error(`scsynth NRT failed for ${profileId} (exit=${result.status} signal=${result.signal})`);
  }
  if (existsSync(scorePath)) {
    try { unlinkSync(scorePath); } catch {}
  }
  return profile.bpm;
}

// Encode bundles into scsynth's NRT score file: a sequence of
// [int32 BE length][OSC bundle bytes].
function encodeScore(bundles) {
  // Sort by time just in case.
  bundles.sort((a, b) => a.time - b.time);

  const chunks = [];
  for (const { time, packets } of bundles) {
    // scsynth NRT expects the bundle time tag as literal seconds from score
    // start (NTP format, but no 1900-epoch offset). osc.timeTag() always adds
    // the current wall-clock NTP offset, so build the raw tag manually.
    const whole = Math.floor(Math.max(0, time));
    const frac = Math.floor((time - whole) * 0x100000000);
    const bundle = osc.writeBundle({
      timeTag: { raw: [whole, frac] },
      packets,
    });
    const buf = bundle instanceof Uint8Array ? Buffer.from(bundle) : Buffer.from(bundle.buffer ?? bundle);
    const len = Buffer.alloc(4);
    len.writeInt32BE(buf.length, 0);
    chunks.push(len, buf);
  }
  return Buffer.concat(chunks);
}
