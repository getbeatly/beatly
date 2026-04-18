---
name: beatly
description: Play a live, generative background soundtrack while you work. Beatly gives any coding agent a local music server whose mood follows what the agent is actually doing — thinking, coding, blocked, shipping — and lets the agent pick the vibe itself.
---

# Beatly

Beatly lets any coding agent run a nice background soundtrack while it works, and lets the agent choose what's playing based on its current mood and whatever is going on in the task right now.

- **Starting a long task?** pick something focused.
- **Stuck or blocked?** ease off to something calming.
- **Tests just went green?** celebrate with something energetic.
- **Just idle?** ambient.

You don't narrate the music to the user unless they ask — just keep the vibe matched to the work.

## How it runs

The skill talks to a local Beatly server (spawns `scsynth`, serves a jukebox UI at `http://localhost:8080`). The server **autostarts on first use** — just call the script you want. SuperCollider must be installed system-wide (`scsynth` and `sclang` on `PATH`); if it isn't, say so and stop.

## The four scripts

All scripts live in this skill directory. Call them by path.

| Script | Use it when |
| :--- | :--- |
| `./state.sh` | You need the current genre/variant/bpm, or the full list of genres and their variants. |
| `./event.sh <event>` | A lifecycle thing happened. Events: `task.started`, `task.blocked`, `task.completed`, `agent.idle`, `agent.error`, `agent.breakthrough`. |
| `./update.sh <status> [summary] [focus] [load] [energy]` | You want a nuanced mood change. Status: `thinking`, `coding`, `reviewing`, `waiting`, `celebrating`. Focus/load/energy are optional 0..1 floats. |
| `./override.sh <genre[.variant]> [running] [seed] [variant]` | The user asked for something specific, or you want an exact vibe. `running=false` pauses. |

Examples:

```bash
./event.sh task.started
./update.sh thinking "Planning the refactor" 0.72 0.62 0.38
./override.sh lofi.night true
./override.sh ambient false          # pause
./state.sh
```

Every call returns the new server state as JSON (`genre`, `variant`, `bpm`, `running`, …).

## Picking music

Each genre has 5–6 named variants you can target. Get the live list from `./state.sh` — it includes a `genres` array like:

```json
{ "id": "lofi", "defaultVariant": "classic",
  "variants": ["classic", "night", "crate", "sunday", "jazzy", "tape"] }
```

Rough mood map to start from — the agent should adapt, not stick rigidly:

- **Focused reading/thinking** → `deepFocus`, `lofi`, `dreamPop`, `rainyPiano`
- **Actively writing code** → `lofi`, `soulHop`, `neoSoul`, `cityPop`, `chillHouse`
- **Crunch / momentum** → `techno`, `dnb`, `uplift`
- **Blocked / reset** → `calming`, `ambient`, `dub`
- **Celebrating / shipped** → `uplift`, `cityPop`, `sunsetGroove`
- **Idle / background** → `ambient`, `rainyPiano`

## Preferences

- Prefer `event.sh` for lifecycle beats, `update.sh` for in-flight mood shifts, `override.sh` only when the user asks directly or you want a specific variant.
- After a command, summarize the result in one short line (`now playing lofi.night @ 72bpm`).
- Mention the jukebox UI (`http://localhost:8080`) once per session so the user knows they can steer it manually.
- If a script errors with the server unreachable, try it once more (autostart takes a couple of seconds). If it still fails, say the server is unavailable.
- If `scsynth` / `sclang` are missing, tell the user to install SuperCollider system-wide. Don't try to work around it.
