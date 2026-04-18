# Beatly Procedural Audio Specification (v0.3)

> Scope: the procedural runtime only (`@beatly/core/procedural` and
> `playground/procedural-server.mjs`). Stem-mixer and AI runtimes are out
> of scope for this document.
>
> Goal: go from the current "demo synth" quality to a soundscape that is
> genuinely pleasant to leave running for hours while coding, and that
> can be extended to new genres/moods by editing a data file rather than
> writing code. This spec is prescriptive enough to implement directly
> while leaving room for tasteful choices inside each layer.
>
> Non-goal: beating a DAW. Everything here must run in pure JS/TS on
> Node, deterministically, with sub-frame CPU cost per sample.

---

## 0. Architecture overview

Beatly's procedural engine is built as **ten stacked layers**. Each
layer only depends on the layers above it; everything downstream
schedules against the layers upstream. The order is deliberate — it is
also the order that matters most for "feels musical not random":
**harmony → voice roles → profile → constrained randomization**.

```text
  1. Clock & timing            (BPM, grid, bar/beat counter, swing)
  2. Harmonic system           (scales, chords, progressions, voice leading)
  3. Melody engine             (motifs + transformations, contour, phrasing)
  4. Rhythm engine             (drum templates, Euclidean, fills, polyrhythm)
  5. Song form / arrangement   (sections, transitions, dynamic envelope)
  6. Voice roles               (bass, pads, lead, drums, ornaments/FX)
  7. Synthesis & timbre        (oscillators, filters, envs, LFOs, FX chain)
  8. Profile (genre/mood)      (data bundle of constraints over 1–7)
  9. Randomization layer       (seeded RNG, weighted tables, Markov,
                                constraint solver)
 10. Scheduler & audio output  (look-ahead queue, mixer, master bus)
```

**Design stance.** Pure randomness sounds like noise. Constrained
randomness inside a strong profile is what makes it feel like *music
that surprises you*. Every random choice in this engine is drawn from a
weighted table that belongs to a profile, and is vetoed by a constraint
solver if it violates voice-leading or range rules.

---

## 1. Design principles

1. **Music first, synthesis second.** Real chord voicings with voice
   leading matter more than fancy oscillators. A sine-wave trio playing
   good harmony beats a detuned supersaw playing the wrong note.
2. **Slow is beautiful.** Long attacks, long releases, long reverb
   tails, slow LFOs. Nothing should change abruptly unless it's a
   deliberate accent.
3. **Stereo by default.** Mono is the single biggest reason procedural
   audio sounds small. Every voice has a defined stereo placement.
4. **Seeded determinism.** Every stochastic decision (note choice,
   humanization, shimmer grain, section choice) pulls from a seeded
   PRNG. Same seed + same command history ⇒ bit-identical output.
5. **Bar-quantized changes.** Chord, section, and profile transitions
   land on bar boundaries; continuous params (filter, volume, reverb)
   ramp smoothly.
6. **Macro controls orchestrate, not just attenuate.** `intensity` adds
   and removes layers; it does not merely turn a volume knob.
7. **Profiles are data, not code.** A new mood/genre is a JSON/TS
   object. Adding one must not require touching the DSP graph.
8. **Constraint-based, not corrective.** The generator proposes; the
   solver disposes. Rejected outputs are re-rolled from the same
   seeded stream so determinism holds.
9. **No clicks, ever.** All state changes go through one-pole
   smoothers or are scheduled at note boundaries.

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

- Sample rate: **48 000 Hz** (upgrade from 44.1k — cheaper math for
  some filters, and matches browser `AudioContext` defaults).
  Configurable.
- Audio block: **128 frames** internal. Server streams 100 ms chunks
  (4 800 frames) built from 37–38 internal blocks.
- Control rate: per-block (128 frames ≈ 2.67 ms). All parameter
  smoothers, LFOs, and envelope stages update at block rate.
  Oscillators and filters run at sample rate.

### 2.3 Determinism

- Single entrypoint PRNG: **Mulberry32**, seeded from a session seed.
- Derive per-layer streams by hashing `(seed, layerName)` → new seed.
  Required streams: `harmony`, `melody`, `rhythm`, `form`,
  `humanize`, `shimmer`.
