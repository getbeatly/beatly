#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
GENRE="${1:-}"
RUNNING="${2:-true}"
SEED="${3:-}"
VARIANT="${4:-}"

if [[ -z "$GENRE" ]]; then
  echo "usage: $0 <genre[.variant]> [running=true|false] [seed] [variant]" >&2
  exit 1
fi

node "$SCRIPT_DIR/driver.mjs" override "$GENRE" "$RUNNING" "$SEED" "$VARIANT"
