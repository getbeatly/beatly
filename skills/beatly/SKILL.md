---
name: beatly
description: Control the local Beatly SuperCollider soundtrack server. Use when you want soundtrack playback updates based on agent activity, to send agent events or status updates, inspect Beatly state, or manually override genre and playback.
---

# Beatly

Use this skill when you want the coding soundtrack to react to agent activity or when you want direct control over Beatly playback.

## What this skill controls

This project runs a local Beatly server at `http://127.0.0.1:8080`.

The server:
- spawns `scsynth`
- serves the playground UI
- accepts direct control commands
- accepts agent event commands

## Setup

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
- After sending a command, summarize the returned state briefly.
- If the server is unavailable, say so clearly and suggest `npm start`.
