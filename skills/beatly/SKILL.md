---
name: beatly
description: Control the local Beatly SuperCollider soundtrack server. Use when you want soundtrack playback updates based on agent activity, to send agent events or status updates, inspect Beatly state, or manually override genre and playback.
---

# Beatly

Use this skill when you want the coding soundtrack to react to agent activity or when you want direct control over Beatly playback.

This skill should be used in a way that matches the Beatly product design from `../beatly.dev`: a live soundtrack for coding agents, reactive to events in real time, with clear user-facing mood control.

## What this skill controls

This project runs a local Beatly server at `http://127.0.0.1:8080`.

The server:
- spawns `scsynth`
- serves the local jukebox/playground UI
- accepts direct control commands
- accepts agent event commands

While the server is running, the user can always open the jukebox control UI at `http://localhost:8080`.

## Setup

SuperCollider is a hard dependency for this skill. It must be installed system-wide on the machine running pi, and both `scsynth` and `sclang` must be available on `PATH`.

Before sending commands, make sure the server is running:

```bash
npm start
```

If needed, inspect current state:

```bash
./state.sh
```

## Commands

### Send a discrete agent event

```bash
./event.sh task.started
./event.sh task.blocked
./event.sh task.completed
./event.sh agent.idle
./event.sh agent.error
./event.sh agent.breakthrough
```

### Send a richer status update

```bash
./update.sh coding "Implementing feature"
./update.sh thinking "Planning refactor" 0.72 0.62 0.38
```

Arguments for `update.sh`:
1. status: `thinking|coding|reviewing|waiting|celebrating`
2. summary: optional
3. focus: optional 0..1
4. cognitiveLoad: optional 0..1
5. energy: optional 0..1

### Manual override

```bash
./override.sh lofi true
./override.sh ambient true 12345
```

Arguments for `override.sh`:
1. genre
2. running: `true|false`
3. seed: optional

### Inspect state

```bash
./state.sh
```

## Preferred behavior

- For task lifecycle changes, prefer `event.sh`.
- For nuanced progress reports from an agent, prefer `update.sh`.
- For explicit user requests like “play lofi” or “stop music”, prefer `override.sh`.
- Remind the user that they can always use the local jukebox UI at `http://localhost:8080` while the server is running.
- After sending a command, summarize the returned state briefly.
- If the server is unavailable, say so clearly and suggest `npm start`.
- If `scsynth` or `sclang` are missing, say clearly that SuperCollider must be installed system-wide first.
