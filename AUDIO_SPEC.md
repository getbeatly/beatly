# Beatly Procedural Audio Specification (v0.2)

> Scope: the procedural runtime only (`@beatly/core/procedural` and
> `playground/procedural-server.mjs`). Stem-mixer and AI runtimes are out of
> scope for this document.
>
> Goal: go from the current "demo synth" quality to a soundscape that is
> genuinely pleasant to leave running for hours while coding. This spec is
> prescriptive enough to implement directly, while leaving room for tasteful
> choices inside each layer.
>
> Non-goal: beating a DAW. Everything here must run in pure JS/TS on Node,
> deterministically, with sub-frame CPU cost per sample.

---

## 1. Design principles

1. **Music first, synthesis second.** Real chord voicings with voice leading
   matter more than fancy oscillators. A sine-wave trio playing good harmony
   beats a detuned supersaw playing the wrong note.
2. **Slow is beautiful.** Long attacks, long releases, long reverb tails,
   slow LFOs. Nothing should change abruptly unless it's a deliberate accent.
3. **Stereo by default.** Mono is the single biggest reason procedural audio
   sounds small. Every voice has a defined stereo placement.
4. **Seeded determinism.** Every stochastic decision (note choice, humanization,
   shimmer grain) pulls from a seeded PRNG. Same seed + same command history
   ⇒ bit-identical output.
5. **Bar-quantized changes.** Chord, section, and mood transitions land on bar
   boundaries; continuous params (filter, volume, reverb) ramp smoothly.
6. **Macro controls orchestrate, not just attenuate.** `intensity` adds and
   removes layers; it does not merely turn a volume knob.
7. **No clicks, ever.** All state changes go through one-pole smoothers or
   are scheduled at note boundaries.

---

## 2. Runtime model

### 2.1 Signal flow

```text
 ┌─ PadVoice (×3 chord tones)  ─┐
 ├─ BassVoice                   │
 ├─ LeadVoice (mono/legato)     ├─► per-voice HPF/LPF, pan, sends ──┐
 ├─ PercBus (kick, hat, perc)   │                                    │
 └─ ShimmerBus (granular noise) ┘                                    │
                                                                     ▼
                                             ┌──── Reverb (FDN-8) ──┐
                                             ├──── Delay (ping-pong)┤
                                             └──────────┬───────────┘
                                                        ▼
                                       Master: sidechain duck ← kick
                                             → tilt EQ → soft-clip → out (stereo)
```

### 2.2 Block size & rates

- Sample rate: **48 000 Hz** (upgrade from 44.1k — cheaper math for some
  filters, and matches browser `AudioContext` defaults). Configurable.
- Audio block: **128 frames** internal. Server streams 100 ms chunks
  (4 800 frames) built from 37–38 internal blocks.
- Control rate: per-block (128 frames ≈ 2.67 ms). All parameter smoothers,
  LFOs, and envelope stages update at block rate. Oscillators and filters
  run at sample rate.

### 2.3 Determinism

- Single entrypoint PRNG: **Mulberry32**, seeded from a session seed.
- Derive per-layer streams by hashing `(seed, layerName)` → new seed.
  Required streams: `melody`, `humanize`, `shimmer`, `form`, `perc`.
- `Math.random()` is banned inside the DSP path.

---

## 3. Musical model

### 3.1 Mood palettes

Each mood defines a palette, not a single preset. Every field is required.

| Mood         | Tonic | Mode        | Tempo (BPM) | Progression palette (weights)                                                | Form template |
|--------------|-------|-------------|-------------|------------------------------------------------------------------------------|---------------|
| `calming`    | F3    | Lydian      | 64–76       | `I–iii–IV–I` (3), `I–V/vi–vi–IV` (2), `I–ii–I–V` (1)                          | AAAB          |
| `deep-focus` | E3    | Dorian      | 80–92       | `i–VII–VI–VII` (3), `i–iv–VII–III` (2), `i–v–i–VII` (1)                       | ABAB          |
| `flow`       | D3    | Mixolydian  | 96–108      | `I–bVII–IV–I` (3), `I–vi–ii–V` (2), `I–iii–IV–V` (1)                          | ABAC          |
| `uplift`     | C3    | Ionian+add9 | 118–132     | `I–V–vi–IV` (3), `vi–IV–I–V` (2), `I–iii–IV–V` (1)                            | AABB          |
| `neutral`    | D3    | Aeolian     | 88–100      | `i–VI–III–VII` (3), `i–iv–v–i` (2)                                            | AABA          |

