#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
EVENT="${1:-}"
if [[ -z "$EVENT" ]]; then
  echo "usage: $0 <task.started|task.blocked|task.completed|agent.idle|agent.error|agent.breakthrough>" >&2
  exit 1
fi

node "$SCRIPT_DIR/driver.mjs" event "$EVENT"
