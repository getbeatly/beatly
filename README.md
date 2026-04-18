# @beatly/core

Beatly now acts as a control layer for the SuperCollider setup in `../hello-supercollider`.

## What is in this repo now

- agent-event entrypoint (`@beatly/core/skill`)
- recommendation/conductor layer (`@beatly/core`)
- adapter for controlling the sibling `hello-supercollider` server (`@beatly/core/adapters`)
- genre catalog copied from the sibling project

## What was removed

- in-repo DSP/procedural audio code
- in-repo live audio playground/server
- old audio specs/docs for the removed renderer

## Usage

```ts
import { BeatlyConductor } from "@beatly/core";
import { SuperColliderHelloAdapter } from "@beatly/core/adapters";
import { createBeatlySkill } from "@beatly/core/skill";

const adapter = new SuperColliderHelloAdapter({
  autostart: true,
  serverCwd: "../hello-supercollider",
});

await adapter.ensureReady();

const conductor = new BeatlyConductor({ adapters: [adapter] });
const skill = createBeatlySkill(conductor);

await skill.start({ agentId: "pi" });
await skill.handleEvent({ type: "task.started" });
await skill.handleEvent({ type: "task.completed" });
await skill.stop("done");
```

## Notes

- `SuperColliderHelloAdapter` talks to the HTTP API exposed by `../hello-supercollider/server.js`.
- If `autostart: true`, this package can spawn that server for you.
- Supported genres copied over: `ambient`, `calming`, `deepFocus`, `lofi`, `jazzNoir`, `techno`, `dnb`, `dub`, `uplift`, `neoSoul`.