Rules:

- Tempo within a session drifts slowly (±2 BPM over 32 bars) via a smoothed
  random walk from the `form` PRNG stream.
- Progression is chosen once per 8-bar section using weighted random from
  the palette. The same progression may not repeat twice in a row.
- Each chord lasts 2 bars by default; sections may compress to 1 bar/chord
  at `intensity ≥ 0.75`.

### 3.2 Chord voicings & voice leading

- Each chord is resolved to a set of 3 pitches in MIDI note numbers inside
  a fixed **voicing window**: root octave 60–72 (C4–C5).
- Root position is computed, then inversions are chosen to **minimize total
  voice motion** from the previous chord's voicing (sum of |Δsemitone|).
  Ties broken by preferring the inversion whose top voice moves by step.
- Extensions:
  - `calming`: add maj9 to I and IV (drop the 5 if 9 is present).
  - `deep-focus`: add m7 to i, iv; add sus2 to VII.
  - `flow`: add 7 to all chords.
  - `uplift`: add add9 to I and vi.
  - `neutral`: triads only.
- Bass plays the **chord root** at MIDI 36–48 (C2–C3), chosen as the octave
  closest to the previous bass note.

### 3.3 Melodic generator

Produces lead notes for each 16th-note grid position.

- Input: current chord tones, current scale, previous note.
- Note-choice weights:
  - Chord tone: 0.55
  - Scale tone (non-chord): 0.30
  - Rest: 0.15 (increased to 0.35 at phrase ends)
- Contour bias: prefer intervals ≤ perfect 4th; penalize direction repeats
  beyond 3 consecutive steps (forces turnarounds).
- Phrasing: 4-bar phrases with a mandatory rest on beat 4 of bar 4. Every
  8th phrase transposes up one scale degree (question/answer feel).
- Rhythmic density is a function of `intensity`:
  - `< 0.33`: 8ths, gate 60%, 40% rest probability per step
  - `0.33–0.66`: mixed 8ths/16ths, 20% rest
  - `> 0.66`: 16ths, 10% rest, occasional triplet bar (every 8th bar)

### 3.4 Percussion

- **Kick**: on beats 1 and 3 (calming, deep-focus); 1/2/3/4 (flow, uplift);
  omitted entirely at `intensity < 0.25`.
- **Hat**: closed 8ths at `intensity ≥ 0.4`, with every 4th hat replaced by
  a rest (for groove) and every 16th hat replaced by an open hat.
- **Perc**: sparse bar-accent hits (side-stick-like) at `pulse ≥ 0.6`, on
  beat 4 of odd bars, ±10 ms humanization.

### 3.5 Humanization & swing

- Swing: `8thOffset = (1 + swingAmount) * baseInterval` on every offbeat.
  `swingAmount` ∈ [0, 0.18]; defaults: calming 0.12, deep-focus 0.10,
  flow 0.15, uplift 0.06, neutral 0.08.
- Timing jitter: ±4 ms on lead, ±2 ms on hat, 0 on kick, from `humanize`
  stream.
- Velocity jitter: ±8% on lead/hat, ±3% on kick.

### 3.6 Form & sections

A section is 16 bars. Sections labelled A or B follow the mood's form
template (e.g. `ABAB`). Between sections, a 1-bar **transition** is inserted:

- `A→B`: reverse-noise swell (4 s tail shortened to 1 bar) + filter open.
- `B→A`: cymbal-like noise burst on beat 1 with 800 ms decay.
- `*→*` with mood change: 2-bar transition, old voices release, new voices
  attack.

Chord changes only happen on bar boundaries. Mood/macro commands received
mid-bar are queued until the next bar line; continuous params (filter, pan,
reverb) ramp immediately.

