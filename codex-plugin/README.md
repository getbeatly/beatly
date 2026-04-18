# Beatly Codex plugin

This directory stores the source manifest and metadata for the Codex plugin build.

Build the self-contained Codex plugin from the repo root:

```bash
npm run build:codex-plugin
```

The generated plugin is written to:

```text
.build/distributions/codex/beatly
```

Hard dependency:

- SuperCollider must be installed system-wide
- `scsynth` must be on `PATH`
- `sclang` must be on `PATH`

See the main repo `README.md` for Codex marketplace install instructions.
