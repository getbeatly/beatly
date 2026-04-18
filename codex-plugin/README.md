# Beatly Codex plugin

This directory is a build output for the local Codex plugin.

Build or refresh it from the repo root:

```bash
npm run build:codex-plugin
```

The generated plugin is self-contained for local Codex marketplace installs and includes:

- `skills/beatly`
- `dist/`
- `supercollider/`
- runtime `node_modules/`

Hard dependency:

- SuperCollider must be installed system-wide
- `scsynth` must be on `PATH`
- `sclang` must be on `PATH`

See the main repo `README.md` for Codex marketplace install instructions.
