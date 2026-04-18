# @beatly/core

> **A live, generative soundtrack for coding agents.**
> Beatly reacts to agent events in real time, with a user-selectable vibe and a local jukebox-style control surface. See [beatly.dev](https://beatly.dev) for the product story.

This repo contains:

- the control layer and `@beatly/core` library
- the bundled SuperCollider runtime (`supercollider/`) with server, UI, synthdefs, and `.scd` sources
- a standard **pi** skill (`skills/beatly`)
- build targets for a **Codex** plugin and a **Claude Code** skill bundle

## Requirements

SuperCollider is a **hard system dependency** on every machine that runs Beatly. You must have:

- Node.js 22+
- SuperCollider installed system-wide
- `scsynth` on `PATH`
- `sclang` on `PATH`

Without this, nothing in Beatly can start or render audio.

---

## Install for your agent

Beatly ships in three shapes, one per target agent harness. All three drive the same local Beatly server (`http://localhost:8080`) and the same `skills/beatly` commands.

### pi

Install from npm (once published):

```bash
pi install npm:@beatly/core
```

Install from git:

```bash
pi install git:github.com:getbeatly/beatly
```

Install only for the current project:

```bash
pi install -l git:github.com:getbeatly/beatly
```

pi picks the skill up automatically via the package manifest. Invoke it with:

```text
/skill:beatly
```

### Codex

Build the self-contained plugin:

```bash
npm run build:codex-plugin
```

The plugin is written to `./.build/distributions/codex/beatly` and is also published as `beatly-codex-vX.Y.Z.tar.gz` on every GitHub release.

For a repo-scoped Codex install, drop it into your repo and register a local marketplace:

```bash
mkdir -p ./.agents/plugins ./plugins
cp -R /absolute/path/to/beatly/.build/distributions/codex/beatly ./plugins/beatly
```

Create or update `./.agents/plugins/marketplace.json`:

```json
{
  "name": "local-beatly",
  "interface": { "displayName": "Local Beatly Plugins" },
  "plugins": [
    {
      "name": "beatly",
      "source": { "source": "local", "path": "./plugins/beatly" },
      "policy": { "installation": "AVAILABLE", "authentication": "ON_INSTALL" },
      "category": "Productivity"
    }
  ]
}
```

Restart Codex, open the plugin directory, pick the local marketplace, and install **Beatly**.

The generated plugin is self-contained and includes `skills/beatly`, `dist/`, `supercollider/`, and runtime `node_modules/`.

### Claude Code

Build the self-contained skill bundle:

```bash
npm run build:claude-code
```

The bundle is written to `./.build/distributions/claude-code/beatly` and is also published as `beatly-claude-code-vX.Y.Z.tar.gz` on every GitHub release.

A typical install is a symlink into Claude Code's skills directory:

```bash
mkdir -p ~/.claude/skills
ln -s /absolute/path/to/beatly/.build/distributions/claude-code/beatly ~/.claude/skills/beatly
```

---

## Running Beatly locally

Start the main server (it spawns `scsynth`, serves the jukebox UI, and accepts control + agent-event HTTP commands):

```bash
npm start
```

Open the jukebox control UI at [http://localhost:8080](http://localhost:8080).

HTTP API:

- `POST /api/agent` — agent updates
- `POST /api/event` — discrete agent events
- `POST /api/control` — playback control
- `POST /api/command` — direct commands

Other runtime scripts:

```bash
npm run sc:start       # same as `npm start`
npm run sc:build       # compile synthdefs
npm run sc:live        # live.scd playground
npm run sc:generate    # procedural render
```

---

## Skill commands

Once installed into pi, Codex, or Claude Code, the `beatly` skill exposes these shell entrypoints:

```bash
./event.sh task.started        # discrete lifecycle event
./update.sh coding "Writing the refactor" 0.72 0.62 0.38
                               # status | summary | focus | load | energy
./override.sh lofi true        # genre + running flag (+ optional seed)
./state.sh                     # inspect current state
```

Supported event types: `task.started`, `task.blocked`, `task.completed`, `agent.idle`, `agent.error`, `agent.breakthrough`.

Supported genres: `ambient`, `calming`, `deepFocus`, `lofi`, `jazzNoir`, `techno`, `dnb`, `dub`, `uplift`, `neoSoul`, `dreamPop`, `soulHop`, `cityPop`, `bossaNova`, `chillHouse`, `rainyPiano`, `sunsetGroove`.

---

## Library usage

You can also use `@beatly/core` directly from TypeScript if you are writing a custom agent integration:

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

The skill supports:

- `handleEvent(...)` — discrete lifecycle events
- `handleUpdate(...)` — richer status updates from an agent
- `override(...)` — direct playback changes

Example payloads:

```ts
{ type: "agent.update", status: "thinking", summary: "Planning the refactor" }
{ type: "agent.update", status: "coding", signal: { energy: 0.72 } }
{ type: "playback.override", playback: { genre: "ambient", running: true } }
```

---

## Building distribution artifacts

Build every target at once:

```bash
npm run build:distributions
```

Or target one:

```bash
npm run build:pi-package       # npm tarball for pi
npm run build:codex-plugin     # Codex plugin bundle
npm run build:claude-code      # Claude Code skill bundle
```

Outputs go to `./.build/distributions/{pi,codex,claude-code}/`.

---

## Releasing

Bump the version and tag it. CI handles the rest:

```bash
# edit package.json version, or:
npm version patch --no-git-tag-version

git commit -am "Release v0.x.y"
git tag v0.x.y
git push && git push --tags
```

On any `v*` tag, `.github/workflows/publish.yml`:

1. Syncs `package.json` version with the tag (`npm version`)
2. Builds the library and all distribution bundles
3. Publishes `@beatly/core` to npm with provenance
4. Uploads `pi/`, `codex/`, and `claude-code/` artifacts
5. Attaches `beatly-codex-vX.Y.Z.tar.gz` and `beatly-claude-code-vX.Y.Z.tar.gz` to the GitHub release

Check the run with:

```bash
gh run list --workflow "Publish to npm"
gh release list
```

---

## Notes

- `skills/beatly` matches the Agent Skills naming convention; pi, Codex, and Claude Code all auto-discover it.
- `SuperColliderHelloAdapter` talks to the HTTP API exposed by `supercollider/server.js`.
- The expanded scale palette in the runtime includes `majorPentatonic`, `minorPentatonic`, `harmonicMinor`, `melodicMinor`, `doubleHarmonic`, and `wholeTone`, plus `thirteenth` chord extensions.
- Product/UX direction lives in [`../beatly.dev`](https://beatly.dev): Beatly must feel like a live soundtrack for coding agents — reactive, real-time, and always under user control.
