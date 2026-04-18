# Beatly Core Specification (Draft v0.1)

## 1. Product intent

Beatly provides a live, adaptive soundtrack for coding agents.

The core package (`@beatly/core`) is the orchestration layer that transforms agent state/signals into musical decisions and dispatches those decisions to runtime adapters.

## 2. Current architecture

```text
Agent events/signals
      │
      ▼
 BeatlySkill (optional mapping layer)
      │
      ▼
  BeatlyEngine (policy + lifecycle)
      │
      ├── decision output: mood, intensity, track
      ▼
 Adapter layer (runtime integrations)
```

### 2.1 Core components

- `BeatlyEngine`
  - Session lifecycle (`startSession`, `ingestSignal`, `stopSession`)
  - Mood + intensity derivation from `BeatlySignal`
  - Track selection from catalog
- `BeatlySkill`
  - Maps coding-agent events (`task.started`, `task.blocked`, etc.) into signals
- `BeatlyAdapter`
  - Runtime integration boundary (playback targets, telemetry, network relays)

## 3. Audio runtime strategy

We support three runtime modes behind a common adapter concept:

1. **Procedural synthesis runtime** (implemented sample)
   - Generates PCM on the fly from mood/intensity profiles.
   - Best for low-latency prototyping and deterministic tests.

2. **Stem/loop mixer runtime** (planned)
   - Selects and blends pre-rendered loops/stems by mood/BPM/intensity.
   - Best for fast, high-quality production rollout.

3. **AI generation runtime** (planned)
   - Requests generated music from provider APIs/models.
   - Best for maximal variety, with higher latency/cost controls.

## 4. Procedural runtime + interactive server (implemented)

We now provide two procedural paths:

1. **Library renderer**: `@beatly/core/procedural` (`src/procedural.ts`)
2. **Interactive server runtime**: `playground/procedural-server.mjs`

### 4.1 Library renderer API

- `renderProceduralPcm(options): Float32Array`
- `encodeWavPcm16Mono(samples, sampleRate): Uint8Array`
- `renderProceduralWav(options): Uint8Array`

`ProceduralRenderOptions`

- `mood: BeatlyMood`
- `intensity: number` (`0..1`)
- `durationSeconds: number`
- `sampleRate?: number` (default `44_100`)

### 4.2 Interactive audio server design

Server responsibilities:

- Generate live audio continuously (mono PCM16 WAV stream)
- Accept control commands from humans and agents
- Apply smooth transitions between soundscape states
- Provide a browser UI for immediate audition/control

Endpoints:

- `GET /` → control UI
- `GET /audio` → live streaming WAV
- `GET /state` → current + target soundscape state
- `POST /command` → direct parameter commands
- `POST /agent` → high-level event commands

Command schema (subset):

- `mood`: `calming | deep-focus | flow | uplift | neutral`
- `intensity`: `0..1`
- `warmth`: `0..1`
- `sparkle`: `0..1`
- `pulse`: `0..1`
- `space`: `0..1`
- `transitionMs`: `0..20000`

### 4.3 Synthesis model

- Mood profiles define base tempo/root/scale and brightness.
- Render layers include:
  - harmonic pads
  - bass bed
  - arpeggiated lead
  - pulse/kick envelope
  - shimmer noise
- Post processing includes low-pass tone shaping, feedback delay (space), and soft saturation.
- State transitions are eased over configurable durations for musical continuity.

## 5. Testing workflow

### 5.1 Live interactive test

1. Run `npm run dev:audio-server`
2. Open `http://localhost:8787/`
3. Start stream and tweak controls in real-time
4. Trigger agent events via UI or `POST /agent`

### 5.2 Validation criteria

- No clipping artifacts on default settings.
- Mood presets audibly distinct.
- Intensity sweeps produce clear energy change.
- Render is deterministic enough for snapshot-style spectral checks (with optional deterministic noise in future revision).

## 6. Near-term roadmap

1. Add deterministic random source support to procedural renderer.
2. Add stereo rendering and simple delay/reverb sends.
3. Define common `AudioRuntime` interface shared by:
   - `ProceduralRuntime`
   - `StemMixerRuntime`
   - `AIGenerationRuntime`
4. Add reference `WebSocketAdapter` for streaming decisions/audio metadata to UI/player.
5. Add benchmark harness for render latency and CPU budget.
