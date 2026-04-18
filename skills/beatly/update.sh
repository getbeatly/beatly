#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
STATUS="${1:-}"
SUMMARY="${2:-}"
FOCUS="${3:-}"
LOAD="${4:-}"
ENERGY="${5:-}"

if [[ -z "$STATUS" ]]; then
  echo "usage: $0 <thinking|coding|reviewing|waiting|celebrating> [summary] [focus] [cognitiveLoad] [energy]" >&2
  exit 1
fi

node "$SCRIPT_DIR/driver.mjs" update "$STATUS" "$SUMMARY" "$FOCUS" "$LOAD" "$ENERGY"