- `Math.random()` is banned inside the DSP path.
- The constraint solver re-rolls from the same stream; no additional
  entropy is introduced on rejection.

---

## 3. Layer 1 — Clock & timing

The clock is the root of everything downstream.

- **Tempo** (`bpm`): double, held in a smoother. Profile defines a
  range; within a session the tempo drifts ±2 BPM over 32 bars via a
  random walk from the `form` stream.
- **Time signature**: `4/4` for all profiles in v0.3. The data model
  carries `beatsPerBar` and `beatUnit` so `3/4` and `6/8` can be added
  without API change.
- **Subdivision grid**: 16th-note base, with an alternative triplet
  grid selectable per-bar (profile-weighted).
- **Swing**: offbeat delay `offset = swingAmount * baseInterval`,
  `swingAmount ∈ [0, 0.18]`. Applied to 8ths or 16ths depending on
  profile.
- **Counters**: the clock exposes `(absoluteSample, bar, beat,
  sixteenth, phase01)`. Every generator reads these; no generator
  owns its own clock.
- **Bar boundary signal**: a one-sample pulse emitted on every
  downbeat; the form scheduler, progression generator, and
  mood-change queue all trigger on it.

---

## 4. Layer 2 — Harmonic system

### 4.1 Scale library

Built-in modes (name → interval set, semitones from root):

| Name          | Intervals                     |
|---------------|-------------------------------|
| `ionian`      | 0 2 4 5 7 9 11                |
| `dorian`      | 0 2 3 5 7 9 10                |
| `phrygian`    | 0 1 3 5 7 8 10                |
| `lydian`      | 0 2 4 6 7 9 11                |
| `mixolydian`  | 0 2 4 5 7 9 10                |
| `aeolian`     | 0 2 3 5 7 8 10                |
| `locrian`     | 0 1 3 5 6 8 10                |
| `pent-major`  | 0 2 4 7 9                     |
| `pent-minor`  | 0 3 5 7 10                    |
| `blues`       | 0 3 5 6 7 10                  |
| `whole-tone`  | 0 2 4 6 8 10                  |
| `harm-minor`  | 0 2 3 5 7 8 11                |
| `hirajoshi`   | 0 2 3 7 8                     |

Profile picks `(tonic, scale)`; the harmonic system exposes
`scaleContains(pitchClass)` and `nearestScaleDegree(pitch)` for use by
the melody engine and constraint solver.

### 4.2 Chord vocabulary

Chord qualities: triads (`maj`, `min`, `dim`, `aug`, `sus2`, `sus4`),
sevenths (`maj7`, `7`, `m7`, `m7b5`, `dim7`), extensions (`add9`,
`9`, `11`, `13`), and slash chords (`X/Y`, where `Y` is a scale
degree).

Each profile specifies which qualities are allowed per scale degree
(e.g. lo-fi minor allows `m7`, `m9` on `i`; techno allows triads on
`i` only).

### 4.3 Progression generators

Three generator types, selectable per profile:

1. **Functional templates** — fixed Roman-numeral lists with weights
   (`I–V–vi–IV` (3), `vi–IV–I–V` (2), …). Chosen once per section.
2. **12-bar blues** — fixed schema for blues/adjacent profiles.
3. **Markov chain** — transition matrix over Roman numerals, sampled
   one chord at a time. Profile ships its own matrix.

Rules:

- A progression may not repeat immediately within a section.
- Each chord lasts 2 bars by default; sections may compress to 1
  bar/chord at `intensity ≥ 0.75`.

### 4.4 Voice leading

Given the previous voicing and the next chord:

1. Generate all inversions of the next chord whose top voice is
   inside the **voicing window** (default C4–C5 / MIDI 60–72).
2. Score each inversion by `sum(|Δsemitone|)` vs previous voicing.
3. Pick the lowest-cost inversion. Ties broken by preferring stepwise
   motion in the top voice.
4. The constraint solver rejects:
   - parallel perfect fifths/octaves between any two voices,
   - any voice moving > 9 semitones,
   - voicings that leave the window.
   On rejection, try the next-best inversion.

Bass plays the chord **root** at MIDI 36–48, octave chosen to
minimize jump from previous bass note.

---

## 5. Layer 3 — Melody engine

### 5.1 Motif primitives & transformations

