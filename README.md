# @beatly/core

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
npm run build:codex-plugin
```

Load `./.build/distributions/codex/beatly` from a local marketplace, or download `beatly-codex-vX.Y.Z.tar.gz` from the [latest release](https://github.com/getbeatly/beatly/releases).

### Claude Code

```bash
npm run build:claude-code
ln -s "$PWD/.build/distributions/claude-code/beatly" ~/.claude/skills/beatly
```

Or download `beatly-claude-code-vX.Y.Z.tar.gz` from the [latest release](https://github.com/getbeatly/beatly/releases).

## Develop

```bash
npm start                      # run local server + jukebox at http://localhost:8080
npm run build                  # compile TypeScript
npm run build:distributions    # build pi, Codex, and Claude Code bundles
```

Release by pushing a `vX.Y.Z` tag; CI publishes to npm and attaches bundles to the GitHub release.

## License

MIT
