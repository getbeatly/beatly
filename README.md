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

## Notes

- `npm start` runs the main server, which spawns `scsynth`, serves the playground UI, and accepts control + agent-event HTTP commands.
- `SuperColliderHelloAdapter` talks to the HTTP API exposed by `supercollider/server.js`.
- Agent/event endpoints: `POST /api/agent` and `POST /api/event`.
- Playground/control endpoints: `POST /api/control` and `POST /api/command`.
- Supported genres copied over: `ambient`, `calming`, `deepFocus`, `lofi`, `jazzNoir`, `techno`, `dnb`, `dub`, `uplift`, `neoSoul`.
