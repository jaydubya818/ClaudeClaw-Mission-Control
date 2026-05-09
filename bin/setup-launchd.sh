#!/usr/bin/env bash
# One-shot: install all 7 plists into ~/Library/LaunchAgents and bootstrap
# them under launchd so everything auto-boots when the Mac wakes.
#
# Usage:
#   ./bin/setup-launchd.sh              # install + bootstrap all
#   ./bin/setup-launchd.sh status       # just print status
#   ./bin/setup-launchd.sh uninstall    # bootout + remove from LaunchAgents

set -uo pipefail
cd "$(dirname "$0")/.."
REPO="$(pwd)"
USER_AGENTS="$HOME/Library/LaunchAgents"
UID_=$(id -u)
LOG_DIR="$HOME/Library/Logs/claudeclaw"

SERVICES=(bridge dashboard warroom scheduler consolidator backup decay)

mkdir -p "$LOG_DIR" "$USER_AGENTS"

cmd="${1:-install}"

install_one() {
  local svc="$1"
  local src="$REPO/infra/launchd/com.claudeclaw.$svc.plist"
  local dst="$USER_AGENTS/com.claudeclaw.$svc.plist"
  if [ ! -f "$src" ]; then
    echo "  ✗ $svc: plist missing ($src)"
    return 1
  fi
  echo "  → $svc"
  cp "$src" "$dst"
  # bootout first (idempotent — exits 0 even if not loaded)
  launchctl bootout "gui/$UID_/com.claudeclaw.$svc" 2>/dev/null || true
  # bootstrap fresh
  if launchctl bootstrap "gui/$UID_" "$dst" 2>&1 | sed "s/^/    /"; then
    :
  fi
  # Wait briefly then check status
  sleep 1
  if launchctl print "gui/$UID_/com.claudeclaw.$svc" >/dev/null 2>&1; then
    local pid=$(launchctl list | grep "com.claudeclaw.$svc" | awk '{print $1}')
    [ "$pid" != "-" ] && echo "    ✓ loaded (pid=$pid)" || echo "    ⚠ loaded but not running yet"
  else
    echo "    ✗ failed to load"
  fi
}

uninstall_one() {
  local svc="$1"
  echo "  → $svc"
  launchctl bootout "gui/$UID_/com.claudeclaw.$svc" 2>/dev/null && echo "    ✓ booted out" || echo "    (was not loaded)"
  rm -f "$USER_AGENTS/com.claudeclaw.$svc.plist"
}

case "$cmd" in
  install)
    echo "Installing 7 ClaudeClaw services to launchd..."
    echo ""
    # Pre-flight: kill manual processes so launchd has a clean port to bind.
    echo "Killing any manual dev processes first..."
    pkill -f "tsx.*dashboard/src/server" 2>/dev/null || true
    pkill -f "tsx.*bridge/src/index"     2>/dev/null || true
    pkill -f "warroom/server.py"          2>/dev/null || true
    pkill -f "scheduler/runner"           2>/dev/null || true
    sleep 1
    echo ""
    for svc in "${SERVICES[@]}"; do
      install_one "$svc"
    done
    echo ""
    echo "Done. Verify with: $0 status"
    echo "Tail logs:        tail -f $LOG_DIR/*.err"
    ;;
  uninstall)
    for svc in "${SERVICES[@]}"; do
      uninstall_one "$svc"
    done
    ;;
  status)
    echo "ClaudeClaw services in launchd:"
    launchctl list | grep claudeclaw || echo "  (none loaded)"
    ;;
  *)
    echo "Usage: $0 [install | status | uninstall]"
    exit 1
    ;;
esac
