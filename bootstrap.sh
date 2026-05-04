#!/usr/bin/env bash
# ClaudeClaw bootstrap. Installs deps, inits DB, sets up launchd.
# Run from the project root: ./bootstrap.sh

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$ROOT"

say() { printf "\033[35m▸\033[0m %s\n" "$*"; }
warn() { printf "\033[33m!\033[0m %s\n" "$*"; }
die() { printf "\033[31m✗ %s\033[0m\n" "$*" >&2; exit 1; }

# --- preflight ---
command -v node >/dev/null || die "node 20+ required"
command -v python3 >/dev/null || die "python 3.9+ required"
HAS_SQLITE3_CLI=1
command -v sqlite3 >/dev/null || { HAS_SQLITE3_CLI=0; warn "no sqlite3 CLI — will use Python fallback for DB init"; }

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 20 ]] || die "node 20+ required (have $(node -v))"

# --- env ---
if [[ ! -f .env ]]; then
  say "copying .env.example → .env (edit it before running services)"
  cp .env.example .env
fi

if [[ ! -f security/allowlist.json ]]; then
  cp security/allowlist.json.example security/allowlist.json
  warn "update security/allowlist.json with your Telegram chat IDs"
fi

# --- node deps ---
say "installing Node workspaces"
npm install --silent

# --- python venv for warroom + memory ---
say "creating Python venv"
python3 -m venv .venv
# shellcheck disable=SC1091
source .venv/bin/activate
pip install -q --upgrade pip
pip install -q -r apps/warroom/requirements.txt
pip install -q google-generativeai python-dotenv
deactivate

# --- init db ---
if [[ ! -f store/claudeclaw.db ]]; then
  say "initializing SQLite at store/claudeclaw.db"
  mkdir -p store
  if [[ "$HAS_SQLITE3_CLI" == "1" ]]; then
    sqlite3 store/claudeclaw.db < memory/schema.sql
  else
    python3 - <<'PY'
import sqlite3, pathlib
db = sqlite3.connect("store/claudeclaw.db")
db.executescript(pathlib.Path("memory/schema.sql").read_text())
db.commit()
db.close()
PY
  fi
else
  say "SQLite already initialized"
fi

# --- launchd (macOS only, opt-in) ---
if [[ "${INSTALL_LAUNCHD:-0}" == "1" && "$(uname)" == "Darwin" ]]; then
  LA="$HOME/Library/LaunchAgents"
  LOGS="$HOME/Library/Logs/claudeclaw"
  mkdir -p "$LA" "$LOGS"
  for plist in infra/launchd/*.plist; do
    name="$(basename "$plist")"
    sed "s|/Users/jay/claudeclaw|$ROOT|g" "$plist" > "$LA/$name"
    launchctl unload "$LA/$name" 2>/dev/null || true
    launchctl load "$LA/$name"
    say "loaded $name"
  done
else
  warn "skipped launchd (run INSTALL_LAUNCHD=1 ./bootstrap.sh to enable)"
fi

# --- summary ---
cat <<DONE

─────────────────────────────────────────────
 Bootstrap complete.

 Next:
   1) Edit .env with TELEGRAM_BOT_TOKEN, GEMINI_API_KEY, TELEGRAM_ALLOWED_CHAT_IDS
   2) Add your chat IDs to security/allowlist.json
   3) npm run bridge        # Telegram bridge
   4) npm run dashboard     # Mission Control (:3141)
   5) npm run warroom       # War Room (:7860)

 Logs: ~/Library/Logs/claudeclaw/
─────────────────────────────────────────────
DONE
