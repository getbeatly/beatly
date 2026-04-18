# Beatly

> **A procedurally generated soundtrack, composed live while your coding agent works.**
>
> Beatly is not a playlist. Every note is synthesized in real time by a local SuperCollider engine and scored to what your agent is *actually doing right now* — the tool call it's running, the diff it's writing, the tests going green, the blocker it just hit, the task it just shipped.
>
> The music **is** the agent's run. See [beatly.dev](https://beatly.dev).

Runs 100% locally. Requires SuperCollider installed system-wide (`scsynth` and `sclang` on `PATH`) and Node.js 22+.

## Install SuperCollider

```bash
brew install --cask supercollider   # macOS
sudo pacman -S supercollider        # Arch
sudo apt install supercollider      # Debian / Ubuntu
```

Windows: [download installer](https://supercollider.github.io/downloads).

## Install

### pi

```bash
pi install npm:@beatly/core
```

Then invoke `/skill:beatly`.

### Codex

```bash
codex marketplace add https://github.com/getbeatly/codex
codex --enable plugins
```

Then inside the Codex TUI, run `/plugins` and install **beatly** from the **Beatly Plugins** marketplace.

The marketplace lives at [`getbeatly/codex`](https://github.com/getbeatly/codex) and is auto-updated by CI on every release.

### Claude Code

```text
/plugin marketplace add getbeatly/claude-code
/plugin install beatly@beatly
```

The marketplace lives at [`getbeatly/claude-code`](https://github.com/getbeatly/claude-code) and is auto-updated by CI on every release.

## Develop

```bash
git clone https://github.com/getbeatly/beatly
cd beatly && npm install
npm start                      # run local server + jukebox at http://localhost:8080
npm run build                  # compile TypeScript
npm run build:distributions    # build pi, Codex, and Claude Code bundles
```

Release by pushing a `vX.Y.Z` tag; CI publishes to npm and attaches bundles to the GitHub release.

## License

MIT