---

## 4. Voice & FX synthesis recipes

All envelopes are ADSR in ms unless noted. All frequencies in Hz. Filter
cutoffs in Hz unless noted.

### 4.1 Pad voice (×3, one per chord tone)

- Oscillator bank per voice: 2 detuned saw + 1 sub sine one octave down.
  - Saws: ±7 cents, **polyBLEP** bandlimited.
  - Optionally replace saws with 6-partial additive (partials 1, 2, 3, 4,
    5, 7 with amplitudes 1, 0.5, 0.33, 0.18, 0.12, 0.07) when
    `warmth ≥ 0.6` — this produces the "bowed glass" character.
- Per-partial slow amp LFO: rate 0.07–0.19 Hz (randomized per partial),
  depth ±12%. Gives the pad visible "breathing".
- Filter: 12 dB/oct state-variable LPF.
  - Base cutoff: 600 + 2400 * `warmth` Hz.
  - LFO on cutoff: rate = tempo/8 (one cycle per 2 bars), depth ±30%.
  - Envelope on cutoff: attack 1 500 ms, sustain at base.
- Amp ADSR: A 1200 / D 400 / S 0.85 / R 2500 ms.
- Pan: voice 0 → −0.35, voice 1 → 0.0, voice 2 → +0.35.
- Haas: voice 0 and 2 delayed 7 ms (opposite channel) to widen.
- Sends: reverb 0.55, delay 0.15.

### 4.2 Bass voice

- 1 sine + 1 triangle one octave up at 0.35 amplitude.
- Filter: 24 dB/oct LPF, cutoff 160 + 120 * `warmth` Hz, no resonance.
- ADSR: A 8 / D 120 / S 0.7 / R 180 ms. Legato ties when next note
  starts before release completes.
- HPF @ 40 Hz to keep sub controlled.
- Pan: centered.
- Sends: reverb 0.10, delay 0.0.

### 4.3 Lead voice (mono, legato)

- Karplus–Strong plucked string, feedback 0.992, lowpass in feedback
  loop at 3500 + 4000 * `sparkle` Hz.
- Alternative when `sparkle < 0.25`: single triangle with soft-clip
  (gentler, flutier).
- ADSR on amp: A 3 / D 180 / S 0.25 / R 400 ms (re-triggered per note
  unless legato tie — in which case only pitch updates, no retrigger).
- Portamento 35 ms on tied notes.
- Pan: +0.15 (slightly right, to separate from kick/bass).
- Sends: reverb 0.45, delay 0.55 (ping-pong).

### 4.4 Kick

- Sine oscillator with pitch envelope 110 Hz → 45 Hz over 80 ms (exp).
- Amp env: A 1 / D 220 ms, no sustain.
- Soft-clip at output (tanh × 1.2) for thump.
- HPF @ 30 Hz.
- Pan: centered. Sends: reverb 0.08, delay 0.

### 4.5 Hat

- Filtered white noise (from `perc` stream) → HPF @ 7 kHz, BPF centered
  at 9 kHz (Q 2).
- Closed hat env: A 1 / D 45 ms. Open hat env: A 1 / D 220 ms.
- Pan: ±0.25 alternating.
- Sends: reverb 0.20, delay 0.10.

### 4.6 Shimmer bus

- Granular: every 60–180 ms (Poisson from `shimmer` stream), emit a grain:
  - Sine at a random chord-tone × {2, 3, 4, 5, 6} (weighted toward lower
    multiples).
  - Hann-windowed, 200–900 ms duration.
  - Amplitude 0.04–0.09 * `sparkle`.
  - Pan: uniform random in [−0.9, 0.9].
- Sends: reverb 0.9, delay 0.3.

### 4.7 Transition FX

- **Reverse swell**: pre-rendered 1-bar buffer of filtered noise with
  exponential fade-in; LPF sweeps 200 Hz → 8 kHz over the bar.
- **Cymbal burst**: bandpassed noise, 800 ms exp decay, stereo-widened.

---

## 5. Global FX chain

### 5.1 Reverb — FDN-8

