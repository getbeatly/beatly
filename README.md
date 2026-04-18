# @beatly/core

Beatly now contains both the control layer and the SuperCollider runtime.

## What is in this repo now

- agent-event entrypoint (`@beatly/core/skill`)
- recommendation/conductor layer (`@beatly/core`)
- adapter for controlling the bundled SuperCollider server (`@beatly/core/adapters`)
- genre catalog copied from the original SuperCollider project
- bundled runtime under `supercollider/`
  - `server.js`
  - `music.js`
  - `.scd` sources
  - `public/` UI
  - `synthdefs/`

## Usage

```ts
import { BeatlyConductor } from "@beatly/core";
import { SuperColliderHelloAdapter } from "@beatly/core/adapters";
import { createBeatlySkill } from "@beatly/core/skill";

const adapter = new SuperColliderHelloAdapter({
  autostart: true,
  serverCwd: "./supercollider",
});

await adapter.ensureReady();

const conductor = new BeatlyConductor({ adapters: [adapter] });
const skill = createBeatlySkill(conductor);

await skill.start({ agentId: "pi" });
await skill.handleEvent({ type: "task.started" });
await skill.handleUpdate({ type: "agent.update", status: "coding", summary: "Implementing feature" });
await skill.override({ genre: "lofi", reason: "manual.focus-mode" });
await skill.handleEvent({ type: "task.completed" });
await skill.stop("done");
```

## Runtime commands

```bash
npm start
npm run sc:start
npm run sc:build
npm run sc:live
npm run sc:generate
```

## Pi skill install

This package now ships a standard pi skill at `skills/beatly`.

Install it into another pi instance from git:

```bash
pi install git:github.com:getbeatly/beatly
```

Install it from npm after publishing:

```bash
pi install npm:@beatly/core
```

Install it only for the current project:

```bash
pi install -l git:github.com:getbeatly/beatly
```

After install, pi discovers the skill automatically from the package manifest and you can invoke it with:

```bash
/skill:beatly
```

## Agent skill shape

The skill now supports:

- `handleEvent(...)` for discrete lifecycle events
- `handleUpdate(...)` for richer status updates from an agent
- `override(...)` for direct playback changes

Example update payloads:

```ts
{ type: "agent.update", status: "thinking", summary: "Planning the refactor" }
{ type: "agent.update", status: "coding", signal: { energy: 0.72 } }
{ type: "playback.override", playback: { genre: "ambient", running: true } }
```

## Publishing

Build and verify the package:

```bash
npm run build
npm pack --dry-run
```

Publish to npm:

```bash
npm publish --access public
```

## Notes

- `npm start` runs the main server, which spawns `scsynth`, serves the playground UI, and accepts control + agent-event HTTP commands.
- `SuperColliderHelloAdapter` talks to the HTTP API exposed by `supercollider/server.js`.
- Agent/event endpoints: `POST /api/agent` and `POST /api/event`.
- Playground/control endpoints: `POST /api/control` and `POST /api/command`.
- The bundled pi skill is named `beatly`, which matches the `skills/beatly` directory per the Agent Skills naming rules.
- Supported genres: `ambient`, `calming`, `deepFocus`, `lofi`, `jazzNoir`, `techno`, `dnb`, `dub`, `uplift`, `neoSoul`, `dreamPop`, `soulHop`, `cityPop`, `bossaNova`, `chillHouse`, `rainyPiano`, `sunsetGroove`.
- Expanded scale palette in the runtime includes `majorPentatonic`, `minorPentatonic`, `harmonicMinor`, `melodicMinor`, `doubleHarmonic`, and `wholeTone`, plus support for `thirteenth` chord extensions.
