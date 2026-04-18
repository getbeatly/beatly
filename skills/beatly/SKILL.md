---
name: beatly
description: Control the local Beatly SuperCollider soundtrack server. Use when you want soundtrack playback updates based on agent activity, to send agent events or status updates, inspect Beatly state, or manually override genre and playback.
---

# Beatly

Use this skill when you want the coding soundtrack to react to agent activity or when you want direct control over Beatly playback.

This skill should be used in a way that matches the Beatly product design from `beatly.dev`: a live soundtrack for coding agents, reactive to events in real time, with clear user-facing mood control.

## What this skill controls

A local Beatly server at `http://127.0.0.1:8080`, which:
- spawns `scsynth`
- serves the local jukebox/playground UI (open it at http://localhost:8080)
- accepts direct control commands
- accepts agent event commands

## Paths

All scripts live here and can be invoked by **absolute path from any cwd**:

```
/home/yuval/dev/beatly/skills/beatly/state.sh
/home/yuval/dev/beatly/skills/beatly/event.sh
/home/yuval/dev/beatly/skills/beatly/update.sh
/home/yuval/dev/beatly/skills/beatly/override.sh
```

Runtime root (the repo with `dist/` and `supercollider/`): `/home/yuval/dev/beatly`

## Requirements

SuperCollider must be installed system-wide: both `scsynth` and `sclang` must be on `PATH`. If either is missing, stop and tell the user clearly.

## Starting the server

**You usually do not need to start the server manually.** The first call to any of the four scripts (`state.sh`, `event.sh`, `update.sh`, `override.sh`) will autostart the server via `SuperColliderHelloAdapter({ autostart: true })` in `driver.mjs`. Just call the script you actually want.

To check whether it's already up without side effects:

```bash
curl -sf http://127.0.0.1:8080/api/state >/dev/null && echo up || echo down
```

If you want to start it explicitly in the background (e.g. to watch logs):

```bash
cd /home/yuval/dev/beatly
nohup npm start >/tmp/beatly.log 2>&1 & disown
# then: tail -f /tmp/beatly.log
```

## Stopping the server

There is no shutdown HTTP endpoint. The node process title is `node supercollider/server.js` (it does **not** contain "beatly"), so a naive `pkill -f beatly` will miss it. Use:

```bash
pkill -f 'supercollider/server.js'   # kills the node server; scsynth exits with it
# verify:
pgrep -af 'supercollider/server.js|scsynth'
```

## Commands

### Send a discrete agent event

```bash
/home/yuval/dev/beatly/skills/beatly/event.sh task.started
/home/yuval/dev/beatly/skills/beatly/event.sh task.blocked
/home/yuval/dev/beatly/skills/beatly/event.sh task.completed
/home/yuval/dev/beatly/skills/beatly/event.sh agent.idle
/home/yuval/dev/beatly/skills/beatly/event.sh agent.error
/home/yuval/dev/beatly/skills/beatly/event.sh agent.breakthrough
```

### Send a richer status update

```bash
/home/yuval/dev/beatly/skills/beatly/update.sh coding "Implementing feature"
/home/yuval/dev/beatly/skills/beatly/update.sh thinking "Planning refactor" 0.72 0.62 0.38
```

Arguments for `update.sh`:
1. status: `thinking|coding|reviewing|waiting|celebrating`
2. summary: optional
3. focus: optional 0..1
4. cognitiveLoad: optional 0..1
5. energy: optional 0..1

### Manual override

```bash
/home/yuval/dev/beatly/skills/beatly/override.sh lofi true
/home/yuval/dev/beatly/skills/beatly/override.sh lofi.night true
/home/yuval/dev/beatly/skills/beatly/override.sh ambient true 12345 cathedral
```

Arguments for `override.sh`:
1. genre (`lofi`) or full `genre.variant` (`lofi.night`)
2. running: `true|false`
3. seed: optional integer
4. variant: optional (if not already baked into arg 1)

Each genre has several named variants (e.g. `lofi` → `classic`, `night`, `crate`, `sunday`, `jazzy`, `tape`). Inspect them via `./state.sh` — the response includes a `genres` array with each genre's variants.

### Inspect state

```bash
/home/yuval/dev/beatly/skills/beatly/state.sh
```

Returns JSON of shape:

```json
{
  "profile": "sunsetGroove.golden",
  "genre": "sunsetGroove",
  "variant": "golden",
  "seed": 701337117,
  "bpm": 108,
  "bar": 1,
  "running": true,
  "profiles": ["ambient.classic", "ambient.abyss", "..."],
  "genres": [
    { "id": "lofi", "defaultVariant": "classic", "variants": ["classic", "night", "crate", "sunday", "jazzy", "tape"] }
  ],
  "lastAgentEvent": null
}
```

The `genres` array is the canonical list of valid genres and their variants. The `profiles` array lists every `genre.variant` combination directly.

## Preferred behavior

- For task lifecycle changes, prefer `event.sh`.
- For nuanced progress reports from an agent, prefer `update.sh`.
- For explicit user requests like "play lofi" or "stop music", prefer `override.sh` (use `override.sh <genre> false` to pause).
- After sending a command, summarize the returned state briefly (profile, bpm, running).
- Remind the user once per session that the jukebox UI lives at http://localhost:8080.
- If `curl` to `/api/state` fails and scripts also error out, say the server is unavailable and suggest the explicit `nohup npm start …` line above.
- If `scsynth` or `sclang` are missing from `PATH`, say clearly that SuperCollider must be installed system-wide first — do not attempt workarounds.
