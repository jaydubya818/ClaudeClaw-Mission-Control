#!/usr/bin/env bash
# Launchd wrapper — sources .env before exec'ing the target command.
# Used by all com.claudeclaw.*.plist files so services pick up GEMINI_API_KEY,
# ANTHROPIC_API_KEY, DB_PATH, etc. without hard-coding secrets in plists.
#
# Usage in plist:
#   ProgramArguments:
#     /bin/bash
#     /Users/jaywest/claudeclaw/bin/launchd-wrap.sh
#     <service_name>

set -euo pipefail

REPO="/Users/jaywest/claudeclaw"
cd "$REPO"

# Augment PATH so node/python (Homebrew on either arch) is findable.
# launchd starts with a minimal PATH that misses /opt/homebrew/bin and similar.
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:${PATH:-}"

# Source .env into the environment (set -a marks all assignments as exported)
if [ -f "$REPO/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  . "$REPO/.env"
  set +a
fi

# Always use absolute DB_PATH so cwd-shifts in apps/* don't break SQLite.
export DB_PATH="${DB_PATH:-$REPO/store/claudeclaw.db}"

# Resolve node (Apple Silicon vs. Intel vs. nvm) without hardcoding a path.
NODE_BIN="$(command -v node || true)"
PYTHON_VENV="$REPO/.venv/bin/python"

case "${1:-}" in
  bridge)
    cd "$REPO/apps/bridge"
    exec "$NODE_BIN" --import=tsx src/index.ts
    ;;
  dashboard)
    cd "$REPO/apps/dashboard"
    exec "$NODE_BIN" --import=tsx src/server.ts
    ;;
  warroom)
    cd "$REPO/apps/warroom"
    exec "$PYTHON_VENV" server.py
    ;;
  meeting)
    cd "$REPO/apps/warroom"
    exec "$PYTHON_VENV" meeting.py
    ;;
  scheduler)
    cd "$REPO"
    exec "$NODE_BIN" --import=tsx scheduler/runner.ts
    ;;
  consolidator)
    cd "$REPO"
    exec "$PYTHON_VENV" -m memory.consolidator
    ;;
  decay)
    cd "$REPO"
    exec "$PYTHON_VENV" -m memory.decay
    ;;
  extractor)
    cd "$REPO"
    exec "$PYTHON_VENV" -m memory.extractor
    ;;
  *)
    echo "Usage: $0 {bridge|dashboard|warroom|meeting|scheduler|consolidator|decay|extractor}" >&2
    exit 64
    ;;
esac