- 8-line feedback delay network.
- Delay lengths (ms, co-prime-ish): 23, 29, 41, 53, 67, 79, 97, 113.
- Feedback matrix: Householder (`I − (2/N)·11ᵀ`), lossless; scale by
  global decay coefficient.
- Decay coefficient: `g = 10^(-3 * meanDelay / rt60)`, `rt60 = 1.5 + 5.5 *
  space` seconds.
- One-pole LPF inside each line, cutoff = 3500 + 3500 * (1 − space) Hz
  (more damping when `space` is low — gives darker rooms).
- Pre-delay: 20 + 40 * `space` ms.
- Stereo output: sum lines 0–3 to L, 4–7 to R.
- Wet mix: 0.25 + 0.35 * `space` (clamped 0..0.55).

### 5.2 Delay — ping-pong

- Two delay lines (L→R, R→L).
- Time: quarter-note synced, optionally dotted-eighth at `flow`/`uplift`.
- Feedback: 0.35 + 0.35 * `space`, capped 0.7.
- HPF @ 250 Hz and LPF @ 4500 Hz inside the feedback path (prevents mud
  and ice-pick buildup).

### 5.3 Sidechain duck

- Envelope follower fed from the kick (pre-FX), attack 5 ms, release 180
  ms. Applied as gain reduction to pad, lead, and shimmer buses. Depth
  3 + 4 * `pulse` dB.

### 5.4 Master chain

Order: **tilt EQ → soft-clip → limiter → output**.

- Tilt EQ: single pivot at 1 kHz; gain `±(2 * warmth − 1) * 3 dB` (low
  shelf up, high shelf down when warmth > 0.5, inverse when < 0.5).
- Soft-clip: `tanh(x * drive) / tanh(drive)`, `drive = 1.1`.
- Limiter: lookahead 5 ms, threshold −1 dBFS, release 120 ms.
- Target loudness: **−16 LUFS integrated** (documented target; not
  required to meter at runtime).

---

## 6. Macro parameter mapping

`intensity`, `warmth`, `sparkle`, `pulse`, `space` ∈ [0, 1].

| Param       | Targets                                                                                                                                                              |
|-------------|----------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `intensity` | layer gating (see §6.1), melody density (§3.3), pad filter env depth, chord rate (2 → 1 bars), lead amp                                                              |
| `warmth`    | pad filter cutoff base, pad osc switch to additive (≥ 0.6), bass filter cutoff, master tilt EQ                                                                       |
| `sparkle`   | shimmer grain rate & amplitude, lead KS feedback LPF cutoff, hat presence, master tilt (high shelf)                                                                  |
| `pulse`     | kick amplitude, hat density, perc presence, sidechain depth                                                                                                          |
| `space`     | reverb RT60, reverb pre-delay, reverb damping, delay feedback, pad Haas amount                                                                                       |

### 6.1 Intensity → layer gating

| Range        | Active layers                                                          |
|--------------|------------------------------------------------------------------------|
| `0.00–0.20`  | pad only                                                               |
| `0.20–0.40`  | pad + bass + shimmer                                                   |
| `0.40–0.65`  | pad + bass + shimmer + lead (sparse) + kick                            |
| `0.65–0.85`  | above + hat                                                            |
| `0.85–1.00`  | above + perc + chord rate doubled                                      |

Layer entries/exits crossfade over 2 bars; they never hard-switch.

### 6.2 Parameter smoothing

- All macro params run through a one-pole smoother with time constant
  `τ = transitionMs / 4` (so 4·τ ≈ transition duration).
- Smoothers update at control rate.
- Exception: `mood` transitions are quantized — the incoming mood is
  queued; on the next bar boundary, new voicings/progression take over and
  a 2-bar crossfade occurs.

---

## 7. Engine API changes

### 7.1 `ProceduralRenderOptions` (additive)

```ts
interface ProceduralRenderOptions {
  mood: BeatlyMood;
  intensity: number;
  durationSeconds: number;
  sampleRate?: number;          // default 48_000
  seed?: number;                // default derived from mood+duration hash
  warmth?: number;              // default per-mood
  sparkle?: number;             // default per-mood
  pulse?: number;               // default per-mood
  space?: number;               // default per-mood
  stereo?: boolean;             // default true
}
```

