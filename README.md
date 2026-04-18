# Beatly

> A live, generative soundtrack for coding agents. See [beatly.dev](https://beatly.dev).

Requires SuperCollider installed system-wide (`scsynth` and `sclang` on `PATH`) and Node.js 22+.

## Install

### pi

```bash
pi install npm:@beatly/core
```

Then invoke `/skill:beatly`.

### Codex

```bash
codex plugins marketplace add github:getbeatly/codex
codex plugins install beatly
```

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