A motif is a 2–4 note cell: `[ {degree, duration16ths, velocity}, … ]`.
Transformation operators (all pure functions, `motif → motif`):

- `transpose(n)` — shift by n scale degrees
- `invert(pivot)` — mirror intervals around a pivot degree
- `retrograde()` — reverse order
- `augment(k)` / `diminish(k)` — multiply durations
- `ornament(rate)` — insert passing/neighbor tones

A phrase is built by picking a motif from the profile's motif bank,
then applying a weighted sequence of transformations (profile-defined
weights).

### 5.2 Contour & phrasing

- Contour shapes: `rising`, `falling`, `arch`, `valley`, `flat`.
  Profile weights which are allowed.
- Phrases are 4 bars; bar 4 has a mandatory rest on beat 4 (breath).
- Question/answer pairing: phrase N+1 is the transformation of
  phrase N (`transpose(+1)` or `invert`) with resolution landing on a
  chord tone of the downbeat.

### 5.3 Scale-degree weighting (tension shaping)

At each step, note choice weights:

- Chord tone: 0.55 (×1.5 on strong beats, ×0.6 on weak beats)
- Scale tone (non-chord): 0.30 (passing tone logic on weak beats)
- Chromatic approach (one semitone to next target): 0.05
- Rest: 0.10 (raised to 0.35 at phrase ends)

Contour bias: prefer intervals ≤ perfect 4th; penalize direction
repeats beyond 3 consecutive steps (forces turnarounds). The
constraint solver rejects:

- leaps > 9 semitones,
- >4 bars without a rest,
- notes outside the voice's register.

### 5.4 Rhythmic density vs intensity

| Intensity   | Grid / density                                                |
|-------------|---------------------------------------------------------------|
| `< 0.33`    | 8ths, gate 60%, 40% rest probability per step                 |
| `0.33–0.66` | mixed 8ths/16ths, 20% rest                                    |
| `> 0.66`    | 16ths, 10% rest, occasional triplet bar (every 8th bar)       |

---

## 6. Layer 4 — Rhythm engine

### 6.1 Drum pattern templates

Each profile ships a library of 1-bar drum templates per role (`kick`,
`snare`, `hat-closed`, `hat-open`, `perc`) as 16-step arrays of
`{trigger, velocity}`. Multiple templates per role; chosen with
profile weights, re-rolled per section.

### 6.2 Euclidean generator