### 7.2 PCM output

- When `stereo === true` (default): returns interleaved LR `Float32Array`
  of length `frames * 2`.
- New helper `encodeWavPcm16Stereo(samples, sampleRate)`.
- `renderProceduralWav` auto-selects mono/stereo encoder based on
  `options.stereo`.
- Existing `renderProceduralPcm` return type changes to
  `{ samples: Float32Array; channels: 1 | 2; sampleRate: number }` to
  avoid ambiguity. (Breaking — acceptable pre-1.0.)

### 7.3 Streaming server

- `SoundscapeControl` gains `seed` and bar-quantized mood scheduling.
- `/state` exposes: `seed`, current section (A/B), current chord index,
  bar position, tempo, and the smoothed macro values.
- `/command` accepts an optional `seed` field to reset the session seed.
- Chunk size stays 100 ms; synth uses 128-frame internal blocks.

---

## 8. Determinism contract

- Given identical `(seed, sampleRate, sequence of (timestamp, command))`
  the rendered PCM must be bit-identical across runs and platforms.
- Floating-point reproducibility caveat: we assume IEEE-754 double and
  standard `Math.sin`/`Math.exp`. We do not require cross-engine
  bit-identity — only determinism within a single V8 version.
- All PRNG streams must be re-seedable.

---

## 9. Acceptance criteria

A build satisfies this spec when all of the following hold:

1. **No aliasing above −60 dBFS** in a 200 Hz → 4 kHz sweep of the lead
   voice (verified with offline FFT).
2. **No clicks** on chord changes, mood changes, or transition boundaries
   (verified by looking for sample-rate-order discontinuities > 0.1
   between adjacent samples in the smoothed signal).
3. **Mood distinguishability**: blind A/B of any two mood presets held at
   default macros produces spectral-centroid differences > 200 Hz.
4. **Intensity sweep**: linear ramp from 0 → 1 over 32 bars produces
   monotonically increasing short-term RMS (checked every 2 bars) and
   adds layers at the §6.1 thresholds.
5. **Loudness**: integrated LUFS of a 60-second render at default macros
   is within [−18, −14] LUFS.
6. **Stereo width**: correlation coefficient of L/R at default `space`
   lies in [0.55, 0.85] (wide but mono-compatible).
7. **Determinism**: two renders with the same seed and options are
   byte-identical.
8. **CPU budget**: 60 s of stereo 48 kHz audio renders in ≤ 10 s on a
   modern laptop (Node 22, single thread). Roughly 6× realtime headroom.

A small test harness under `playground/audio-tests/` should automate 1,
2, 4, 5, 7, 8.

---

## 10. Implementation plan (suggested order)

1. **Scaffolding**: PRNG, block-rate control graph, stereo buffer type,
   WAV stereo encoder, smoothers, tempo/bar clock.
2. **Voicing engine**: chord resolver, voice-leading inversion picker,
   bass octave picker.
3. **Pad voice** (saw + polyBLEP + SVF LPF + ADSR + Haas) → you should
   already hear a massive upgrade just from this.
4. **FDN-8 reverb** + master soft-clip + stereo out.
5. **Bass + kick + sidechain duck**.
6. **Melodic generator + Karplus–Strong lead + ping-pong delay**.
7. **Hat + perc + swing/humanization**.
8. **Shimmer granular bus**.
9. **Form scheduler** (A/B sections, transitions, bar-quantized mood
   changes).
10. **Additive pad mode**, tilt EQ, limiter.
11. **Test harness** for §9 acceptance checks.

Each step is independently auditionable via `renderProceduralWav` — the
agent should commit a reference WAV after every step so regressions are
caught by ear as well as by tests.

---

## 11. Out of scope / future

- MIDI export.
- User-defined chord progressions.
- Sample-based layers (piano, guitar).
- Live tempo-sync to external clock.
- Per-voice effects beyond sends (chorus, phaser).
- GPU-accelerated convolution reverb.

These are worth discussing for v0.3.
