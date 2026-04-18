# @beatly/core

Core library and agent entrypoints for Beatly — live music soundtrack orchestration for coding agents.

## Install

```bash
npm i @beatly/core
```

## Entrypoints

- `@beatly/core` → engine, session model, signal-to-music decisioning
- `@beatly/core/skill` → event bridge for coding-agent workflows
- `@beatly/core/adapters` → adapter contracts and default console adapter
- `@beatly/core/procedural` → procedural audio sample renderer (PCM/WAV)

## Architecture (v0.1)

```text
Agent events/signals
      │
      ▼
 BeatlySkill (optional)
      │
      ▼
  BeatlyEngine
  - session lifecycle
  - mood/intensity derivation
  - track selection
      │
      ▼
 Adapter layer
  (audio players, telemetry, websocket relays, etc.)
```

## Minimal usage

```ts
import { BeatlyEngine } from "@beatly/core";
import { ConsoleAdapter } from "@beatly/core/adapters";
import { createBeatlySkill } from "@beatly/core/skill";

const engine = new BeatlyEngine({ adapters: [new ConsoleAdapter()] });
const skill = createBeatlySkill(engine);

await skill.start({ agentId: "claude-code" });
await skill.handleEvent({ type: "task.started" });
await skill.handleEvent({ type: "task.completed" });
await skill.stop("done");
```

## Interactive procedural audio server (live)

```bash
npm run dev:audio-server
```

Then open:

- `http://localhost:8787/` for the interactive control UI
- `http://localhost:8787/audio` for the live audio stream
- `http://localhost:8787/state` for current soundscape state

Send commands from an agent or script:

```bash
curl -X POST http://localhost:8787/command \
  -H 'content-type: application/json' \
  -d '{"mood":"deep-focus","intensity":0.68,"space":0.5,"transitionMs":900}'
```

Or send high-level agent events:

```bash
curl -X POST http://localhost:8787/agent \
  -H 'content-type: application/json' \
  -d '{"event":"task.completed"}'
```

## Notes

- This is a foundation release focused on API shape and extension points.
- Next layers can add real audio providers, adaptive recommendation models, and multi-agent mixing.