`euclid(hits, steps, rotation)` distributes `hits` pulses as evenly as
possible across `steps` positions (Bjorklund's algorithm). Covers
most world grooves:

- `euclid(3, 8)` = tresillo
- `euclid(5, 8)` = cinquillo
- `euclid(7, 16)` = common hat pattern

Profiles may declare `{role, hits, steps, rotation, weight}` entries
instead of (or alongside) explicit templates.

### 6.3 Syncopation & density controls

- **Density** macro per profile scales `hits` up/down within a role's
  allowed range.
- **Syncopation** macro rotates the pattern and biases accents to
  offbeats.
- Both are bar-quantized; changes apply at the next downbeat.

### 6.4 Fill logic

- Every 4 bars (default), bar 4 may be replaced by a **fill**:
  - +50% density on the role that normally drives the groove,
  - last 2 sixteenths always struck,
  - velocity envelope rising into the next bar's downbeat.
- Fill probability: `0.25 + 0.5 * intensity`.
- Section boundaries always get a fill.

### 6.5 Polyrhythm

A role may opt into a cross-meter pattern (e.g. 3-against-4 hat over a
4/4 kick). Expressed as `{pattern, patternSteps, hostSteps}`; the
scheduler wraps the pattern across the host bar. Used sparingly; most
profiles leave it off.

---

## 7. Layer 5 — Song form & arrangement

### 7.1 Section templates

A section is 16 bars. A form is a sequence of section labels chosen
from `{intro, A, B, C, bridge, drop, outro}`. Built-in forms:

| Name     | Shape            | Typical use                     |
|----------|------------------|---------------------------------|
| `AAAB`   | 4-section loop   | ambient, calming                |
| `ABAB`   | verse/chorus     | deep-focus, lo-fi               |
| `ABAC`   | pop-ish          | flow                            |
| `AABB`   | dance pair       | uplift, techno                  |
| `AABA`   | 32-bar jazz      | neutral                         |
| `I-A-B-A-B-O` | intro/outro | full-track profiles            |

Profile picks a form; the form scheduler emits `(sectionLabel,
barInSection)` every downbeat.

### 7.2 Transitions

Between sections, a 1-bar **transition** is inserted:

- `A→B`: reverse-noise swell (4 s tail shortened to 1 bar) + filter
  open.
- `B→A`: cymbal-like noise burst on beat 1 with 800 ms decay.
- `*→drop`: 1-bar drum-only riser + full mute on beat 4.
- `*→*` across profile change: 2-bar transition, old voices release,
  new voices attack.

### 7.3 Dynamic envelope

Each form carries a per-section **intensity curve** (0..1 multiplier
applied to the macro `intensity`). Example `ABAB`: `[0.6, 1.0, 0.7,
1.0]`. This gives pieces built-in builds and releases without the
caller touching the macro.

---

## 8. Layer 6 — Voice roles

Every sound belongs to exactly one **role**. Roles define register
constraints and behavior; they do not define timbre — that is layer 7.

| Role       | Register (MIDI) | Behavior                                               |
|------------|-----------------|--------------------------------------------------------|
| `bass`     | 36–48           | plays chord root, octave closest to previous note      |
| `pad`      | 60–84           | sustains full chord, voice-led per §4.4                |
| `lead`     | 67–88           | melodic phrases per §5, mono/legato                    |
| `drums`    | n/a             | kick/hat/perc per §6                                   |
| `ornament` | 72–108          | shimmer grains, bells, FX — decorative only            |

A role maps to one or more **voices** (e.g. `pad` → 3 voices, one per
chord tone). The mixer keeps per-role buses for sidechain and sends.

---

## 9. Layer 7 — Synthesis & timbre

All envelopes are ADSR in ms unless noted. All frequencies in Hz.
Filter cutoffs in Hz unless noted. These are the *default* patches;
profiles may override any field.

### 9.1 Pad voice (×3, one per chord tone)

- Oscillator bank per voice: 2 detuned saw + 1 sub sine one octave
  down.
  - Saws: ±7 cents, **polyBLEP** bandlimited.
  - Optionally replace saws with 6-partial additive (partials
    1, 2, 3, 4, 5, 7 with amplitudes 1, 0.5, 0.33, 0.18, 0.12, 0.07)
    when `warmth ≥ 0.6` — this produces the "bowed glass" character.
- Per-partial slow amp LFO: rate 0.07–0.19 Hz (randomized per
  partial), depth ±12%. Gives the pad visible "breathing".
- Filter: 12 dB/oct state-variable LPF.
  - Base cutoff: `600 + 2400 * warmth` Hz.
  - LFO on cutoff: rate = tempo/8 (one cycle per 2 bars), depth ±30%.
  - Envelope on cutoff: attack 1 500 ms, sustain at base.
- Amp ADSR: A 1200 / D 400 / S 0.85 / R 2500 ms.
- Pan: voice 0 → −0.35, voice 1 → 0.0, voice 2 → +0.35.
- Haas: voice 0 and 2 delayed 7 ms (opposite channel) to widen.
- Sends: reverb 0.55, delay 0.15.

### 9.2 Bass voice

- 1 sine + 1 triangle one octave up at 0.35 amplitude.
- Filter: 24 dB/oct LPF, cutoff `160 + 120 * warmth` Hz, no
  resonance.
- ADSR: A 8 / D 120 / S 0.7 / R 180 ms. Legato ties when next note
  starts before release completes.
- HPF @ 40 Hz to keep sub controlled.
- Pan: centered. Sends: reverb 0.10, delay 0.0.

### 9.3 Lead voice (mono, legato)

- Karplus–Strong plucked string, feedback 0.992, lowpass in feedback
  loop at `3500 + 4000 * sparkle` Hz.
- Alternative when `sparkle < 0.25`: single triangle with soft-clip
  (gentler, flutier).
- ADSR on amp: A 3 / D 180 / S 0.25 / R 400 ms (re-triggered per
  note unless legato tie — in which case only pitch updates, no
  retrigger).
- Portamento 35 ms on tied notes.
- Pan: +0.15 (slightly right, to separate from kick/bass).
- Sends: reverb 0.45, delay 0.55 (ping-pong).

### 9.4 Kick / Hat / Perc

- **Kick**: sine with pitch env 110 Hz → 45 Hz over 80 ms (exp); amp
  A 1 / D 220 ms; tanh × 1.2 soft-clip; HPF @ 30 Hz; centered.
- **Hat**: white noise → HPF @ 7 kHz, BPF @ 9 kHz (Q 2). Closed
  A 1 / D 45; open A 1 / D 220. Pan ±0.25 alternating.
- **Perc**: band-passed noise hits (side-stick-like), sparse, per
  §6.

### 9.5 Shimmer / ornament bus

- Granular: every 60–180 ms (Poisson from `shimmer` stream), emit a
  grain:
  - Sine at a random chord-tone × {2, 3, 4, 5, 6} (weighted toward
    lower multiples).
  - Hann-windowed, 200–900 ms duration.
  - Amplitude `0.04–0.09 * sparkle`.
  - Pan: uniform random in [−0.9, 0.9].
- Sends: reverb 0.9, delay 0.3.

### 9.6 Transition FX

- **Reverse swell**: pre-rendered 1-bar buffer of filtered noise with
  exponential fade-in; LPF sweeps 200 Hz → 8 kHz over the bar.
- **Cymbal burst**: bandpassed noise, 800 ms exp decay,
  stereo-widened.

### 9.7 Global FX chain

**Reverb — FDN-8**

- 8-line feedback delay network. Delay lengths (ms, co-prime-ish):
  23, 29, 41, 53, 67, 79, 97, 113.
- Feedback matrix: Householder (`I − (2/N)·11ᵀ`), lossless; scale by
  global decay coefficient.
- Decay: `g = 10^(-3 * meanDelay / rt60)`,
  `rt60 = 1.5 + 5.5 * space` seconds.
- One-pole LPF inside each line, cutoff
  `3500 + 3500 * (1 − space)` Hz (darker rooms when `space` low).
- Pre-delay: `20 + 40 * space` ms.
- Stereo output: sum lines 0–3 to L, 4–7 to R.
- Wet mix: `0.25 + 0.35 * space`, clamped 0..0.55.

**Delay — ping-pong**

- Two delay lines (L→R, R→L). Quarter-note synced, optionally
  dotted-eighth in `flow`/`uplift`-style profiles.
- Feedback `0.35 + 0.35 * space`, capped 0.7.
- HPF @ 250 Hz and LPF @ 4500 Hz inside the feedback path.

**Sidechain duck**

- Envelope follower fed from the kick (pre-FX), attack 5 ms, release
  180 ms. Applied as gain reduction to pad, lead, and shimmer buses.
  Depth `3 + 4 * pulse` dB.

**Master chain**: tilt EQ → soft-clip → limiter → output.

- Tilt EQ: pivot 1 kHz; gain `±(2 * warmth − 1) * 3 dB`.
- Soft-clip: `tanh(x * drive) / tanh(drive)`, `drive = 1.1`.
- Limiter: lookahead 5 ms, threshold −1 dBFS, release 120 ms.
- Target loudness: **−16 LUFS integrated** (documented; not metered
  at runtime).

---

## 10. Layer 8 — Profile (genre / mood)

> **This is the key abstraction.** A profile is a bundle of
> constraints over layers 1–7. It is a data file, not code. Adding a
> new mood or genre must not require touching the DSP graph.

### 10.1 Profile schema (sketch)

```ts
interface Profile {
  id: string;                          // "calming", "lo-fi-hip-hop", …
  displayName: string;

  // Layer 1 — clock
  tempo: { min: number; max: number; driftBpmPer32Bars: number };
  grid:  "16th" | "triplet" | "mixed";
  swing: { amount: number; target: "8th" | "16th" };

  // Layer 2 — harmony
  tonic: number;                       // MIDI pitch class root octave
  scale: ScaleId;
  chordVocabulary: Record<RomanNumeral, ChordQuality[]>;
  progression:
    | { kind: "template"; options: WeightedList<RomanNumeral[]> }
    | { kind: "12bar-blues" }
    | { kind: "markov";   matrix: Record<RomanNumeral, WeightedList<RomanNumeral>> };
  voicingWindow: [number, number];     // MIDI range for pad top voice

  // Layer 3 — melody
  motifBank: Motif[];
  transformWeights: Record<TransformOp, number>;
  contourWeights:   Record<ContourShape, number>;

  // Layer 4 — rhythm
  drumTemplates?: Record<DrumRole, WeightedList<Step[]>>;
  euclidean?:     Array<{ role: DrumRole; hits: number; steps: number;
                          rotation: number; weight: number }>;
  fillProbability: number;
  polyrhythm?: Array<{ role: DrumRole; pattern: Step[]; patternSteps: number; hostSteps: number }>;

  // Layer 5 — form
  form: FormId;                        // "ABAB", "AAAB", …
  intensityCurve: number[];            // per section, 0..1 multiplier

  // Layer 6 — voice roles (which are active & their register overrides)
  roles: Partial<Record<RoleId, { register?: [number, number]; mute?: boolean }>>;

  // Layer 7 — timbre: patch overrides (optional; fall back to defaults)
  patches: Partial<Record<RoleId, PatchOverride>>;

  // Layer 9 — randomization bias (seeds default macro values)
  macroDefaults: { intensity: number; warmth: number; sparkle: number;
                   pulse: number; space: number };

  // Mix aesthetic
  masterTilt: number;                  // extra tilt-EQ bias, dB
  sidechainDepthDb: number;
}
```

### 10.2 Example profiles (sketch)

| Profile          | Tonic | Scale        | Tempo     | Swing | Progression palette                                                   | Form  |
|------------------|-------|--------------|-----------|-------|-----------------------------------------------------------------------|-------|
| `calming`        | F3    | lydian       | 64–76     | 0.12  | `I–iii–IV–I` (3), `I–V/vi–vi–IV` (2), `I–ii–I–V` (1)                  | AAAB  |
| `deep-focus`     | E3    | dorian       | 80–92     | 0.10  | `i–VII–VI–VII` (3), `i–iv–VII–III` (2), `i–v–i–VII` (1)               | ABAB  |
| `flow`           | D3    | mixolydian   | 96–108    | 0.15  | `I–bVII–IV–I` (3), `I–vi–ii–V` (2), `I–iii–IV–V` (1)                  | ABAC  |
| `uplift`         | C3    | ionian+add9  | 118–132   | 0.06  | `I–V–vi–IV` (3), `vi–IV–I–V` (2), `I–iii–IV–V` (1)                    | AABB  |
| `neutral`        | D3    | aeolian      | 88–100    | 0.08  | `i–VI–III–VII` (3), `i–iv–v–i` (2)                                    | AABA  |
| `lo-fi-hip-hop`  | A3    | aeolian      | 72–86     | 0.16  | `i–VI–III–VII` (3), `i7–iv7–VII7` (2) — all chords get m7/maj7        | ABAB  |
| `techno`         | A2    | phrygian     | 125–135   | 0.00  | `i` (5), `i–bII` (2) — triads only, chord every 4 bars                | AABB  |

### 10.3 Extension rules per chord (examples)

- `calming`: add maj9 to I and IV (drop the 5 if 9 is present).
- `deep-focus`: add m7 to i, iv; add sus2 to VII.
- `flow`: add 7 to all chords.
- `uplift`: add add9 to I and vi.
- `neutral`: triads only.
- `lo-fi-hip-hop`: every chord gets its seventh; 30% chance of add9 on i.
- `techno`: triads only; no extensions.

---

## 11. Layer 9 — Randomization

### 11.1 Streams

Every random decision names the stream it draws from. The session
seed hashes `(sessionSeed, streamName)` to produce each stream's
seed. Streams: `harmony`, `melody`, `rhythm`, `form`, `humanize`,
`shimmer`.

### 11.2 Weighted tables

All profile-level choice points are **weighted lists**:
`[{ value, weight }, …]`. Sampling is `O(log n)` via prefix sums.

### 11.3 Markov chains

- **Chord Markov** — per-profile transition matrix over Roman
  numerals (optional, when `progression.kind === "markov"`).
- **Note Markov** — per-profile transition bias over scale-degree
  pairs. Applied as a multiplicative factor on top of §5.3 weights.

### 11.4 Constraint solver

After each stochastic proposal, the solver checks **hard constraints**
and re-rolls on failure (up to 8 attempts; then fall back to the
lowest-scoring-but-valid candidate). Constraints:

- **Voicings**: no parallel fifths/octaves; no voice leap > 9 st;
  all voices inside the voicing window (§4.4).
- **Melody**: no leap > 9 st; no >4 bars without a rest; notes
  inside the role's register; no chromatic note outside the scale
  unless it's a sanctioned approach tone.
- **Rhythm**: no empty bar in an active section (§10.1
  `intensityCurve > 0`); no two adjacent bars with zero kick when
  `pulse > 0.5`.
- **Form**: no section label appears three times in a row.

### 11.5 Humanization

- Swing per §3 above.
- Timing jitter: ±4 ms lead, ±2 ms hat, 0 kick (from `humanize`).
- Velocity jitter: ±8% lead/hat, ±3% kick.

---

## 12. Layer 10 — Scheduler & audio output

### 12.1 Look-ahead event queue

- Generator pushes note events tagged with absolute sample timestamp.
- Scheduler maintains a min-heap keyed by timestamp and pops events
  whose time falls inside the next audio block.
- Look-ahead: ~100 ms (matches the server's chunk size) — larger than
  one block so that late-arriving profile changes can still land
  sample-accurately on the next bar.

### 12.2 Mixer

- Per-voice gain/pan.
- Per-role bus (bass / pad / lead / drums / ornament) with send
  levels to reverb and delay.
- Master bus per §9.7.

### 12.3 Macro parameter mapping

`intensity`, `warmth`, `sparkle`, `pulse`, `space` ∈ [0, 1]. These
sit on top of the profile; the profile provides defaults, the user
overrides.

| Param       | Targets                                                                                                 |
|-------------|---------------------------------------------------------------------------------------------------------|
| `intensity` | layer gating (§12.4), melody density (§5.4), pad filter env depth, chord rate (2 → 1 bars), lead amp    |
| `warmth`    | pad filter cutoff base, pad osc switch to additive (≥ 0.6), bass filter cutoff, master tilt EQ          |
| `sparkle`   | shimmer grain rate & amp, lead KS feedback LPF cutoff, hat presence, master tilt (high shelf)           |
| `pulse`     | kick amplitude, hat density, perc presence, sidechain depth                                             |
| `space`     | reverb RT60, reverb pre-delay, reverb damping, delay feedback, pad Haas amount                          |

### 12.4 Intensity → layer gating

| Range        | Active layers                                               |
|--------------|-------------------------------------------------------------|
| `0.00–0.20`  | pad only                                                    |
| `0.20–0.40`  | pad + bass + shimmer                                        |
| `0.40–0.65`  | pad + bass + shimmer + lead (sparse) + kick                 |
| `0.65–0.85`  | above + hat                                                 |
| `0.85–1.00`  | above + perc + chord rate doubled                           |

Layer entries/exits crossfade over 2 bars; they never hard-switch.

### 12.5 Parameter smoothing

- All macro params run through a one-pole smoother with time
  constant `τ = transitionMs / 4`.
- Smoothers update at control rate.
- **Profile transitions** are bar-quantized: incoming profile is
  queued; on the next bar boundary, new voicings/progression take
  over and a 2-bar crossfade occurs.

---

## 13. Engine API

### 13.1 `ProceduralRenderOptions`

```ts
interface ProceduralRenderOptions {
  profile: ProfileId;           // was "mood"; back-compat alias kept
  intensity: number;
  durationSeconds: number;
  sampleRate?: number;          // default 48_000
  seed?: number;                // default derived from profile+duration
  warmth?: number;              // default per-profile
  sparkle?: number;             // default per-profile
  pulse?: number;               // default per-profile
  space?: number;               // default per-profile
  stereo?: boolean;             // default true
}
```

### 13.2 PCM output

- `stereo === true` (default): interleaved LR `Float32Array` of
  length `frames * 2`.
- New helper `encodeWavPcm16Stereo(samples, sampleRate)`.
- `renderProceduralWav` auto-selects mono/stereo encoder.
- `renderProceduralPcm` return type:
  `{ samples: Float32Array; channels: 1 | 2; sampleRate: number }`.
  (Breaking — acceptable pre-1.0.)

### 13.3 Streaming server

- `SoundscapeControl` gains `seed` and bar-quantized profile
  scheduling.
- `/state` exposes: `seed`, current section label, current chord
  index, bar position, tempo, and smoothed macro values.
- `/command` accepts optional `seed` and `profile` fields; profile
  changes are queued to the next bar.
- Chunk size stays 100 ms; synth uses 128-frame internal blocks.

---

## 14. Determinism contract

- Given identical `(seed, sampleRate, sequence of (timestamp,
  command))` the rendered PCM must be bit-identical across runs.
- FP caveat: assume IEEE-754 double and standard `Math.sin` /
  `Math.exp`. We do not require cross-engine bit identity — only
  determinism within a single V8 version.
- All PRNG streams must be re-seedable.
- Constraint-solver re-rolls consume the same stream; rejection
  does not inject extra entropy.

---

## 15. Acceptance criteria

A build satisfies this spec when all of the following hold:

1. **No aliasing above −60 dBFS** in a 200 Hz → 4 kHz sweep of the
   lead voice (verified with offline FFT).
2. **No clicks** on chord, section, or profile transitions
   (adjacent-sample discontinuity > 0.1 flags a failure).
3. **Profile distinguishability**: blind A/B of any two profile
   defaults produces spectral-centroid differences > 200 Hz.
4. **Intensity sweep**: linear ramp 0 → 1 over 32 bars yields
   monotonically increasing short-term RMS (every 2 bars) and adds
   layers at the §12.4 thresholds.
5. **Loudness**: integrated LUFS of a 60-second render at default
   macros is within [−18, −14] LUFS.
6. **Stereo width**: L/R correlation at default `space` lies in
   [0.55, 0.85] (wide but mono-compatible).
7. **Determinism**: two renders with the same seed and options are
   byte-identical.
8. **Voice-leading check**: across a 64-bar render, the sum of pad
   voice motion per chord change averages ≤ 4 semitones.
9. **Constraint solver**: < 1% of proposed events fall back to the
   "lowest-scoring-but-valid" branch at default settings (solver
   mostly passes on first try).
10. **CPU budget**: 60 s of stereo 48 kHz audio renders in ≤ 10 s on
    a modern laptop (Node 22, single thread).

A small test harness under `playground/audio-tests/` should automate
1, 2, 4, 5, 7, 8, 9, 10.

---

## 16. Implementation plan (suggested order)

The order mirrors the layer stack — each step is independently
auditionable via `renderProceduralWav`.

1. **Scaffolding**: PRNG + streams, block-rate control graph,
   stereo buffer, WAV stereo encoder, smoothers, tempo/bar clock
   *(layers 1, 10 partial)*.
2. **Profile loader**: schema + default profiles from §10.2 as data
   files *(layer 8 skeleton; fully populated as later layers land)*.
3. **Harmonic system**: scales, chord resolver, voice-leading
   inversion picker, bass octave picker *(layer 2)*.
4. **Pad voice** (saw + polyBLEP + SVF LPF + ADSR + Haas) +
   **FDN-8 reverb** + master soft-clip + stereo out *(layers 6/7
   minimum viable)* — massive audible upgrade just from this step.
5. **Bass + kick + sidechain duck** *(layers 6/7)*.
6. **Rhythm engine**: drum templates + Euclidean + fill logic
   *(layer 4)*.
7. **Melody engine**: motif bank + transformations + scale-degree
   weighting + Karplus–Strong lead + ping-pong delay *(layer 3)*.
8. **Hat + perc + swing/humanization**.
9. **Shimmer granular ornament bus** *(layer 6 ornament role)*.
10. **Form scheduler**: A/B/… sections, transitions, intensity
    curve, bar-quantized profile changes *(layer 5)*.
11. **Constraint solver**: wire the hard constraints from §11.4 into
    harmony, melody, and rhythm proposals *(layer 9)*.
12. **Additive pad mode**, tilt EQ, limiter.
13. **Test harness** for §15 acceptance checks.

The agent should commit a reference WAV after every step so
regressions are caught by ear as well as by tests.

---

## 17. Out of scope / future (v0.4+)

- MIDI export.
- User-defined chord progressions via API.
- Sample-based layers (piano, guitar, vinyl noise loops).
- Live tempo-sync to external clock.
- Per-voice effects beyond sends (chorus, phaser).
- GPU-accelerated convolution reverb.
- Time signatures other than 4/4 (schema already supports this;
  the generators need updating).
- Community profile packs loaded at runtime from disk/URL.
